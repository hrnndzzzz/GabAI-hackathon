# Student masterlist import

The backend accepts Excel `.xlsx` and UTF-8 CSV masterlists and organizes students under **academic year → grade/year level → section → student**. This is an authenticated online upload; the Flutter team supplies the file picker, preview table and confirmation button. No Gemini request is made, no email is sent, and no student login account is created.

## File layout

Use the [fictional CSV example](../fixtures/student-roster.csv) as a template. The first row must contain headers. One student per subsequent row:

```csv
student_number,student_email,student_name,grade_level,section
000001,learner.a@example.com,Fictional Learner A,Grade 7,Orchid
000002,learner.b@example.com,Fictional Learner B,7,Orchid
000003,learner.c@example.com,Fictional Learner C,Year 1,
```

The first four columns are required. `section` is optional; blank/missing sections use `default_section`, initially **Unassigned**. This creates an ordinary section under the specified grade and academic year, ready for later teacher-managed enrollment changes.

- Headers ignore case, spaces, underscores and hyphens. Supported aliases: student number / student no / student ID; student email / email; student name / full name / name; student grade level / grade level / grade / year level; section. Unknown or duplicate headers are rejected to avoid misreading extra columns.
- Student numbers are case-sensitive text identifiers, unique per teacher. Leading zeros are preserved. In Excel, format the column as **Text before entering the numbers**. Numeric Excel student-number cells are rejected because lost digits or zeros cannot be recovered safely. Legacy `.xls` and `.xlsm` must be saved as ordinary `.xlsx` containing plain values.
- `7`, `G7` and `Grade 7` become `Grade 7` (grades 1–12). `Year 1`, `College Year 1` and `1st year` become `Year 1` (years 1–6). `K`, `Kinder` and `Kindergarten` become `Kindergarten`. Other explicit school-specific labels are retained. A bare number means school grade, not college year. Names are never used to infer a grade.
- Existing grade/section names match without case or repeated-space differences. Sections also match on grade and academic year. Ambiguous existing categories produce row errors; no arbitrary match is selected.
- Names and identifiers are limited to 120 characters; email addresses to 254 and valid email syntax. Email validation does not query DNS or verify mailbox ownership. Names may contain Unicode and commas (quote comma-containing CSV values).
- Use comma-delimited UTF-8 CSV (BOM accepted), or `.xlsx` with a single worksheet. For multiple worksheets, explicitly supply `sheet_name`. Only the selected worksheet is imported; workbook security/size validation covers all archive members.
- Limits: 5 MiB default file (configurable with `MAX_ROSTER_BYTES`), 6 MiB default total HTTP body, 2,000 data rows, 16 columns, 20 MiB expanded workbook, 256 ZIP entries. The application body-size limit also applies locally; larger masterlists should be split into batches with distinct import UUIDs. XLSX cells beyond row 2001/column P, even on other sheets, are rejected. Formulas, macro-enabled files, external workbook links, encrypted files, XML entities and unsupported content are rejected. Formula results are never evaluated or trusted.

## API flow

All routes require `Authorization: Bearer <Supabase access token>` and the same production MFA policy as grades. Every database lookup, student and receipt is restricted to the verified teacher. Never send an owner ID. All fields below are multipart form fields; let the HTTP library set the multipart boundary.

1. Create/select an academic year through `/v1/academic-years`. The teacher supplies the enrollment start date within that year. Grade levels and sections need not exist beforehand.
2. `POST /v1/roster-imports/preview`: send `file`, `academic_year_id`, `starts_on`, and optional `default_section` / `sheet_name`.
3. Display `assignments` with normalized names, grade, section and `create` / `reuse` actions. `issues` identify spreadsheet row numbers (header is row 1), fields, codes and correction messages. A syntactically readable file with row errors returns **200**, `valid:false`; the preview saves nothing. Do not offer confirmation until `valid:true`.
4. `POST /v1/roster-imports`: re-send the **same bytes and options**, plus `expected_fingerprint` from the preview, a stable client-generated `import_id` UUID and `confirmed=true`. The server revalidates current database state and commits all students, categories, enrollments and the receipt in one transaction.
5. Save the returned UUIDs for student/result association. Existing `/v1/students` filters (`grade_level_id`, `section_id`, `academic_year_id`, `as_of`) list the resulting classes. `GET /v1/roster-imports/{import_id}` retrieves the original receipt after a lost response.

Example preview (shell variables contain caller-selected values):

```bash
curl "$BASE_URL/v1/roster-imports/preview" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "file=@fixtures/student-roster.csv;type=text/csv" \
  -F "academic_year_id=$ACADEMIC_YEAR_ID" \
  -F "starts_on=2026-06-01"
```

Example confirmation, using the fingerprint returned above and a newly generated import UUID:

```bash
curl "$BASE_URL/v1/roster-imports" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -F "file=@fixtures/student-roster.csv;type=text/csv" \
  -F "academic_year_id=$ACADEMIC_YEAR_ID" \
  -F "starts_on=2026-06-01" \
  -F "expected_fingerprint=$PREVIEW_FINGERPRINT" \
  -F "import_id=$IMPORT_ID" \
  -F "confirmed=true"
```

Use `file=@masterlist.xlsx;type=application/vnd.openxmlformats-officedocument.spreadsheetml.sheet` for Excel. MIME declarations are not trusted as proof of valid file contents. Complete response field schemas are in [OpenAPI](openapi.json) and `/docs` (`RosterPreview`, `RosterImportOut`). Imports return bounded complete row arrays, not paginated arrays; student lists remain paginated.

## Matching, conflicts and retries

Matching uses the signed-in teacher and `student_number`, never email or name alone. Existing matching name/email records are reused. A different name or email produces `student_details_conflict`; edit the student through `PATCH /v1/students/{id}` after checking identity, then preview again. Imports never silently overwrite a student's details. Student create/edit/get/list contracts now include optional `student_number` and `email`; older clients that omit them remain valid. The legacy `local_identifier` is separate. If a legacy identifier matches an imported number without an explicit student number, set `student_number` and email on that existing student before importing to avoid creating a duplicate person.

An enrollment already covering the requested interval in the same section is reused. Otherwise, the importer creates a dated enrollment through the selected year's end (stored `ends_on:null`, whose effective end is the academic year's end). Overlapping enrollments in another section or with different dates are conflicts. For transfers, explicitly close the old enrollment first and choose a non-overlapping start date. Reimporting for a later non-overlapping academic year reuses the student UUID and creates a new enrollment. Earlier enrollments and approved assessment links remain unchanged.

Successful POST returns **200**, `status:imported`, `created_at`, `students_created`, `students_reused`, `enrollments_created` and assignments with student, grade, section and enrollment UUIDs. An exact retry with the same import UUID returns **200**, `status:already_imported` and the original IDs/timestamp. Renaming a file without changing its extension/content does not change its fingerprint. Changing bytes (including row order/line endings), extension or import options requires a new preview. A different import UUID with identical student rows reuses existing records but creates its own audit receipt.

| Status | Meaning / action |
|---|---|
| 401 / 403 | Sign in / complete Supabase MFA |
| 404 | Academic year or receipt absent or inaccessible |
| 409 `review_required` | Explicit confirmation was not supplied |
| 409 `roster_changed` | File/options differ from preview; preview again |
| 409 `upload_conflict` | Same import UUID used for different content; reconcile and use a new UUID for a distinct import |
| 409 `roster_conflict` | Row errors or database state changed; preview again for row details; nothing saved |
| 409 `record_conflict` | Database uniqueness/relationship conflict; nothing saved; fetch/review and retry with a new preview |
| 413 / 415 / 422 | File too large / unsupported type / malformed file, missing headers, invalid dates or form values |
| 429 `roster_busy` | Parser admission slots occupied; retry with bounded exponential backoff |
| 503 | Database temporarily unavailable; retry the same import UUID/payload with backoff |

Global errors use `{"error":{"code":"...","message":"...","request_id":"..."}}`. Preview row issues deliberately omit submitted values. Assignment previews/receipts contain student data and must not be logged. Requests and responses use `Cache-Control: no-store`. The raw file is processed transiently and is not kept in storage. Student records and immutable import receipts remain in the teacher-scoped database. School/device retention controls and secure local file storage remain frontend/operator responsibilities.

## Migration and verification

Apply `20261001160637_student_roster_import.sql` after the existing baseline/security migrations before using this version. It adds nullable student number/email columns and a teacher-scoped unique constraint. Existing records and forced RLS policies are preserved; no Auth accounts or grants change. `scripts/export_contracts.py` updates documentation only and never rewrites applied migrations.

Automated tests use fictional CSV and crafted XLSX inputs. They cover parser limits, formulas/XML, normalization, preview without writes, all-or-nothing imports, duplicate/conflicting identifiers, exact retries, teacher isolation, grade filters and historical enrollments. PostgreSQL tests exercise real RLS, concurrent imports and rollback. Live Supabase login and Flutter file-picking/display still require integration testing.

Workbook XML is streamed and limited to 100,000 elements and depth 64 before parsing cells, bounding XML complexity as well as expansion risk. Existing local SQLite databases have a separate explicit upgrade command in [setup](setup.md).

Parser references: [openpyxl XML security guidance](https://openpyxl.readthedocs.io/en/stable/#security), [read-only mode](https://openpyxl.readthedocs.io/en/stable/optimized.html), [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security).
