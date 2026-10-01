from uuid import UUID, uuid4

import pytest
from fastapi.testclient import TestClient

from app.auth import Principal, get_principal
from app.config import Settings
from app.main import create_app

TEACHER = UUID("11111111-1111-4111-8111-111111111111")
OTHER = UUID("22222222-2222-4222-8222-222222222222")


@pytest.fixture
def provider(monkeypatch):
    """Mock Google at its client boundary; production adapter still validates every response."""
    from unittest.mock import MagicMock

    client = MagicMock()
    client.__enter__.return_value = client
    monkeypatch.setattr("app.ai.genai.Client", MagicMock(return_value=client))
    return client.models.generate_content


@pytest.fixture
def app(tmp_path):
    settings = Settings(
        app_env="test",
        database_url=f"sqlite:///{tmp_path / 'test.db'}",
        supabase_url="https://fictional.supabase.co",
        supabase_publishable_key="test-key",
        gemini_api_key="test-key",
        gemini_model="mock-model-not-a-live-result",
        _env_file=None,
    )
    return create_app(settings)


@pytest.fixture
def client(app):
    app.dependency_overrides[get_principal] = lambda: Principal(TEACHER, "aal2")
    with TestClient(app) as client:
        yield client


@pytest.fixture
def assessment_payload():
    return {
        "id": str(uuid4()),
        "title": "Fictional fractions quiz",
        "template_id": "mcq-v1",
        "assessment_date": "2026-09-15",
        "answer_key": {
            "id": str(uuid4()),
            "questions": [
                {
                    "number": 1,
                    "kind": "multiple_choice",
                    "points": "2.00",
                    "choices": ["A", "B", "C", "D"],
                    "correct_answer": "A",
                },
                {"number": 2, "kind": "true_false", "points": "1.00", "correct_answer": "True"},
            ],
        },
    }


def create_assessment(client, payload, verified=True):
    response = client.post("/v1/assessments", json=payload)
    assert response.status_code == 201, response.text
    assessment = response.json()
    key = assessment["answer_keys"][0]
    if verified:
        response = client.post(f"/v1/answer-keys/{key['id']}/verify", json={"confirmed": True})
        assert response.status_code == 200, response.text
    return assessment, key


def submission_payload(assessment, key, answers=None):
    return {
        "id": str(uuid4()),
        "assessment_id": assessment["id"],
        "answer_key_id": key["id"],
        "student_label": "Fictional Learner A",
        "source": "on_device",
        "answers": answers
        if answers is not None
        else [
            {"number": 1, "state": "confirmed", "value": "a"},
            {"number": 2, "state": "confirmed", "value": "T"},
        ],
    }


def create_submission(client, payload, approved=False):
    response = client.post("/v1/submissions", json=payload)
    assert response.status_code == 201, response.text
    result = response.json()
    if approved:
        response = client.post(
            f"/v1/submissions/{result['id']}/approve",
            json={"confirmed": True, "expected_revision": result["revision"]},
        )
        assert response.status_code == 200, response.text
        result = response.json()
    return result
