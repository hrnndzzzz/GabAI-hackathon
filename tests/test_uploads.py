from copy import deepcopy

from tests.conftest import create_assessment, submission_payload


def client_score(score):
    return {key: score[key] for key in ["automatic_score", "final_score", "possible_score", "items"]}


def test_offline_assessment_idempotent_conflict(client, assessment_payload):
    payload = {"assessment": assessment_payload, "key_teacher_verified": True}
    first = client.post("/v1/uploads/assessments", json=payload)
    assert first.status_code == 200, first.text
    assert first.json()["status"] == "created"
    second = client.post("/v1/uploads/assessments", json=payload)
    assert second.json()["status"] == "already_uploaded"
    assert first.json()["server_id"] == second.json()["server_id"]
    payload["assessment"]["title"] = "Conflicting title"
    assert client.post("/v1/uploads/assessments", json=payload).status_code == 409
    assert len(client.get("/v1/assessments").json()["items"]) == 1


def test_submission_upload_atomic_scoring_and_retry(client, assessment_payload):
    assessment, key = create_assessment(client, assessment_payload)
    sub = submission_payload(assessment, key)
    score = client.post(
        "/v1/scoring/preview", json={"answer_key_id": key["id"], "answers": sub["answers"]}
    ).json()
    payload = {
        "submission": sub,
        "teacher_approved": True,
        "local_approved_at": "2026-09-15T09:00:00+08:00",
        "client_score": client_score(score),
    }
    wrong = deepcopy(payload)
    wrong["client_score"]["final_score"] = "99.00"
    response = client.post("/v1/uploads/submissions", json=wrong)
    assert response.status_code == 409, response.text
    assert client.get("/v1/submissions").json()["items"] == []
    first = client.post("/v1/uploads/submissions", json=payload)
    assert first.status_code == 200, first.text
    assert client.post("/v1/uploads/submissions", json=payload).json()["status"] == "already_uploaded"
    result = client.get(f"/v1/submissions/{sub['id']}").json()
    assert result["status"] == "approved"
    assert result["score"]["answer_key_version"] == 1
    assert len(result["score"]["items"]) == 2
    payload["submission"]["student_label"] = "Conflicting label"
    assert client.post("/v1/uploads/submissions", json=payload).status_code == 409


def test_item_tampering_and_missing_stable_ids(client, assessment_payload):
    assessment, key = create_assessment(client, assessment_payload)
    sub = submission_payload(assessment, key)
    score = client.post(
        "/v1/scoring/preview", json={"answer_key_id": key["id"], "answers": sub["answers"]}
    ).json()
    score = client_score(score)
    score["items"][0]["final_score"] = "1.00"
    assert (
        client.post(
            "/v1/scoring/preview",
            json={"answer_key_id": key["id"], "answers": sub["answers"], "client_score": score},
        ).status_code
        == 409
    )
    del assessment_payload["id"]
    assert (
        client.post(
            "/v1/uploads/assessments", json={"assessment": assessment_payload, "key_teacher_verified": True}
        ).status_code
        == 422
    )
