# Flutter team integration

Base URL is the HTTPS API service; routes are under `/v1`. `/docs` provides interactive Swagger UI; checked-in `openapi.json` can generate Dart clients. All payloads reject unknown properties. UUIDs are strings, dates are ISO `YYYY-MM-DD`, timestamps are ISO with timezone, scores are decimal strings.

## Login and sensitive data

Authenticate using Supabase's Flutter Auth SDK. The phone sends `Authorization: Bearer <access_token>` on each protected request. The backend validates the token with the project's Auth server and derives its teacher identity. Never send `owner_id` or a teacher ID in a create/edit payload.

Production requires MFA: after password/social login, use Supabase's TOTP enrollment/challenge/verification flow and send the refreshed `aal2` token. A 403 `mfa_required` means complete that flow, not create another account. Passwords, recovery and refresh tokens go only to Supabase, never FastAPI. Use platform secure storage for sessions; avoid logging authorization headers, student names, papers or grades. Restrict offline workspace access locally (device authentication/encrypted storage); it must not require a network login. Backend authentication applies only when uploading/downloading or calling online assistance.

## Assessment to final result

1. Create subject/term/competencies when needed; `POST /assessments` with title, template ID, date and an initial answer key. IDs may be client generated. New keys are always unverified.
2. Optionally call `POST /ocr/reference` with multipart `file`. Display the returned draft for review. A blank quiz supplies no key. Create the key from teacher-corrected answers; extraction is not a saved key.
3. Explicit teacher action calls `POST /answer-keys/{id}/verify` with `{"confirmed":true}`. Editing a key or question tags requires `POST /assessments/{id}/answer-keys` with the complete new questions and competency IDs.
4. Recognize locally or call **online** `POST /ocr/student`. Keep `extracted` alongside each corrected answer for explanation. Convert `recognized` to `confirmed`, or `blank_candidate` to `confirmed_blank`, only through teacher review.
5. `POST /scoring/preview` returns partial or complete deterministic scores. The server never asks Gemini to grade objective answers.
6. `POST /submissions` saves a draft. Correct all answers with `PUT /submissions/{id}/answers`. Adjust a score with `POST /submissions/{id}/adjustments`, including a reason.
7. An explicit action calls `POST /submissions/{id}/approve` with `confirmed:true` and `expected_revision`. Only then is the result final and eligible for reports.

Use the returned `revision` for answer replacement, adjustments, approval, student association, material editing/review and consultation editing/approval. 409 `stale_revision` means fetch/review the current record. Approved scores cannot be edited. Create a new submission for a correction or retake; reports use the latest approved attempt. Unassigned approved submissions can be associated once using `PUT /submissions/{id}/student` with both student and historical enrollment UUIDs.

## Offline upload and download

Recognition/alignment, bundled ML Kit, scoring in Dart, image/JSON persistence and offline access are entirely phone responsibilities. No FastAPI/Supabase/Gemini calls are required for those actions. Preserve the key UUID/version and run [the shared scoring fixtures](../fixtures/scoring-v1.json) in Dart.

Upload is explicit and ordered:

1. Create organization records via their normal endpoints with stable client UUIDs, then students and enrollments. On a duplicate UUID, fetch the existing record and compare; do not silently overwrite it. These normal create routes are **not** idempotent upload routes.
2. `POST /uploads/assessments` accepts a complete assessment, explicit assessment/key UUIDs and `key_teacher_verified:true`. This assertion records the authenticated uploading teacher's confirmation; no client actor ID is accepted. Existing server keys can instead be downloaded and reused.
3. `POST /uploads/submissions` accepts the stable submission UUID, key UUID, confirmed answers, current adjustments, exact `client_score`, `teacher_approved:true`, and timezone-aware `local_approved_at`. It atomically saves the submission, answers, item results, adjustment history, server approval and receipt. No paper image is required or sent to Gemini.
4. For a lost upload response, resend the exact normalized payload. The first success returns `status:created`; a retry returns `already_uploaded` with the same IDs/timestamp. 409 `upload_conflict` means the UUID was reused with different content. Preserve the local record, fetch server data, ask the teacher to reconcile, and use a new UUID for a distinct record. Do not retry a conflict in a loop.
5. `GET /assessments/{id}`, `GET /answer-keys/{id}`, `GET /submissions/{id}`, and the paginated list routes are the explicit JSON download contracts. Save their returned snapshots locally. This release has no delta cursors, background sync or merge resolution. Scores do not change when a newer key version appears.

