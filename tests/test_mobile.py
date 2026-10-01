"""Mobile v1.2: profile, picture, preferences, classes, due dates, late/pending, summaries, schedule."""

import hashlib
import io
import json
from uuid import UUID, uuid4

from fastapi.testclient import TestClient
from PIL import Image

from app import models as m
from app import schemas as s
from app.auth import Principal, get_principal
from app.routes import upload_hash
from tests.conftest import OTHER

SAMPAGUITA = ["Marcus Chen", "Andrea Villanueva", "Joshua Ramos"]


def put_class(client, class_id=None, **changes):
    class_id = class_id or str(uuid4())
    body = {
        "level": "highschool",
        "grade": 9,
        "section": "Sampaguita",
        "subject": "Biology",
        "students": SAMPAGUITA,
    }
    response = client.put(f"/v1/classes/{class_id}", json=body | changes)
    assert response.status_code == 200, response.text
    return response.json()


def upload_assessment(client, payload, cls=None, due_at=None):
    data = payload | {"id": str(uuid4()), "answer_key": payload["answer_key"] | {"id": str(uuid4())}}
    if cls:
        data["class_id"] = cls["id"]
    if due_at:
        data["due_at"] = due_at
    response = client.post("/v1/uploads/assessments", json={"assessment": data, "key_teacher_verified": True})
    assert response.status_code == 200, response.text
    return data


def score_for(client, key_id, answers):
    score = client.post("/v1/scoring/preview", json={"answer_key_id": key_id, "answers": answers}).json()
    return {k: score[k] for k in ["automatic_score", "final_score", "possible_score", "items"]}


def upload_result(client, assessment, student, submitted_at=None, correct=True):
    answers = [
        {"number": 1, "state": "confirmed", "value": "A" if correct else "B"},
        {"number": 2, "state": "confirmed", "value": "True"},
    ]
    sub = {
        "id": str(uuid4()),
        "assessment_id": assessment["id"],
        "answer_key_id": assessment["answer_key"]["id"],
        "student_label": student,
        "source": "on_device",
        "answers": answers,
    }
    if submitted_at:
        sub["submitted_at"] = submitted_at
    payload = {
        "submission": sub,
        "teacher_approved": True,
        "local_approved_at": "2026-09-15T18:00:00+08:00",
        "client_score": score_for(client, sub["answer_key_id"], answers),
    }
    response = client.post("/v1/uploads/submissions", json=payload)
    assert response.status_code == 200, response.text
    return client.get(f"/v1/submissions/{sub['id']}").json()


# --- Profile, picture, preferences ---------------------------------------------------------


def test_profile_fields_are_optional_and_kept(client):
    first = client.get("/v1/me").json()
    assert first["display_name"] == "Teacher" and first["avatar"]["style"] == "initials"
    body = {
        "display_name": "Teacher Elena",
        "full_name": "Elena Santos",
        "school_name": "Fictional Integrated School",
        "avatar": {"style": "pattern", "color": "#FFD93D", "pattern": "waves"},
    }
    saved = client.put("/v1/me", json=body).json()
    assert saved["full_name"] == "Elena Santos" and saved["avatar"]["pattern"] == "waves"
    # Older app versions send only display_name: the rest must survive.
    again = client.put("/v1/me", json={"display_name": "Ms. Santos"}).json()
    assert again["display_name"] == "Ms. Santos"
    assert again["school_name"] == "Fictional Integrated School" and again["avatar"]["style"] == "pattern"
    assert (
        client.put("/v1/me", json=body | {"avatar": {"style": "pattern", "color": "yellow"}}).status_code
        == 422
    )


def png(size=(640, 480), color=(77, 150, 255)):
    buffer = io.BytesIO()
    Image.new("RGB", size, color).save(buffer, format="PNG")
    return buffer.getvalue()


