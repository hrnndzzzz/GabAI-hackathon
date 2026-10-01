# Backend work for the mobile app (v1.2)

The v1.2 mobile app adds registration with profile details, sections and class lists,
due dates, late and missing tracking, class rankings, a schedule, exam timers,
notification preferences and file previews. All of it works on the phone offline first,
and, for signed-in teachers, now syncs with the server (see Progress) so it follows them to
another phone.

This document lists what the API stores for it, roughly in priority order. Everything here follows the existing conventions: every row is owner-scoped
(`owner_id` from the verified Supabase token), the client generates UUIDs so offline
writes are idempotent, edits carry `expected_revision`, and errors use
`{error: {code, message, request_id}}`.

| Priority | Area | Why it matters |
| --- | --- | --- |
| P0 | 1. Teacher profile and picture | Shown on every screen; collected at registration |
| P0 | 2. Classes and class lists | Every record, ranking and "not taken" count depends on them |
| P0 | 3. Assessments linked to a class, with a due date | Late papers, pending counts, schedule |
| P1 | 4. Submission filters and `submitted_at` | Rankings, late papers, faster sync |
| P1 | 5. Class summary and student stats | The Records tiles and rankings on large classes |
| P1 | 6. Schedule events | The calendar |
| P1 | 7. Incremental sync | Sync currently re-downloads everything |
| P2 | 8. Push notifications and preferences | Alerts while the app is closed |
| P2 | 9. Device preferences, feedback, exam sessions, exports | Convenience and audit |
| None | 10. CAPTCHA | Supabase configuration only |

## Progress (2 October 2026)

**Built and connected:** items 1–7, plus preferences and feedback from item 9. The app syncs them
with the server; nothing below stays phone-only for signed-in teachers. **Not built:** push
notifications (item 8) and the optional exam sessions and server exports (item 9).

| Area | Server | App |
| --- | --- | --- |
| 1. Profile and picture | `GET/PUT /v1/me` with full name, school and avatar; `PUT/GET/DELETE /v1/me/avatar` (256 px JPEG, metadata stripped) | Registration and Account settings upload them; a new phone downloads them |
| 2. Classes and class lists | `PUT /v1/classes/{id}` (find-or-create grade level, section, subject; students and enrollments), `GET`, `DELETE` (archive) | Every section edit uploads; removals archive; other phones download changes |
| 3. Class and due date on assessments | `class_id`, `due_at` on create, upload, edit and list; everyone on the class list becomes an expected result | Sent with each new assessment; a class uploads before its assessments |
| 4. Filters and `submitted_at` | `submitted_at` on upload; `late` on every result; `?class_id`, `?late`, `?updated_since` | The capture time is sent as `submitted_at` and decides "late" |
| 5. Summary and stats | `GET /v1/classes/{id}/summary` and `/students?sort=` | Not called yet: the phone holds every result after sync and computes the same numbers |
| 6. Events | `PUT/GET/DELETE /v1/events` with soft deletes | The calendar syncs, including deletions |
| 7. Incremental sync | `updated_since` and `server_time` on assessments, submissions, materials, classes and events | After the first sync, each sync asks only for changes |
| 8. Push | Not built | Needs a Firebase project first: the app registers its token, the server sends alerts |
| 9. Preferences, feedback | `GET/PUT /v1/me/preferences` (merge), `POST /v1/feedback` (20 a day) | Theme, scanner, export, shortcut and notification settings follow the account; Help sends feedback |
| 10. CAPTCHA | Supabase configuration | Turnstile on sign-in and registration |

Database changes are in `supabase/migrations/0003_mobile.sql`, with row security on the new
tables. A local SQLite database gains the new tables and columns automatically when the server
starts.

Verified with `tests/test_mobile.py` (13 tests), the same scenarios on PostgreSQL with RLS
(`tests/test_postgres_mobile.py`), the existing suites, and an end-to-end run. In that run, one
browser registered, synced a class, an assessment, a result, an event, a picture and settings;
a second browser signed in and received them all.

How the app counts things today, so the server can match it:
- **Pending (papers still to grade):** students on the section's class list with no approved
  result for one of the section's assessments. Without a class list, the count is what's left
  of the demo queue. The Hub, the badge previews and Records all use this rule.
- **Not taken:** the same check for older results that have no assessment record. These show
  per student and in the "Haven't taken" sort, but they are not counted in Pending.
- **Late:** approved after the assessment's due time. This moves to `submitted_at` once item 4 exists.
- **Online status strip:** Offline (no network), No server (network but the API is
  unreachable), or Online with the last sync time and the number of queued uploads.

---

## 1. Teacher profile and picture (P0)

**Today:** `teacher_profiles` stores `display_name` only, and `PUT /v1/me` accepts only that.
The app also saves the school name and the profile picture, but on the phone only.

**Needed:**

- Add columns `full_name` (≤120), `school_name` (≤160), `avatar_style`
  (`initials | pattern | photo`), `avatar_color` (`#RRGGBB`) and `avatar_object` (storage key, nullable).
