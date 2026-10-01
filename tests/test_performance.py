from copy import deepcopy
from uuid import uuid4

from app.errors import DomainError
from tests.conftest import create_assessment, create_submission, submission_payload


def post(client, path, body):
    response = client.post("/v1/" + path, json=body)
    assert response.status_code == 201, response.text
    return response.json()


def setup_class(client):
    year = post(
        client,
        "academic-years",
        {"name": "2026-2027 Fictional", "starts_on": "2026-06-01", "ends_on": "2027-05-31"},
    )
    term = post(
        client,
        "terms",
        {
            "name": "Term 1",
            "academic_year_id": year["id"],
            "starts_on": "2026-06-01",
            "ends_on": "2026-10-31",
        },
    )
    level = post(client, "grade-levels", {"name": "Grade 4"})
    section = post(
        client,
        "sections",
        {"name": "Fictional Cedar", "grade_level_id": level["id"], "academic_year_id": year["id"]},
    )
    student = post(client, "students", {"id": str(uuid4()), "display_name": "Fictional Learner A"})
    enrollment = post(
        client,
        "enrollments",
        {"student_id": student["id"], "section_id": section["id"], "starts_on": "2026-06-01"},
    )
    subject = post(client, "subjects", {"name": "Mathematics"})
    competency = post(client, "competencies", {"name": "Fractions", "subject_id": subject["id"]})
    return dict(
        year=year,
        term=term,
        level=level,
        section=section,
        student=student,
        enrollment=enrollment,
        subject=subject,
        competency=competency,
    )


def tagged_assessment(client, payload, data):
    payload = deepcopy(payload)
    payload["id"], payload["answer_key"]["id"] = str(uuid4()), str(uuid4())
    payload.update(subject_id=data["subject"]["id"], term_id=data["term"]["id"])
    for question in payload["answer_key"]["questions"]:
        question["competency_ids"] = [data["competency"]["id"]]
    return create_assessment(client, payload)


def performance_url(data):
    return (
        f"/v1/students/{data['student']['id']}/performance?subject_id={data['subject']['id']}"
        f"&term_id={data['term']['id']}&min_questions=1&min_assessments=1"
    )


def test_filters_and_enrollment_history(client):
    data = setup_class(client)
    other_level = post(client, "grade-levels", {"name": "Grade 5"})
    new_section = post(
        client,
        "sections",
        {
            "name": "Fictional Pine",
            "grade_level_id": other_level["id"],
            "academic_year_id": data["year"]["id"],
        },
    )
    assert (
        client.post(
            f"/v1/enrollments/{data['enrollment']['id']}/close", json={"ends_on": "2026-09-30"}
        ).status_code
        == 200
    )
    post(
        client,
        "enrollments",
        {"student_id": data["student"]["id"], "section_id": new_section["id"], "starts_on": "2026-10-01"},
    )
    url = f"/v1/students?grade_level_id={data['level']['id']}&section_id={data['section']['id']}&as_of=2026-09-15"
    assert [s["id"] for s in client.get(url).json()["items"]] == [data["student"]["id"]]
    assert client.get(url.replace("2026-09-15", "2026-10-15")).json()["items"] == []
    assert (
        len(client.get(f"/v1/students?section_id={new_section['id']}&as_of=2026-10-15").json()["items"]) == 1
    )
    assert len(client.get("/v1/enrollments").json()["items"]) == 2


def test_reports_approved_only_missing_zero_pending_and_evidence(client, assessment_payload):
    data = setup_class(client)
    first, key = tagged_assessment(client, assessment_payload, data)
    sub_payload = submission_payload(
        first, key, [{"number": 1, "state": "confirmed_blank"}, {"number": 2, "state": "confirmed_blank"}]
    )
    sub_payload.update(student_id=data["student"]["id"], enrollment_id=data["enrollment"]["id"])
    approved = create_submission(client, sub_payload, approved=True)
    pending, pending_key = tagged_assessment(client, assessment_payload, data)
    pending_payload = submission_payload(pending, pending_key, [{"number": 1, "state": "unreadable"}])
    pending_payload.update(student_id=data["student"]["id"], enrollment_id=data["enrollment"]["id"])
    create_submission(client, pending_payload)
    missing, _ = tagged_assessment(client, assessment_payload, data)
    for assessment in (first, pending, missing):
        post(
            client,
            "expected-assessments",
            {"assessment_id": assessment["id"], "enrollment_id": data["enrollment"]["id"]},
        )
    response = client.get(performance_url(data))
    assert response.status_code == 200, response.text
    report = response.json()
    assert len(report["assessments"]) == 1
    assert report["assessments"][0]["final_score"] == "0.00"
    assert report["learning_areas"][0]["flag"] == "needs_support"
    assert report["learning_areas"][0]["evaluated_questions"] == 2
    assert report["learning_areas"][0]["evidence"][0]["submission_id"] == approved["id"]
    states = {e["assessment_id"]: e["status"] for e in report["expected_assessments"]}
    assert states == {first["id"]: "approved", pending["id"]: "pending_review", missing["id"]: "missing"}
    assert report["official_term_grade"] is None
    report = client.get(performance_url(data).replace("min_questions=1", "min_questions=5")).json()
    assert report["learning_areas"][0]["flag"] == "insufficient_evidence"


