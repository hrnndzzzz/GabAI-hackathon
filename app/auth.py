"""Supabase validates the bearer token; TeachEase never issues tokens or handles passwords."""

import base64
import json
from dataclasses import dataclass
from uuid import UUID

import httpx
from fastapi import Depends, Request
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.errors import fail

bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class Principal:
    id: UUID
    aal: str


def get_principal(request: Request, credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
    if credentials is None or credentials.scheme.lower() != "bearer":
        fail(401, "authentication_required", "A Supabase access token is required")
    settings = request.app.state.settings
    if not settings.supabase_url or not settings.supabase_publishable_key.get_secret_value():
        fail(503, "auth_unavailable", "Supabase Auth is not configured")
    token = credentials.credentials
    if len(token) > 16384:
        fail(401, "invalid_token", "Access token is invalid or expired")
    try:
        # The Auth server verifies signature, expiry and account state, including banned/deleted users.
        response = request.app.state.auth_http.get(
            settings.supabase_url.rstrip("/") + "/auth/v1/user",
            headers={
                "apikey": settings.supabase_publishable_key.get_secret_value(),
                "Authorization": f"Bearer {token}",
            },
        )
    except httpx.RequestError:
        fail(503, "auth_unavailable", "Supabase Auth verification is temporarily unavailable")
    if response.status_code in (401, 403):
        fail(401, "invalid_token", "Access token is invalid or expired")
    if response.status_code != 200:
        fail(503, "auth_unavailable", "Supabase Auth verification is temporarily unavailable")
    try:
        user = response.json()
        # Only read claims AFTER the same token has been verified by Supabase, never as authentication itself.
        part = token.split(".")[1]
        claims = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
        identity = UUID(user["id"])
        if (
            str(identity) != claims["sub"]
            or claims.get("role") != "authenticated"
            or user.get("is_anonymous")
        ):
            raise ValueError("Not a registered authenticated user")
        aal = claims.get("aal", "aal1")
    except (ValueError, KeyError, IndexError, TypeError):
        fail(401, "invalid_token", "Access token is invalid or expired")
    if settings.require_mfa and aal != "aal2":
        fail(403, "mfa_required", "Complete Supabase MFA and send the refreshed aal2 access token")
    return Principal(identity, aal)