- Extend `PUT /v1/me` (keep the existing behaviour for `display_name`):

  ```json
  { "display_name": "Teacher Elena", "full_name": "Elena Santos", "school_name": "Rizal Integrated School",
    "avatar": { "style": "initials", "color": "#FFD93D" } }
  ```

- `PUT /v1/me/avatar`: multipart JPEG or PNG, at most 512 KB. The app already crops photos
  to a 256 px square. Store it in a **private** Supabase Storage bucket under
  `avatars/{owner_id}.jpg`. `DELETE /v1/me/avatar` removes it.
- `GET /v1/me` returns the new fields, plus `avatar_url`: a short-lived signed URL, or null.
- At registration, Supabase `signUp` sends `user_metadata.full_name` and `school`. On the
  first `GET /v1/me` for a new owner, seed the profile from that metadata. Treat it as
  display text only: it is user-supplied and never grants anything.

## 2. Classes and class lists (P0)

**Today:** the app models a class as level → grade → section, plus a subject and a list of
student names (for example "G9 Bio · Sampaguita"). The server already has `grade_levels`,
`sections`, `subjects`, `students` and `enrollments`, but:

- `grade_levels` has only a free-text `name`. The app needs the school level and the grade number.
- There is no "class" that ties a section to the subject the teacher teaches in it.
- Creating one class takes many calls (grade level, section, subject, then each student
  and each enrollment), which is hard to do offline.

**Needed:**

- `grade_levels`: add `level` (`elementary | highschool | college`) and `grade`
  (0–12 for K–12, where 0 is Kindergarten; 1–4 for college years). Make
  (`owner_id`, `level`, `grade`) unique.
- New `classes` table (a teaching assignment): `id` (client UUID), `section_id`,
  `subject_id`, `term_id` (nullable), `archived`, `revision`.
- A convenience resource that matches what the app edits, so one call creates or
  updates everything:

  ```http
  PUT /v1/classes/{id}            # idempotent upsert
  {
    "level": "highschool", "grade": 9, "section": "Sampaguita", "subject": "Biology",
    "academic_year_id": "…",            # optional; default to the current year
    "students": ["Marcus Chen", "Andrea Villanueva", "…"],
    "expected_revision": 3              # omit when creating
  }
  GET    /v1/classes                    # with roster and counts
  DELETE /v1/classes/{id}               # archive; results are kept
  ```

  The server finds or creates the grade level, section and subject (matched by name
  per owner). Students are matched by `display_name` within the section. Students who
  are no longer listed have their enrollment closed (`ends_on`), never deleted, so
  their history stays.
- Limits: 200 students per class and 60 classes per owner. Names are 1–120 characters.

## 3. Assessments linked to a class, with a due date (P0)

**Today:** the app puts the class label in `category` (for example "G9 Bio · Sampaguita") and
keeps the due date on the phone. Papers approved after the due time are marked late on
the phone only.

**Needed:**

- `assessments`: add `class_id` (nullable FK to `classes`) and `due_at` (timestamptz, nullable).
- Accept both fields in `AssessmentCreate`, so in `POST /v1/uploads/assessments` too.
  The upload stays idempotent. A replay with different `class_id` or `due_at` is the
  existing `upload_conflict`.
- `PATCH /v1/assessments/{id}`: allow changing `due_at` and `class_id`, with `expected_revision`.
- When an assessment has a `class_id`, create `expected_assessments` rows for that class's
  active enrollments, and add rows for students who join later. That table already
  exists, and it is what "Pending" and "Haven't taken" count.
- Keep `category` for older clients. When `class_id` is set, the server can fill `category`
  from the class label.

## 4. Submission filters and `submitted_at` (P1)

**Today:** the app downloads every approved submission and filters and sorts on the phone.
It decides "late" from the approval time, which is really when the teacher graded the
paper, not when the student handed it in.

**Needed:**