def test_associate_approved_unassigned_and_snapshot_survives_move(client, assessment_payload):
    data = setup_class(client)
    assessment, key = tagged_assessment(client, assessment_payload, data)
    sub = create_submission(client, submission_payload(assessment, key), approved=True)
    response = client.put(
        f"/v1/submissions/{sub['id']}/student",
        json={
            "expected_revision": sub["revision"],
            "student_id": data["student"]["id"],
            "enrollment_id": data["enrollment"]["id"],
        },
    )
    assert response.status_code == 200, response.text
    consultation = post(
        client,
        "consultations",
        {
            "student_id": data["student"]["id"],
            "query": {"subject_id": data["subject"]["id"], "term_id": data["term"]["id"]},
            "teacher_notes": "Review fractions together",
        },
    )
    assert consultation["provenance"]["ai_generated"] is False
    snapshot = consultation["snapshot"]
    assert (
        client.post(
            f"/v1/enrollments/{data['enrollment']['id']}/close", json={"ends_on": "2026-09-30"}
        ).status_code
        == 200
    )
    response = client.get(f"/v1/consultations/{consultation['id']}")
    assert response.json()["snapshot"] == snapshot
    assert snapshot["assessments"][0]["section"] == "Fictional Cedar"
    response = client.post(
        f"/v1/consultations/{consultation['id']}/approve", json={"expected_revision": 1, "confirmed": True}
    )
    assert response.json()["status"] == "approved"


def test_subject_term_student_filters_and_ai_failure_independence(client, app, assessment_payload):
    data = setup_class(client)
    assessment, key = tagged_assessment(client, assessment_payload, data)
    sub_payload = submission_payload(assessment, key)
    sub_payload.update(student_id=data["student"]["id"], enrollment_id=data["enrollment"]["id"])
    create_submission(client, sub_payload, approved=True)
    second_subject = post(client, "subjects", {"name": "Science"})
    response = client.get(performance_url(data).replace(data["subject"]["id"], second_subject["id"]))
    assert response.json()["assessments"] == []
    student = post(client, "students", {"display_name": "Fictional Learner B"})
    response = client.get(performance_url(data).replace(data["student"]["id"], student["id"]))
    assert response.json()["assessments"] == []
    other_term = post(
        client,
        "terms",
        {
            "name": "Term 2",
            "academic_year_id": data["year"]["id"],
            "starts_on": "2026-11-01",
            "ends_on": "2027-02-28",
        },
    )
    assert (
        client.get(performance_url(data).replace(data["term"]["id"], other_term["id"])).json()["assessments"]
        == []
    )

    def unavailable(_):
        raise DomainError(504, "ai_timeout", "Mock timeout")

    app.state.ai.consultation = unavailable
    response = client.post(
        "/v1/consultations",
        json={
            "student_id": data["student"]["id"],
            "query": {"subject_id": data["subject"]["id"], "term_id": data["term"]["id"]},
            "use_ai": True,
        },
    )
    assert response.status_code == 504
    assert client.get("/v1/consultations").json()["items"] == []
    assert client.get(performance_url(data)).status_code == 200


def test_latest_approved_attempt_policy(client, assessment_payload):
    data = setup_class(client)
    assessment, key = tagged_assessment(client, assessment_payload, data)
    payload = submission_payload(
        assessment,
        key,
        [{"number": 1, "state": "confirmed_blank"}, {"number": 2, "state": "confirmed_blank"}],
    )
    payload.update(student_id=data["student"]["id"], enrollment_id=data["enrollment"]["id"])
    create_submission(client, payload, approved=True)
    payload = submission_payload(assessment, key)
    payload.update(student_id=data["student"]["id"], enrollment_id=data["enrollment"]["id"])
    latest = create_submission(client, payload, approved=True)
    report = client.get(performance_url(data)).json()
    assert len(report["assessments"]) == 1
    assert report["assessments"][0]["submission_id"] == latest["id"]
    assert report["learning_areas"][0]["percentage"] == "100.00"