def test_avatar_is_square_jpeg_and_removable(client):
    response = client.put("/v1/me/avatar", files={"file": ("me.png", png(), "image/png")})
    assert response.status_code == 204, response.text
    me = client.get("/v1/me").json()
    assert me["avatar"]["has_photo"] and me["avatar"]["style"] == "photo"
    picture = client.get("/v1/me/avatar")
    assert picture.headers["content-type"] == "image/jpeg"
    with Image.open(io.BytesIO(picture.content)) as image:
        assert image.size == (256, 256) and image.format == "JPEG"
    assert client.put("/v1/me/avatar", files={"file": ("me.gif", b"GIF89a", "image/gif")}).status_code == 415
    assert (
        client.put("/v1/me/avatar", files={"file": ("me.png", b"not an image", "image/png")}).status_code
        == 422
    )
    assert client.delete("/v1/me/avatar").status_code == 204
    me = client.get("/v1/me").json()
    assert not me["avatar"]["has_photo"] and me["avatar"]["style"] == "initials"
    assert client.get("/v1/me/avatar").status_code == 404


def test_preferences_merge_and_validate(client):
    assert client.get("/v1/me/preferences").json()["updated_at"] is None
    client.put("/v1/me/preferences", json={"theme": "dark", "notify": {"tips": False}})
    saved = client.put("/v1/me/preferences", json={"dock": ["scan", "timer"]}).json()
    assert (
        saved["theme"] == "dark" and saved["notify"] == {"tips": False} and saved["dock"] == ["scan", "timer"]
    )
    assert saved["updated_at"]
    assert (
        client.put("/v1/me/preferences", json={"dock": ["scan", "ai", "timer", "records"]}).status_code == 422
    )
    assert client.put("/v1/me/preferences", json={"wallpaper": "cats"}).status_code == 422


# --- Classes --------------------------------------------------------------------------------


def test_class_create_update_and_class_list_history(client, app):
    cls = put_class(client)
    assert cls["students"] == SAMPAGUITA and cls["level"] == "highschool" and cls["grade"] == 9
    assert cls["revision"] == 1
    joshua = cls["student_ids"][2]

    # Remove Joshua, add a new student, reorder.
    updated = put_class(client, cls["id"], students=["Bea Dizon", "Marcus Chen", "Andrea Villanueva"])
    assert updated["students"] == ["Bea Dizon", "Marcus Chen", "Andrea Villanueva"]
    assert updated["revision"] == 2 and updated["section_id"] == cls["section_id"]
    with app.state.engine.connect() as conn:
        closed = conn.execute(
            m.Enrollment.__table__.select().where(m.Enrollment.student_id == UUID(joshua))
        ).fetchall()
    assert closed and all(row.ends_on is not None for row in closed)

    # Joshua returns: the same student record, so earlier results stay connected.
    back = put_class(
        client, cls["id"], students=["Bea Dizon", "Marcus Chen", "Andrea Villanueva", "Joshua Ramos"]
    )
    assert back["student_ids"][3] == joshua

    stale = client.put(
        f"/v1/classes/{cls['id']}",
        json={
            "level": "highschool",
            "grade": 9,
            "section": "Sampaguita",
            "subject": "Biology",
            "expected_revision": 1,
        },
    )
    assert stale.status_code == 409 and stale.json()["error"]["code"] == "stale_revision"
    assert (
        client.put(
            f"/v1/classes/{uuid4()}",
            json={
                "level": "highschool",
                "grade": 3,
                "section": "A",
                "subject": "Biology",
            },
        ).status_code
        == 422
    )


def test_shared_section_keeps_students_listed_by_another_class(client, app):
    bio = put_class(client)
    math = put_class(client, subject="Mathematics")
    assert bio["section_id"] == math["section_id"] and bio["student_ids"] == math["student_ids"]
    marcus = bio["student_ids"][0]
    put_class(client, bio["id"], students=SAMPAGUITA[1:])
    with app.state.engine.connect() as conn:
        rows = conn.execute(m.Enrollment.__table__.select()).fetchall()
    assert any(str(r.student_id) == marcus and r.ends_on is None for r in rows)