Payload fingerprints use validated defaults, sorted JSON object keys and normalized decimals. Array order and text are significant; retain the uploaded payload for retries. The upload action itself confirms server approval under the authenticated account. Client timestamps are audit information, not authorization or the official server approval time.

## Teaching assistance

`POST /materials/generate` supports `lesson_plan`, `quiz`, `rubric`, `examples`, `activity`, `rewrite`, `follow_up`. Supply topic, level, objectives and preferences. `rewrite` requires `source_text`; use `/ocr/notes` to extract notes first. `follow_up` requires teacher-selected `findings` (concept + evidence) and should contain no student identifiers.

Results are saved as editable drafts. The common structured content includes sections, quiz questions/answer keys, rubric criteria and rewritten text; unused fields are empty/null. Edit with PATCH and mark reviewed with POST `/review`. Editing resets review, preserving the original draft and AI provenance. Treat generated strings as plain text or safely sanitized Markdown, never executable HTML. A generated quiz is not automatically a verified assessment key.

## Students, classes and consultations

Teachers can upload Excel `.xlsx` or UTF-8 CSV masterlists with student number, email, name and grade level. Use `/v1/roster-imports/preview`, show normalized grade/section assignments and row errors, then explicitly confirm via `/v1/roster-imports`. Missing sections default to **Unassigned** under the corresponding grade/year. Select the academic year and start date explicitly. [Roster import contracts and examples](roster-imports.md) describe file limits, matching, safe retries and historical enrollment handling. Students now expose optional `student_number` and `email` fields.

Create academic years → terms; grade/year levels → sections tied to a year; students → dated enrollments. A move closes the previous enrollment and creates another; never move an existing enrollment record to a new section. Overlaps are rejected. `GET /students` accepts `grade_level_id`, `section_id`, `academic_year_id` and `as_of`; without `as_of`, matching enrollment history is included.

Associate assessments with subject/term/date at creation. Those links remain immutable. Tag questions through `competency_ids` in a new key version. Tags are snapshotted to preserve historical evidence.

`GET /students/{id}/performance?subject_id=...&term_id=...` always returns deterministic numerical evidence without Gemini. Threshold query fields are `needs_support_below`, `stronger_at_least`, `min_questions`, `min_assessments`. Create `/expected-assessments` records only for known required work. A missing, pending or approved zero must be displayed differently.

`POST /consultations` captures a numerical snapshot and notes; set `use_ai:true` for an optional Gemini summary. An AI failure leaves no saved false draft and never blocks GET performance. Gemini receives only aggregate learning-area evidence, not student/section identifiers or teacher notes. Teachers can edit and approve the consultation; edits reset approval. Snapshots are immutable; create a new report to include later assessments. There is no official term grade calculation.

## Errors, paging and retries

Errors use `{"error":{"code":"review_required","message":"...","request_id":"..."}}`. Validation errors expose field paths/types, not submitted sensitive values. List endpoints return `items`, `limit` (1–100), `offset` and `has_more`, ordered by creation time/UUID. Paging is not a consistent bulk export while other clients are writing.

- 401: refresh Supabase session once; otherwise return to login.
- 403: MFA needed. Do not treat it as a successful login to TeachEase records.
- 404: nonexistent or owned by another teacher; no ownership information is exposed.
- 409: review needed, mismatched totals/version, stale revision, duplicate or upload conflict. Correct the cause first.
- 413/415/422: shrink/replace the image or roster file, or correct the request.
- 429: honor `Retry-After` when present; otherwise use bounded exponential backoff. AI calls are billed and are not idempotent. `roster_busy` indicates parser capacity; roster retries with the same UUID/payload are safe.
- 502/503/504: retry reads and idempotent uploads with backoff. Do not blindly retry a material/consultation creation after a lost success response: first inspect the list for the created draft.

Maximum request body: 6 MiB; image: 5 MiB/20 million pixels by default. JPEG/PNG/WebP only, single-frame. No confidence percentages or coordinates are returned. CORS is configured for web integrations; Android requests still require authentication.
