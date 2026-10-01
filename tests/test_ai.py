import io
import json
from types import SimpleNamespace

import httpx
import pytest
from google.genai import errors
from PIL import Image

from app import schemas as s
from app.ai import Gemini


def image_bytes():
    output = io.BytesIO()
    Image.new("RGB", (32, 32), "white").save(output, format="PNG")
    return output.getvalue()


def provider_response(data):
    return SimpleNamespace(candidates=[SimpleNamespace(finish_reason="STOP")], text=json.dumps(data))


def draft_material():
    return {
        "title": "Fictional fractions lesson",
        "sections": [{"heading": "Explore", "body": "Compare paper halves."}],
        "quiz_questions": [],
        "rubric_criteria": [],
        "rewritten_text": None,
    }


def material_request():
    return {
        "kind": "lesson_plan",
        "topic": "Fractions",
        "student_level": "Grade 4",
        "objectives": ["Compare halves"],
    }


def test_real_adapter_ocr_validated_draft_and_multimodal_call(client, provider):
    provider.return_value = provider_response(
        {
            "items": [
                {
                    "number": 1,
                    "value": "A",
                    "state": "recognized",
                    "review_flags": ["teacher review"],
                    "notes": "Visible A",
                }
            ],
            "text": "",
            "notes": [],
        }
    )
    response = client.post("/v1/ocr/student", files={"file": ("fictional.png", image_bytes(), "image/png")})
    assert response.status_code == 200, response.text
    assert response.json()["status"] == "draft"
    assert response.json()["requires_teacher_review"] is True
    assert response.json()["provenance"]["model"] == "mock-model-not-a-live-result"
    args = provider.call_args.kwargs
    assert args["contents"][1].inline_data.mime_type == "image/jpeg"
    assert args["config"].response_json_schema["type"] == "object"
    assert "untrusted document CONTENT" in args["config"].system_instruction
    assert client.get("/v1/submissions").json()["items"] == []


@pytest.mark.parametrize("state,value", [("confirmed", "A"), ("recognized", None), ("blank_candidate", "B")])
def test_invalid_provider_answer_state_rejected(client, provider, state, value):
    provider.return_value = provider_response(
        {
            "items": [{"number": 1, "value": value, "state": state, "review_flags": [], "notes": ""}],
            "text": "",
            "notes": [],
        }
    )
    response = client.post("/v1/ocr/reference", files={"file": ("fictional.png", image_bytes(), "image/png")})
    assert response.status_code == 502


def test_invalid_images_and_mime_rejected_before_provider(client, provider):
    assert (
        client.post("/v1/ocr/student", files={"file": ("evil.svg", b"<svg/>", "image/svg+xml")}).status_code
        == 415
    )
    assert (
        client.post("/v1/ocr/student", files={"file": ("bad.png", b"not an image", "image/png")}).status_code
        == 422
    )
    assert (
        client.post("/v1/ocr/student", files={"file": ("bad.jpg", image_bytes(), "image/jpeg")}).status_code
        == 415
    )
    provider.assert_not_called()


def test_material_review_and_provenance_survive_edit(client, provider):
    provider.return_value = provider_response(draft_material())
    response = client.post("/v1/materials/generate", json=material_request())
    assert response.status_code == 201, response.text
    material = response.json()
    assert material["provenance"]["ai_generated"] is True
    edited = draft_material()
    edited["title"] = "Teacher edited fractions lesson"
    response = client.patch(
        f"/v1/materials/{material['id']}", json={"expected_revision": 1, "content": edited}
    )
    assert response.status_code == 200, response.text
    assert response.json()["original_content"]["title"] == material["content"]["title"]
    assert response.json()["provenance"] == material["provenance"]
    response = client.post(
        f"/v1/materials/{material['id']}/review", json={"expected_revision": 2, "confirmed": True}
    )
    assert response.json()["status"] == "reviewed"


@pytest.mark.parametrize(
    "exception,status,code",
    [
        (httpx.ReadTimeout("timeout"), 504, "ai_timeout"),
        (errors.ClientError(429, {"error": {"message": "quota"}}), 429, "ai_quota_exceeded"),
        (
            errors.ServerError(500, {"error": {"message": "provider secret message"}}),
            502,
            "ai_provider_error",
        ),
    ],
)
def test_provider_failures_do_not_save_materials(client, provider, exception, status, code):
    provider.side_effect = exception
    response = client.post("/v1/materials/generate", json=material_request())
    assert response.status_code == status, response.text
    assert response.json()["error"]["code"] == code
    assert "provider secret message" not in response.text
    assert client.get("/v1/materials").json()["items"] == []


def test_rate_limit_persists_after_provider_failure(client, app, provider):
    app.state.settings.ai_requests_per_minute = 1
    provider.side_effect = httpx.ReadTimeout("timeout")
    assert client.post("/v1/materials/generate", json=material_request()).status_code == 504
    response = client.post("/v1/materials/generate", json=material_request())
    assert response.status_code == 429
    assert response.headers["retry-after"] == "60"
    assert provider.call_count == 1


def test_semantically_incomplete_quiz_and_malformed_json_rejected(client, provider):
    provider.return_value = provider_response(draft_material())
    payload = material_request() | {"kind": "quiz"}
    assert client.post("/v1/materials/generate", json=payload).status_code == 502
    provider.return_value = SimpleNamespace(
        candidates=[SimpleNamespace(finish_reason="STOP")], text="not-json"
    )
    assert client.post("/v1/materials/generate", json=material_request()).status_code == 502
    assert client.get("/v1/materials").json()["items"] == []


def test_consultation_prompt_omits_identifiers(app, provider):
    from datetime import datetime, timezone
    from uuid import uuid4

    provider.return_value = provider_response(
        {"summary": "Insufficient evidence", "practice_suggestions": [], "limitations": []}
    )
    report = s.PerformanceOut(
        student_id=uuid4(),
        subject_id=uuid4(),
        term_id=uuid4(),
        calculated_at=datetime.now(timezone.utc),
        thresholds=s.Thresholds(),
        enrollments=[],
        assessments=[],
        learning_areas=[],
        expected_assessments=[],
        untagged_evaluated_questions=0,
        notices=["No evidence"],
        suggested_next_steps=[],
        trend_percentage_points=None,
    )
    Gemini(app.state.settings).consultation(report)
    sent = provider.call_args.kwargs["contents"][0]
    assert str(report.student_id) not in sent
    assert str(report.subject_id) not in sent
    assert str(report.term_id) not in sent