def test_archive_and_incremental_class_sync(client):
    keep = put_class(client)
    gone = put_class(client, section="Narra")
    first = client.get("/v1/classes").json()
    assert {c["id"] for c in first["items"]} == {keep["id"], gone["id"]} and first["server_time"]
    archived = client.delete(f"/v1/classes/{gone['id']}").json()
    assert (
        archived["archived"]
        and client.delete(f"/v1/classes/{gone['id']}").json()["revision"] == archived["revision"]
    )
    assert [c["id"] for c in client.get("/v1/classes").json()["items"]] == [keep["id"]]
    changes = client.get("/v1/classes", params={"updated_since": first["server_time"]}).json()["items"]
    assert [(c["id"], c["archived"]) for c in changes] == [(gone["id"], True)]


def test_classes_are_private_to_their_teacher(client, app):
    cls = put_class(client)
    app.dependency_overrides[get_principal] = lambda: Principal(OTHER, "aal2")
    with TestClient(app) as other:
        assert other.get(f"/v1/classes/{cls['id']}").status_code == 404
        assert other.get("/v1/classes").json()["items"] == []
        taken = other.put(
            f"/v1/classes/{cls['id']}",
            json={
                "level": "highschool",
                "grade": 9,
                "section": "Theirs",
                "subject": "Biology",
            },
        )
        assert taken.status_code == 409


# --- Due dates, late and pending ------------------------------------------------------------


def test_class_assessment_due_date_late_and_linking(client, assessment_payload):
    cls = put_class(client)
    assert (
        client.post(
            "/v1/uploads/assessments",
            json={
                "assessment": assessment_payload | {"class_id": str(uuid4())},
                "key_teacher_verified": True,
            },
        ).json()["error"]["code"]
        == "unknown_class"
    )
    exam = upload_assessment(client, assessment_payload, cls, due_at="2026-09-15T17:00:00+08:00")
    listed = client.get("/v1/assessments", params={"class_id": cls["id"]}).json()["items"]
    assert listed[0]["class_id"] == cls["id"] and listed[0]["due_at"].startswith("2026-09-15T09:00:00")

    on_time = upload_result(client, exam, "Marcus Chen", submitted_at="2026-09-15T16:59:00+08:00")
    late = upload_result(client, exam, "andrea  villanueva", submitted_at="2026-09-15T17:30:00+08:00")
    assert not on_time["late"] and late["late"]
    # Results are matched to the class list by name.
    assert on_time["student_id"] == cls["student_ids"][0] and late["student_id"] == cls["student_ids"][1]
    only_late = client.get("/v1/submissions", params={"late": True}).json()["items"]
    assert [sub["id"] for sub in only_late] == [late["id"]]
    assert len(client.get("/v1/submissions", params={"class_id": cls["id"]}).json()["items"]) == 2


def test_summary_and_student_ranking(client, assessment_payload):
    cls = put_class(client)
    exam = upload_assessment(client, assessment_payload, cls, due_at="2026-09-15T17:00:00+08:00")
    upload_result(client, exam, "Marcus Chen", submitted_at="2026-09-15T16:00:00+08:00")
    upload_result(client, exam, "Andrea Villanueva", submitted_at="2026-09-15T18:00:00+08:00", correct=False)
    upload_result(client, exam, "Visiting Student", submitted_at="2026-09-15T16:30:00+08:00")

    summary = client.get(f"/v1/classes/{cls['id']}/summary").json()
    assert summary["results"] == 3 and summary["late"] == 1 and summary["pending"] == 1
    assert summary["assessments"][0]["pending"] == [
        {"student_id": cls["student_ids"][2], "name": "Joshua Ramos"}
    ]
    # 3/3, 1/3 and 3/3 points: 100, 33.33 and 100.
    assert summary["average"] == "77.78"
    assert summary["bands"]["outstanding"] == 2 and summary["bands"]["did_not_meet"] == 1

    ranked = client.get(f"/v1/classes/{cls['id']}/students").json()["items"]
    assert [st["name"] for st in ranked][:2] == ["Marcus Chen", "Visiting Student"]
    assert ranked[-1]["name"] == "Joshua Ramos" and ranked[-1]["missing"] == [exam["id"]]
    visiting = next(st for st in ranked if st["name"] == "Visiting Student")
    assert not visiting["on_class_list"] and visiting["missing"] == []
    lateness = client.get(f"/v1/classes/{cls['id']}/students", params={"sort": "late"}).json()["items"]
    assert [st["name"] for st in lateness] == ["Andrea Villanueva"]
    missing = client.get(f"/v1/classes/{cls['id']}/students", params={"sort": "missing"}).json()["items"]
    assert [st["name"] for st in missing] == ["Joshua Ramos"]


