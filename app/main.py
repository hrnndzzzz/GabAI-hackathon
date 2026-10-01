import json
import logging
from contextlib import asynccontextmanager
from threading import BoundedSemaphore
from uuid import uuid4

import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError, OperationalError
from starlette.exceptions import HTTPException

from app.ai import Gemini
from app.config import Settings, get_settings
from app.db import make_engine
from app.errors import DomainError
from app.models import Base
from app.routes import router
from app.schemas import ErrorResponse


class RequestGuard:
    """Bound bodies before multipart parsing; never log tokens, request bodies, names or grades."""

    def __init__(self, app, limit):
        self.app, self.limit = app, limit

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        request_id = str(uuid4())
        scope.setdefault("state", {})["request_id"] = request_id
        data = bytearray()
        # Buffers at most MAX_REQUEST_BYTES. Rejects chunked oversized bodies too.
        while True:
            message = await receive()
            if message["type"] == "http.disconnect":
                return
            chunk = message.get("body", b"")
            if len(data) + len(chunk) > self.limit:
                response = JSONResponse(
                    {
                        "error": {
                            "code": "request_too_large",
                            "message": "Request exceeds byte limit",
                            "request_id": request_id,
                        }
                    },
                    status_code=413,
                    headers={"Cache-Control": "no-store", "X-Request-ID": request_id},
                )
                return await response(scope, receive, send)
            data.extend(chunk)
            if not message.get("more_body", False):
                break
        sent_body = False

        async def bounded_receive():
            nonlocal sent_body
            if not sent_body:
                sent_body = True
                return {"type": "http.request", "body": bytes(data), "more_body": False}
            return await receive()

        started = False

        async def secure_send(message):
            nonlocal started
            if message["type"] == "http.response.start":
                started = True
                headers = list(message.get("headers", []))
                headers.extend(
                    [
                        (b"x-request-id", request_id.encode()),
                        (b"cache-control", b"no-store"),
                        (b"x-content-type-options", b"nosniff"),
                        (b"referrer-policy", b"no-referrer"),
                        (b"strict-transport-security", b"max-age=31536000; includeSubDomains"),
                    ]
                )
                message["headers"] = headers
            await send(message)

        try:
            await self.app(scope, bounded_receive, secure_send)
        except Exception as exc:
            # Do not let Uvicorn log arbitrary exceptions/SQL parameters containing student data.
            logging.getLogger("teachease").error(
                "request_failed request_id=%s exception_type=%s", request_id, type(exc).__name__
            )
            if not started:
                response = JSONResponse(
                    {
                        "error": {
                            "code": "internal_error",
                            "message": "Unexpected server error; reference the request ID when reporting",
                            "request_id": request_id,
                        }
                    },
                    status_code=500,
                )
                await response(scope, receive, secure_send)


def create_app(settings: Settings | None = None):
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app):
        if settings.app_env in ("local", "test") and app.state.engine.dialect.name == "sqlite":
            Base.metadata.create_all(app.state.engine)
        if settings.app_env == "production":
            # Fail closed if deployment accidentally uses postgres/service credentials.
            with app.state.engine.connect() as conn:
                role = conn.execute(
                    text(
                        "SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user"
                    )
                ).one()
                if role[0] != "teachease_login" or role[1] or role[2]:
                    raise RuntimeError(
                        "Production database must use the dedicated non-bypass teachease_login"
                    )
                conn.execute(text("SET LOCAL ROLE teachease_api"))
                if (
                    conn.execute(
                        text(
                            "SELECT count(*) FROM pg_class WHERE relname='submissions' AND relrowsecurity AND relforcerowsecurity"
                        )
                    ).scalar_one()
                    != 1
                ):
                    raise RuntimeError("Apply the TeachEase RLS migrations before starting production")
        yield
        app.state.auth_http.close()
        app.state.engine.dispose()

    errors = {
        code: {"model": ErrorResponse}
        for code in [401, 403, 404, 409, 413, 415, 422, 429, 500, 502, 503, 504]
    }
    app = FastAPI(
        title="TeachEase Backend",
        version="0.1.0",
        lifespan=lifespan,
        responses=errors,
        description="Teacher-controlled assessment review. OCR and Gemini generation are ONLINE only. Phone offline work requires no backend login. All /v1 routes require Supabase access tokens; production requires aal2.",
    )
    app.state.settings = settings
    app.state.engine = make_engine(settings)
    app.state.auth_http = httpx.Client(timeout=10, follow_redirects=False)
    app.state.ai = Gemini(settings)
    app.state.ocr_slots = BoundedSemaphore(settings.max_concurrent_ocr)
    app.add_middleware(RequestGuard, limit=settings.max_request_bytes)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type"],
        expose_headers=["X-Request-ID", "Retry-After"],
    )

    def error(request, status, code, message):
        headers = {"Cache-Control": "no-store"}
        if status == 401:
            headers["WWW-Authenticate"] = "Bearer"
        if status == 429:
            headers["Retry-After"] = "60"
        return JSONResponse(
            {
                "error": {
                    "code": code,
                    "message": message,
                    "request_id": getattr(request.state, "request_id", str(uuid4())),
                }
            },
            status_code=status,
            headers=headers,
        )

    @app.exception_handler(DomainError)
    async def domain_error(request, exc):
        return error(request, exc.status, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def validation_error(request, exc):
        # Pydantic's default response can echo sensitive input; expose paths/types only.
        fields = [{"path": ".".join(map(str, e["loc"])), "type": e["type"]} for e in exc.errors()]
        return error(request, 422, "validation_error", json.dumps(fields))

    @app.exception_handler(IntegrityError)
    async def conflict(request, exc):
        return error(
            request,
            409,
            "record_conflict",
            "Identifier already exists or a database relationship/constraint conflicts",
        )

    @app.exception_handler(OperationalError)
    async def database_unavailable(request, exc):
        return error(request, 503, "database_unavailable", "Database is temporarily unavailable")

    @app.exception_handler(HTTPException)
    async def http_error(request, exc):
        return error(request, exc.status_code, "http_error", "Request could not be handled")

    @app.exception_handler(Exception)
    async def internal_error(request, exc):
        return error(
            request, 500, "internal_error", "Unexpected server error; reference the request ID when reporting"
        )

    @app.get("/health", tags=["Health"])
    def health() -> dict[str, str]:
        return {"status": "ok", "service": "teachease", "version": "0.1.0"}

    @app.get("/health/ready", tags=["Health"])
    def ready(request: Request) -> dict[str, str]:
        with app.state.engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        return {"status": "ready"}

    app.include_router(router)
    return app


app = create_app()
