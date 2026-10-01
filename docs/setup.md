# Setup and deployment

## Local development

Follow the README virtualenv setup. `.env.example` contains placeholders/defaults only; `.env`, local databases and tool downloads are ignored by Git. `APP_ENV=local` creates SQLite tables for development but still uses real Supabase Auth for requests. Unit/API tests provide explicit mocked identities and Google responses.

Set `GEMINI_MODEL` to an image-input, structured-output model available to your project. `gemini-3.1-flash-lite` is a documented stable model supporting both capabilities as checked on 2026-10-01; it is an initial choice, not a hardcoded default or quality guarantee. Evaluate handwritten examples and change the environment variable as needed. The app records the configured model in each draft's provenance. See [Google's model specification](https://ai.google.dev/gemini-api/docs/models/gemini-3.1-flash-lite), [current model catalog](https://ai.google.dev/gemini-api/docs/models) and [deprecations](https://ai.google.dev/gemini-api/docs/deprecations).

The adapter uses the official `google-genai` Python client, `models.generate_content`, inline sanitized image bytes, `response_json_schema`, and independent Pydantic validation. Model/schema/network failures are exposed as errors rather than invented fallback output. A missing Gemini configuration disables only AI endpoints.

## Supabase database

1. Create/select the intended Supabase project. Configure Auth and MFA following `security.md`.
2. Apply `supabase/migrations/0001_schema.sql`, then `0002_security.sql` through the SQL editor or the included migration runner. **Do not** apply `tests/postgres_bootstrap.sql` to Supabase; real Supabase already owns `auth.users`, `auth.uid()` and its Auth roles.
3. For the runner, set `MIGRATION_DATABASE_URL` to an administrator **libpq** URL (`postgresql://...`, not SQLAlchemy's `+psycopg`) and run `python scripts/migrate.py`. This is an explicit operator command, never a startup action. It uses a migration ledger and advisory lock. After running, remove the admin URL from the shell/session.
4. Provision a unique strong password for `teachease_login` through an authorized secure database administration channel. Its role is created without a password. Do not commit this statement or password to scripts. It is `NOINHERIT`, `NOSUPERUSER`, `NOBYPASSRLS`, a member only of `teachease_api` (apart from required platform memberships).
5. Configure runtime `DATABASE_URL=postgresql+psycopg://teachease_login:<URL-encoded-password>@<host>:5432/postgres?sslmode=require`. Prefer verified TLS with `sslmode=verify-full` and the appropriate CA configuration when available. Use Supabase's documented connection host/network option. For a session pooler, its user naming may need project qualification; confirm `current_user` inside the database is `teachease_login`. Startup fails closed for another current user.
6. Set `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `REQUIRE_MFA=true`. The publishable key identifies the Auth project; it grants no privileged table access. No service-role key is needed.
7. Verify the application can connect, call authenticated `/v1/me`, and read/write only the signed-in teacher's records. Test a second real teacher account. Check the restricted runtime role and forced RLS flags.

The migration tables use UUIDs, owner FKs to `auth.users`, composite same-owner references, indexes and constraints. Tables are denied to Supabase frontend REST roles to prevent bypassing application approval rules. SQLite's `create_all` is deliberately not used in production.

## Real PostgreSQL integration tests

Use a **new disposable database**. The local test bootstrap supplies minimal Supabase Auth-compatible SQL objects; it is not a replacement for live Supabase Auth verification.

```powershell
$env:TEST_POSTGRES_URL = 'postgresql://postgres:TEST_PASSWORD@127.0.0.1:5432/teachease_test'
$env:MIGRATION_DATABASE_URL = $env:TEST_POSTGRES_URL
python scripts/bootstrap_test_db.py
python scripts/migrate.py
python -m pytest -m postgres -q
```

The bootstrap refuses an existing `auth` schema. It creates test-only roles and fictional auth users. The tests verify actual PostgreSQL RLS allow/deny behavior, composite owner FKs, history triggers, concurrent upload retries and transaction rollback. `.github/workflows/backend.yml` runs them against PostgreSQL 17, also builds the container and checks exported contract drift.

Regenerate contract exports only after intentional schema/route changes: `python scripts/export_contracts.py`. Before the initial release the generated 0001 migration can be regenerated; after any shared environment applies it, add a new numbered migration instead of editing an applied file. Refresh dependency locks deliberately in a clean environment with `scripts/lock_dependencies.py` and review upgrades.

## Cloud Run

The container runs as an unprivileged user, binds to `0.0.0.0:$PORT` and stores no durable records locally. Cloud Run terminates HTTPS. Use the private Artifact Registry image digest and a dedicated runtime service account.

1. Build: `docker build -t REGION-docker.pkg.dev/PROJECT/REPOSITORY/teachease:VERSION .`
2. Push the reviewed image using your configured Artifact Registry credentials.
3. Create Secret Manager versions for the restricted database URL, Gemini key and Supabase publishable key. Give only the runtime service account secret-access permission for these secrets.
4. Copy `deploy/cloudrun.yaml`, replace placeholder project/image/service account/origins/URL/model fields and secret version references. Set the model explicitly. Do not insert secret values into YAML.
5. Deploy: `gcloud run services replace deploy/cloudrun.yaml --region REGION` after replacement/review.
6. Mobile clients normally require the Cloud Run service to permit public invocation at the transport layer (`roles/run.invoker` for `allUsers`), with Supabase bearer authentication enforced by FastAPI. This IAM publication is a deliberate operator action, not performed by the repository or an automatic pipeline. An organization may instead place an authenticated gateway in front.
7. Verify liveness `/health`, readiness `/health/ready`, an unauthenticated protected 401, aal1 403, and two-account isolation before real data use. Check Gemini with a fictional paper/material. Perform the live smoke checklist below.

Default limits: up to 3 instances × 5 database connections; AI rate counters are stored in PostgreSQL and remain shared across instances. Set pool/instance limits to the actual Supabase connection budget. HTTP provider timeout is 45 seconds; Cloud Run request timeout is 180 seconds. Do not enable access logs containing student URLs or sensitive request/response-body logging.

`MAX_CONCURRENT_OCR=2` bounds simultaneous image decoding and provider work per instance; busy instances return 429. Tune this together with the decoded pixel limit and container memory. Numerical reports remain available without Gemini.

Cloud Run configuration follows its [container runtime contract](https://docs.cloud.google.com/run/docs/container-contract). No automatic infrastructure provisioning, secret creation, public IAM changes or live deployment has been performed.
