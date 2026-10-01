import base64
import json
from uuid import uuid4

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from tests.conftest import TEACHER


def fake_token(claims):
    # NOT a real JWT; usable only with a mocked successful Supabase verification response.
    payload = base64.urlsafe_b64encode(json.dumps(claims).encode()).decode().rstrip("=")
    return f"test-header.{payload}.fake-signature"


@pytest.mark.parametrize(
    "path", ["/v1/me", "/v1/assessments", "/v1/students", "/v1/materials", "/v1/consultations"]
)
def test_missing_auth_denied(app, path):
    with TestClient(app) as client:
        response = client.get(path)
        assert response.status_code == 401
        assert response.headers["www-authenticate"] == "Bearer"
        assert "no-store" in response.headers["cache-control"]


def test_auth_delegates_verification_to_supabase_and_enforces_mfa(app):
    calls = []

    def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"id": str(TEACHER), "is_anonymous": False})

    app.state.auth_http.close()
    app.state.auth_http = httpx.Client(transport=httpx.MockTransport(handler))
    with TestClient(app) as client:
        token = fake_token({"sub": str(TEACHER), "role": "authenticated", "aal": "aal1"})
        response = client.get("/v1/me", headers={"Authorization": "Bearer " + token})
        assert response.status_code == 403
        assert response.json()["error"]["code"] == "mfa_required"
        token = fake_token({"sub": str(TEACHER), "role": "authenticated", "aal": "aal2"})
        assert client.get("/v1/me", headers={"Authorization": "Bearer " + token}).status_code == 200
        token = fake_token({"sub": str(uuid4()), "role": "authenticated", "aal": "aal2"})
        assert client.get("/v1/me", headers={"Authorization": "Bearer " + token}).status_code == 401
        assert calls[0].url.path == "/auth/v1/user"
        assert calls[0].headers["apikey"] == "test-key"


@pytest.mark.parametrize("status,expected", [(401, 401), (403, 401), (429, 503), (500, 503)])
def test_rejected_and_unavailable_auth_fail_closed(app, status, expected):
    app.state.auth_http.close()
    app.state.auth_http = httpx.Client(transport=httpx.MockTransport(lambda req: httpx.Response(status)))
    with TestClient(app) as client:
        response = client.get("/v1/me", headers={"Authorization": "Bearer forged-or-expired"})
        assert response.status_code == expected


def test_production_requires_mfa_postgres_and_explicit_cors():
    with pytest.raises(ValueError):
        Settings(app_env="production", _env_file=None)
    with pytest.raises(ValueError):
        Settings(cors_origins=["*"], _env_file=None)
    with pytest.raises(ValueError):
        Settings(
            app_env="production",
            database_url="postgresql+psycopg://host/db",
            supabase_url="https://example.supabase.co",
            supabase_publishable_key="test",
            require_mfa=False,
            _env_file=None,
        )


def test_request_limit_and_sensitive_validation_input_not_echoed(client, app):
    response = client.post("/v1/assessments", json={"password": "do-not-echo-this-secret"})
    assert response.status_code == 422
    assert "do-not-echo-this-secret" not in response.text
    response = client.post("/v1/ocr/student", content=b"x" * (app.state.settings.max_request_bytes + 1))
    assert response.status_code == 413


def test_cross_owner_student_access(client, app):
    from app.auth import Principal, get_principal
    from tests.conftest import OTHER

    response = client.post("/v1/students", json={"display_name": "Fictional Learner"})
    identifier = response.json()["id"]
    app.dependency_overrides[get_principal] = lambda: Principal(OTHER, "aal2")
    assert client.get(f"/v1/students/{identifier}").status_code == 404
    assert client.patch(f"/v1/students/{identifier}", json={"display_name": "Tampered"}).status_code == 404
    assert client.get("/v1/students").json()["items"] == []
