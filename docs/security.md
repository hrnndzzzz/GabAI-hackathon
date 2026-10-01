# Security for teacher login and student records

## Implemented controls

- Supabase Auth token verification on every protected request; no custom password database or JWT issuer, no production auth bypass, no tokens accepted from URL query parameters.
- MFA `aal2` required by default and mandatory in production settings. Production refuses SQLite, insecure Auth URLs and an administrator database login.
- Identity and owner are taken from the verified token, not request bodies or editable user metadata. Unknown fields (including `owner_id` and fabricated approval fields) are rejected.
- Teacher ownership checks in application queries, forced PostgreSQL RLS on all domain/rate tables, same-owner composite foreign keys, and no direct frontend database grants. Foreign-owner record requests return 404.
- Row locks and revision checks for review mutations; immutable key/question history; approved grade protection; adjustment actor and reason; provenance/snapshot protection; atomic upload receipts with conflict detection.
- Request/image byte and decoded pixel limits; bounded simultaneous OCR decoding/provider work; type/signature/decoding validation; no SVG, animation, external image URLs or remote fetch URLs.
- Persistent per-teacher AI limits across workers/instances, finite provider timeout, no implicit Gemini retries, explicit errors and no false success saves.
- Configured CORS allowlist; no cookies or session passwords handled by FastAPI; no credentialed wildcard CORS.
- No-store responses, HSTS on deployed HTTPS, MIME sniffing prevention, generic sensitive error responses and request IDs. The supplied runtime disables access logs to avoid student IDs in URL logs. Unexpected application exceptions log only the request ID and exception class, excluding arbitrary exception text and SQL parameters.
- AI provenance is server-generated and retained after edits. Consultation prompts exclude identifiers and teacher notes using an explicit field whitelist.

## Required Supabase project configuration

These are configuration steps, not claims that a live project has been hardened:

1. Enable email verification for password signup. Configure strong passwords and leaked-password protection if available on the project plan. Supabase owns this flow; do not create a FastAPI `/login` password endpoint.
2. Enable TOTP MFA, implement enrollment/challenge/verification in Flutter, and require the resulting `aal2` session for TeachEase APIs. Test recovery and lost-device handling before rollout.
3. Configure Supabase Auth signup/login/reset rate limits and CAPTCHA for public auth flows. Restrict redirect URLs to the actual application. Choose appropriate session lifetime and inactivity/single-session settings for the deployment plan.
4. Apply both database migrations, use only the restricted runtime login, require encrypted database connections, and keep administrator credentials out of Cloud Run. If using a Supabase pooler, use session mode unless transaction-mode prepared statements have been explicitly configured/tested.
5. Store Gemini/database secrets in Secret Manager and scope its access to the runtime service account. Set billing quotas/budgets and rotate credentials as needed. Do not include secrets in the APK, `.env.example`, Git, logs or screenshots.
6. Disable unnecessary Supabase exposed schemas/features; verify direct REST access cannot access these tables. Do not add broad `authenticated` write grants later.

## Operating with sensitive educational data

Use fictional data during development. Obtain appropriate school authorization before using real student records and before sending any paper/lesson content to a third-party AI provider. Check the provider account's actual data-handling terms. Choose regions, backups, retention and access review appropriate to the institution. A name-free aggregate may still contain identifying text in teacher-entered competency labels; use curriculum topic labels, not personal information.

The frontend should protect locally stored grades and tokens with platform secure storage/encryption, device locking and an intentional offline-user/workspace boundary. Backend MFA does not protect an unlocked phone's local files. Local access remains possible without a network login as requested.

No public student portal is provided. Approved records are append-only through this API; deletion/retention or correction of wrongly associated student data requires a separately authorized, audited administration procedure. A school-wide audit export, account lifecycle UI and automatic retention jobs are outside this first backend.

No live security audit or penetration test is claimed. Run the real Supabase smoke tests and review deployment IAM, database role membership, auth settings and storage exposure before production.

References: [Supabase token validation](https://supabase.com/docs/reference/python/auth-getuser), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security), [password security](https://supabase.com/docs/guides/auth/password-security), [MFA assurance levels](https://supabase.com/docs/guides/auth/auth-mfa).