def test_older_upload_payloads_keep_their_fingerprint(assessment_payload):
    payload = s.OfflineAssessment(
        assessment=s.AssessmentCreate(**assessment_payload), key_teacher_verified=True
    )

    def canonical(value):
        if isinstance(value, dict):
            return {key: canonical(item) for key, item in value.items()}
        if isinstance(value, list):
            return [canonical(item) for item in value]
        return (
            format(value.normalize(), "f")
            if hasattr(value, "normalize")
            else (str(value) if not isinstance(value, (str, int, float, bool, type(None))) else value)
        )

    old = payload.model_dump()
    for name in ("class_id", "due_at"):
        old["assessment"].pop(name)
    digest = hashlib.sha256(
        json.dumps(canonical(old), sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    assert upload_hash(payload) == digest


# --- Schedule ------------------------------------------------------------------------------


def test_schedule_events_crud_and_tombstones(client):
    cls = put_class(client)
    event_id = str(uuid4())
    body = {
        "title": "Bio Midterm",
        "type": "exam",
        "starts_at": "2026-10-05T13:00:00+08:00",
        "duration_min": 60,
        "class_id": cls["id"],
    }
    created = client.put(f"/v1/events/{event_id}", json=body).json()
    assert created["revision"] == 1 and created["starts_at"].startswith("2026-10-05T05:00:00")
    first = client.get("/v1/events").json()
    assert [e["id"] for e in first["items"]] == [event_id]
    window = client.get(
        "/v1/events", params={"from": "2026-10-01T00:00:00+08:00", "to": "2026-10-31T00:00:00+08:00"}
    )
    assert len(window.json()["items"]) == 1
    assert (
        client.get(
            "/v1/events", params={"from": "2026-01-01T00:00:00+08:00", "to": "2026-12-31T00:00:00+08:00"}
        ).status_code
        == 422
    )

    moved = client.put(
        f"/v1/events/{event_id}", json=body | {"duration_min": 90, "expected_revision": 1}
    ).json()
    assert moved["revision"] == 2 and moved["duration_min"] == 90
    assert client.put(f"/v1/events/{event_id}", json=body | {"expected_revision": 1}).status_code == 409
    assert client.put(f"/v1/events/{uuid4()}", json=body | {"class_id": str(uuid4())}).status_code == 422
    assert (
        client.put(f"/v1/events/{uuid4()}", json=body | {"starts_at": "2026-10-05T13:00:00"}).status_code
        == 422
    )

    removed = client.delete(f"/v1/events/{event_id}").json()
    assert removed["deleted_at"]
    assert client.get("/v1/events").json()["items"] == []
    tombstones = client.get("/v1/events", params={"updated_since": first["server_time"]}).json()["items"]
    assert [(e["id"], bool(e["deleted_at"])) for e in tombstones] == [(event_id, True)]


def test_incremental_assessment_sync(client, assessment_payload):
    upload_assessment(client, assessment_payload)
    first = client.get("/v1/assessments").json()
    later = upload_assessment(client, assessment_payload)
    changes = client.get("/v1/assessments", params={"updated_since": first["server_time"]}).json()["items"]
    assert [a["id"] for a in changes] == [later["id"]]
    assert client.get("/v1/assessments", params={"updated_since": "2026-01-01T00:00:00"}).status_code == 422


# --- Feedback ------------------------------------------------------------------------------


def test_feedback_is_stored_and_limited(client):
    body = {"message": "The flash button is hard to find.", "app_version": "1.2.0", "platform": "android"}
    created = client.post("/v1/feedback", json=body)
    assert created.status_code == 201 and created.json()["id"]
    for _ in range(19):
        assert client.post("/v1/feedback", json=body).status_code == 201
    limited = client.post("/v1/feedback", json=body)
    assert limited.status_code == 429 and limited.json()["error"]["code"] == "feedback_limit"
    assert client.post("/v1/feedback", json={"message": "hi"}).status_code == 422