- Offline upload: optional `submission.submitted_at` (when the paper was handed in; the
  app will default it to the capture time) and `submission.enrollment_id` (the app will
  send it once it knows the server's roster).
- Store `late` as a column or compute it as `submitted_at > assessment.due_at` (falling
  back to `local_approved_at`).
- `GET /v1/submissions` filters: `class_id`, `assessment_id`, `student_id`,
  `late=true`, `approved_since`, and `sort` = `approved_at | -approved_at | final_score | -final_score | student`.
  Keep the current pagination.

## 5. Class summary and student stats (P1)

The Records screen shows, for each class or for one assessment: class average, pending count,
late count, a proficiency spread (DepEd bands), per-assessment averages, and a ranked
student list. The phone computes all of this now. A server version keeps large classes
fast and keeps every device in agreement:

```http
GET /v1/classes/{id}/summary?assessment_id=…
→ { "average": "82.70", "results": 20, "late": 3,
    "pending": [{ "assessment_id": "…", "students": [{ "student_id": "…", "name": "…" }] }],
    "bands": { "outstanding": 6, "very_satisfactory": 4, "satisfactory": 3, "fairly_satisfactory": 2, "did_not_meet": 5 },
    "assessments": [{ "assessment_id": "…", "title": "Bio Quiz 4", "average": "86.00", "results": 10 }] }

GET /v1/classes/{id}/students?assessment_id=…&sort=-average|average|latest|oldest|late|missing|name|-name
→ Page of { "student_id", "name", "average", "results", "late", "missing": [assessment ids], "latest_at", "oldest_at" }
```

Averages are percentages of `final_score / possible_score`, returned as two-decimal strings
like every other score. Bands use the DepEd descriptors the app already shows
(`mobile/web/src/lib/grading.ts`): Outstanding ≥90, Very Satisfactory ≥85, Satisfactory ≥80,
Fairly Satisfactory ≥75, otherwise Did Not Meet Expectations. These are not in `scoring.md`
yet, so add them there when this lands.

## 6. Schedule events (P1)

The calendar shows exams, quizzes, classes, deadlines, meetings and reminders, and links
them to a class or an assessment. It also shows assessment due dates, which come from
`assessments.due_at` and are not stored twice.

- New `calendar_events` table: `id` (client UUID), `title` (≤80), `type`
  (`exam | quiz | class | deadline | meeting | reminder`), `starts_at` (timestamptz),
  `duration_min` (0–600), `all_day`, `class_id`, `assessment_id` (both nullable,
  owner-checked), `notes` (≤500), `revision`, `deleted_at`.
- `PUT /v1/events/{id}` (idempotent upsert with `expected_revision`), `DELETE /v1/events/{id}`
  (soft delete), and `GET /v1/events?from=…&to=…` (at most a 93-day window, including
  assessment due dates as read-only items).

## 7. Incremental sync (P1)

Each sync currently downloads every assessment, approved submission and material. Add
`updated_since` (timestamptz) to the list endpoints for assessments, submissions,
materials, classes and events, and return soft-deleted rows as tombstones
(`{ "id", "deleted_at" }`) so the phone can remove them. Return a `server_time` with each
page, which the app stores as the next `updated_since`.

## 8. Push notifications and preferences (P2)

The bell on the Hub is built on the phone: due within 24 hours, today's schedule, finished
timers, upload problems and unverified keys. Alerts while the app is closed need push:

- `PUT /v1/devices/{id}` registers a device: `{ "fcm_token", "platform": "android", "app_version" }`.
  `DELETE` removes it on sign-out.
- `GET/PUT /v1/me/notification-preferences`:
  `{ "urgent": true, "schedule": true, "sync": true, "tips": false }`. These are the same
  switches as the app's Notification preferences screen.
- Scheduled jobs: assessment due in 24 hours, an event starting in 15 minutes, and a
  submission upload rejected server-side. Send only titles and counts, never student names or scores.
- Exam timers finishing stay **local**: they must fire with no network. On the app side,
  the Android shell still needs a local notification when the app is in the background.

## 9. Smaller items (P2)

- **Device preferences** (theme, default paper size, default export format, Hub shortcuts):
  per device by design. If they should roam, use `GET/PUT /v1/me/preferences` with a small
  validated JSON object (≤4 KB).
- **Feedback:** the Help screen shares feedback through the share sheet. A
  `POST /v1/feedback` (`message` ≤2000, `app_version`, `platform`; rate-limited, no
  attachments) would collect it centrally.
- **Exam sessions:** optional `exam_sessions` (`assessment_id`, `class_id`, `started_at`,
  `duration_min`, `ended_at`) to record when an exam actually ran. That would make "late"
  more accurate than a fixed due time.
- **Exports:** CSV, Markdown and printable HTML are generated on the phone and previewed
  before sharing. A server export (`GET /v1/classes/{id}/export.csv`) is only needed if
  web or desktop clients come later.
- **Health:** `GET /health` already returns `version`. The About screen shows it, so keep
  it in step with releases.

## 10. CAPTCHA (no backend code)

Sign-in and registration show a Cloudflare Turnstile check when the app has a site key.
Supabase Auth verifies the token itself:

1. Supabase dashboard → Authentication → Attack Protection: enable CAPTCHA, choose
   Turnstile, and paste the **secret** key there (never in the app or this repo).
2. Cloudflare: allow the hostname `appassets.androidplatform.net` for the site key.
3. App: `gabai.captchaSiteKey=…` in `mobile/local.properties` (the site key is public).

The FastAPI service never sees passwords or CAPTCHA tokens, so it needs no change.

---

## Suggested order

1. Profile fields and avatar (1). This is small and visible straight away.
2. Grade level `level`/`grade`, `classes`, and `PUT /v1/classes/{id}` (2).
3. `class_id` and `due_at` on assessments, plus automatic `expected_assessments` (3).
4. Submission filters, `submitted_at`, `updated_since` (4, 7).
5. Summary and student stats endpoints (5).
6. Events (6), then push (8).

The app will switch each area from phone-only storage to the API as its endpoint lands.
Until then it keeps working offline exactly as it does now.
