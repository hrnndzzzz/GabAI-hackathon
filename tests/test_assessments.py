from copy import deepcopy
from uuid import uuid4

from app.auth import Principal, get_principal
from tests.conftest import OTHER, create_assessment, create_submission, submission_payload


def test_unverified_key_blocks_approval(client, assessment_payload):
    assessment, key = create_assessment(client, assessment_payload, verified=False)
    sub = create_submission(client, submission_payload(assessment, key))
    response = client.post(
        f"/v1/submissions/{sub['id']}/approve", json={"confirmed": True, "expected_revision": 1}
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "review_required"
    assert sub["score"]["final_score"] == "3.00"


def test_owner_isolation_and_spoofed_owner_rejected(client, app, assessment_payload):
    assessment, key = create_assessment(client, assessment_payload)
    sub = create_submission(client, submission_payload(assessment, key))
    spoofed = deepcopy(assessment_payload)
    spoofed["owner_id"] = str(OTHER)
    assert client.post("/v1/assessments", json=spoofed).status_code == 422
    app.dependency_overrides[get_principal] = lambda: Principal(OTHER, "aal2")
    for path in [f"assessments/{assessment['id']}", f"answer-keys/{key['id']}", f"submissions/{sub['id']}"]:
        assert client.get("/v1/" + path).status_code == 404
    assert client.get("/v1/assessments").json()["items"] == []
    assert client.post("/v1/submissions", json=submission_payload(assessment, key)).status_code == 404


def test_unresolved_and_blank_are_distinct(client, assessment_payload):
    assessment, key = create_assessment(client, assessment_payload)
    sub = create_submission(
        client,
        submission_payload(
            assessment,
            key,
            [{"number": 1, "state": "ambiguous", "value": "A/B"}, {"number": 2, "state": "blank_candidate"}],
        ),
    )
    assert sub["score"]["unresolved_numbers"] == [1, 2]
    response = client.put(
        f"/v1/submissions/{sub['id']}/answers",
        json={
            "expected_revision": 1,
            "answers": [
                {"number": 1, "state": "confirmed", "value": "A"},
                {"number": 2, "state": "confirmed_blank"},
            ],
        },
    )
    assert response.status_code == 200, response.text
    assert response.json()["score"]["final_score"] == "2.00"
    assert response.json()["score"]["unresolved_numbers"] == []
    assert (
        client.post(
            f"/v1/submissions/{sub['id']}/approve", json={"confirmed": True, "expected_revision": 2}
        ).status_code
        == 200
    )


def test_adjustments_preserve_automatic_score_and_reason(client, assessment_payload):
    assessment, key = create_assessment(client, assessment_payload)
    sub = create_submission(
        client,
        submission_payload(
            assessment,
            key,
            [{"number": 1, "state": "confirmed", "value": "B"}, {"number": 2, "state": "confirmed_blank"}],
        ),
    )
    response = client.post(
        f"/v1/submissions/{sub['id']}/adjustments",
        json={
            "expected_revision": 1,
            "adjustment": {"number": 1, "score": "1.50", "reason": "Teacher allowed partial credit"},
        },
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["score"]["automatic_score"] == "0.00"
    assert result["score"]["final_score"] == "1.50"
    assert result["adjustments"][0]["reason"] == "Teacher allowed partial credit"
    assert (
        client.post(
            f"/v1/submissions/{sub['id']}/adjustments",
            json={
                "expected_revision": 2,
                "adjustment": {"number": 1, "score": "3.00", "reason": "Too much credit"},
            },
        ).status_code
        == 422
    )
    result = client.post(
        f"/v1/submissions/{sub['id']}/approve", json={"confirmed": True, "expected_revision": 2}
    )
    assert result.status_code == 200
    assert (
        client.put(
            f"/v1/submissions/{sub['id']}/answers", json={"expected_revision": 3, "answers": []}
        ).status_code
        == 409
    )


def test_key_versions_preserve_historical_score(client, assessment_payload):
    assessment, key = create_assessment(client, assessment_payload)
    sub = create_submission(client, submission_payload(assessment, key), approved=True)
    new_key = deepcopy(assessment_payload["answer_key"])
    new_key["id"] = str(uuid4())
    new_key["questions"][0]["correct_answer"] = "B"
    response = client.post(f"/v1/assessments/{assessment['id']}/answer-keys", json=new_key)
    assert response.status_code == 201
    assert response.json()["version"] == 2
    result = client.get(f"/v1/submissions/{sub['id']}").json()
    assert result["score"]["answer_key_version"] == 1
    assert result["score"]["final_score"] == "3.00"


def test_incomplete_key_and_unrecognized_choice(client, assessment_payload):
    assessment_payload["answer_key"]["questions"][0]["correct_answer"] = None
    assessment, key = create_assessment(client, assessment_payload, verified=False)
    assert client.post(f"/v1/answer-keys/{key['id']}/verify", json={"confirmed": True}).status_code == 409
    assert (
        client.post(
            "/v1/scoring/preview",
            json={"answer_key_id": key["id"], "answers": [{"number": 999, "state": "confirmed_blank"}]},
        ).status_code
        == 422
    )


def test_pagination_archive_and_stale_revision(client, assessment_payload):
    assessment, key = create_assessment(client, assessment_payload)
    sub = create_submission(client, submission_payload(assessment, key))
    assert (
        client.post(
            f"/v1/submissions/{sub['id']}/approve", json={"confirmed": True, "expected_revision": 5}
        ).status_code
        == 409
    )
    assert client.get("/v1/assessments?limit=1").json()["has_more"] is False
    assert client.delete(f"/v1/assessments/{assessment['id']}").status_code == 200
    assert client.get("/v1/assessments").json()["items"] == []
    assert len(client.get("/v1/assessments?archived=true").json()["items"]) == 1
