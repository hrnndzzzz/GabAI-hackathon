# TeachEase backend

FastAPI backend for the RAITE 2026 “AI in Education” hackathon. Teachers verify answer keys, correct recognition, approve scores, edit materials and review consultation drafts. No Flutter or native Android code is included.

Implemented: Supabase Auth verification and MFA enforcement; teacher-scoped assessments and immutable answer-key versions; deterministic MCQ/True-False scoring; manual rubric-based essay scores; submissions, adjustments and explicit approval; atomic, idempotent offline uploads; real online Gemini OCR and teaching generation; class/student/enrollment history; competency evidence and term consultations; PostgreSQL RLS; tests and Cloud Run configuration.

## Run locally

Python 3.12+ (tested locally with 3.14). In PowerShell:

```powershell
python -m venv .venv
.\.venv\Scripts\python -m pip install -r requirements-dev.lock
.\.venv\Scripts\python -m pip install --no-deps -e .
Copy-Item .env.example .env
# Fill Supabase settings; set GEMINI_MODEL and GEMINI_API_KEY for online AI.
.\.venv\Scripts\python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --no-access-log
```

macOS/Linux: use `.venv/bin/python` in place of `.venv\Scripts\python`. `/health`, `/health/ready`, `/docs`, `/redoc` and `/openapi.json` are available. Local SQLite schema is created at startup. Local mode **does not bypass login**. Supabase is needed for authenticated manual requests; tests override authentication explicitly and never install that override in the app.

Run tests and lint:

```powershell
.\.venv\Scripts\python -m pytest -q
.\.venv\Scripts\ruff check app tests scripts
```

Without `TEST_POSTGRES_URL`, PostgreSQL integration tests are explicitly skipped. SQLite is for local development/tests; production uses Supabase PostgreSQL and the provided migrations.

## Frontend handoff

- [Frontend integration guide](docs/frontend-integration.md): routes, workflows, upload ordering and error handling.
- [API reference](docs/api.md) and [exported OpenAPI](docs/openapi.json): request/response contracts and status codes.
- [Shared scoring specification](docs/scoring.md) and [hand-calculated fixtures](fixtures/scoring-v1.json): port the algorithm to Dart and run these fixtures on-device.
- [Fictional request examples](fixtures/api-examples.json).
- [Architecture and trust boundaries](docs/architecture.md).
- [Supabase setup, migrations and Cloud Run deployment](docs/setup.md).
- [Security controls and deployment requirements](docs/security.md).
- [Verification status and limitations](docs/verification.md).

All `/v1` endpoints require a verified Supabase access token. Production requires `aal2` MFA. The backend never handles teacher passwords or issues its own JWTs. Keep database credentials and the Gemini key on the server. No Supabase service-role key is required.

Gemini OCR is **online OCR**. Offline recognition, scoring, local saving and access without network login belong to the phone implementation. Uploading results does not send paper images to Gemini. Backend tests do not demonstrate offline Android capability.

Images are transient in this release: validated, decoded, stripped of metadata, sent to Gemini only on an explicit OCR call, then discarded. Retained image storage is optional and is not enabled. No official term grades, unrestricted identification/numerical matching, AI essay grading, student portal or background sync are implemented.

No live Supabase project, Gemini account or Cloud Run deployment is provisioned by these files. Configure credentials and complete the live checks in `docs/verification.md` before using real student records.
