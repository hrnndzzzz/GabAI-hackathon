from tests.test_ai import (
    draft_material,
    image_bytes,
    material_request,
    provider_response,
)


def test_image_pixel_limit_and_concurrency_limit(client, app, provider):
    app.state.settings.max_image_pixels = 1000
    response = client.post("/v1/ocr/student", files={"file": ("large.png", image_bytes(), "image/png")})
    assert response.status_code == 413
    app.state.settings.max_image_pixels = 20000000
    slots = app.state.ocr_slots
    for _ in range(app.state.settings.max_concurrent_ocr):
        assert slots.acquire(blocking=False)
    try:
        response = client.post(
            "/v1/ocr/student", files={"file": ("fictional.png", image_bytes(), "image/png")}
        )
        assert response.status_code == 429
        assert response.json()["error"]["code"] == "ocr_busy"
    finally:
        for _ in range(app.state.settings.max_concurrent_ocr):
            slots.release()
    provider.assert_not_called()


def test_cross_owner_material_cannot_be_read_or_modified(client, app, provider):
    from app.auth import Principal, get_principal
    from tests.conftest import OTHER

    provider.return_value = provider_response(draft_material())
    material = client.post("/v1/materials/generate", json=material_request()).json()
    app.dependency_overrides[get_principal] = lambda: Principal(OTHER, "aal2")
    assert client.get(f"/v1/materials/{material['id']}").status_code == 404
    assert (
        client.patch(
            f"/v1/materials/{material['id']}", json={"expected_revision": 1, "content": draft_material()}
        ).status_code
        == 404
    )


def test_unexpected_errors_do_not_log_sensitive_exception_content(app, caplog):
    from fastapi.testclient import TestClient

    @app.get("/test-only-error")
    def failure():
        raise RuntimeError("Fictional student grade must not appear in a log")

    with TestClient(app) as client:
        response = client.get("/test-only-error")
    assert response.status_code == 500
    assert "Fictional student grade" not in response.text
    assert "Fictional student grade" not in caplog.text
    assert "exception_type=RuntimeError" in caplog.text
