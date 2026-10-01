# Verification and remaining live checks

Updated on 2026-10-02 after adding Excel/CSV roster imports. This is a backend implementation and local verification report, not a claim that a live production system or Android offline workflow has been tested.

The full-suite results below describe the roster implementation run; additional readiness checks were tested separately during database troubleshooting.

## Executed successfully

| Check | Result |
|---|---|
| Full pytest suite | **93 passed**, no skips in the combined run |
| Python application statement coverage | **93%** (1,843 statements; 128 not exercised) |
| Real PostgreSQL integration tests | **11 passed** within the full suite; PostgreSQL 17.11 |
| Remaining API/domain/provider-adapter tests | **82 passed**; isolated SQLite databases and explicit provider/auth mocks |
| Ruff | All checks passed |
| Installed dependency consistency | `pip check`: no broken requirements |
| OpenAPI drift | Export matches the running application: 48 paths, 72 operations |
| API handoff examples | All 36 JSON request examples validate against their Pydantic request schemas |
| Roster database migration | Applied and verified in local PostgreSQL and hosted Supabase; hosted runtime connectivity remains unresolved |
| Git | Existing working-tree changes preserved; roster feature not committed |

The final combined command was:

```powershell
.\.venv\Scripts\python scripts/local_postgres.py -q --cov=app --cov-report=term-missing -p no:cacheprovider
```

The portable Windows helper requires PostgreSQL binaries already present under ignored `.tools/pgsql`. It starts a disposable password-protected test database listening only on `127.0.0.1:55432`, supplies the test URLs, uses unique workspace-local temporary directories and stops PostgreSQL in `finally`. The successful run confirmed shutdown. No Windows service was installed. Downloaded tools, test cluster and credentials remain excluded by `.gitignore`.

The tests cover:

- Missing/invalid token rejection, Supabase verification request behavior, MFA enforcement, spoofed owner rejection and cross-teacher access to assessments, submissions, students and materials.
- Forced RLS on every domain table; denial for Supabase frontend roles; select/insert/update/delete teacher isolation; same-owner foreign keys; restricted production database login; immutable approved scores, key evidence, provenance and consultation snapshots.
- Known MCQ/True-False decimal scores, accepted alternatives, blanks versus recognition uncertainty, teacher adjustment reasons, manual essay scores and historical key versions.
- Atomic upload rollback, identical retry deduplication, different-content conflicts, per-item/client-total validation, and simultaneous PostgreSQL upload retries.
- Real Gemini adapter calls at a mocked Google client boundary: structured multimodal request construction, draft validation, invalid output rejection, provider timeout/quota errors, no false-success persistence, rate limits, image validation and OCR concurrency limits.
- Class filters, dated enrollment moves, selected student/subject/term reports, approved-only evidence, missing/pending/zero distinctions, learning-gap thresholds and evidence, latest-approved-attempt selection, optional-AI failure independence and identifier omission from consultation prompts.
- Sanitized unexpected error responses/logs and rejection of sensitive unknown input without echoing its values.
- Excel/CSV roster previews and atomic imports; leading-zero identifiers; Unicode names; grade/year/section grouping; invalid emails, duplicate numbers, conflicting existing data and formula rejection; ZIP/XML/row/file bounds; teacher isolation; unchanged retries and concurrent PostgreSQL imports; rollback after receipt conflicts; preservation of historical enrollments; explicit local SQLite upgrade without record loss.

Two dependency deprecation warnings remain: Starlette warns about its HTTPX TestClient integration, and the Google SDK references a Python typing alias slated for removal in Python 3.17. Neither failed tests on Python 3.14.5. They should be reviewed during dependency upgrades.

## Not verified here

- **Live Supabase Auth:** Tests mock its HTTP responses. The real PostgreSQL tests use minimal Supabase-compatible `auth.uid()`/user tables, not the hosted Auth service. Real email verification, MFA enrollment/recovery, expired/revoked sessions and project settings require a configured project.
- **Live Gemini:** The integration is implemented with the official SDK, but every provider response in tests is a clearly labeled mock. No claim is made about actual handwriting accuracy, supported model availability in a particular account, quota, latency or output quality.
- **Remote runtime:** No remote application, runtime identity, billing or secret-store configuration was tested.
- **Android offline capability:** No Flutter, Dart or native Android implementation is included. Shared scoring fixtures are supplied, but camera/alignment/recognition/local encryption/offline sign-in behavior and APK functionality need frontend/device testing.
- **Retained images and official term grades:** Optional image storage is deliberately disabled; official grading formulas are not implemented. Neither is needed for result-only uploads or numerical evidence reports.

## Live acceptance before real student data

1. Apply migrations to the intended Supabase project, configure the restricted runtime login and encrypted connection, and verify MFA/email/auth rate-limit settings.
2. With two real test teacher accounts, confirm unauthenticated 401, aal1 403, aal2 success, and mutual isolation through both FastAPI and direct Supabase REST attempts. Repeat with expired/deleted-account tokens.
3. Use fictional printed/handwritten images with the configured Gemini model. Check reference blanks, competing marks, unreadable text, transcription and draft-only outputs. Test quota and timeout handling without grading any real student automatically.
4. Run a generated quiz, lesson rewrite and optional consultation draft through teacher edit/review. Confirm provenance survives and official-grade claims are absent.
5. Exercise a result-only offline upload from Flutter, resend it after simulating a lost response, and confirm no duplication, score drift or image transmission. Run `scoring-v1.json` in Dart.
