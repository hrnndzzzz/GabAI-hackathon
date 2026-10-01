"""Fictional rosters only. XLSX fixtures are minimal OOXML test inputs, not live student data."""

import io
import zipfile
from contextlib import closing
from uuid import uuid4
from xml.sax.saxutils import escape

import pytest

from app.auth import Principal, get_principal
from tests.conftest import OTHER

HEAD = "student_number,student_email,student_name,grade_level,section\n"
CSV = (
    HEAD + "000001,learner.a@example.com,Fictional Learner A,Grade 7,Orchid\n"
    "000002,learner.b@example.com,Fictional Learner B,7,Orchid\n"
    "000003,learner.c@example.com,Fictional Learner C,Grade 8,\n"
).encode()


def academic_year(client, start="2026-06-01", end="2027-05-31"):
    response = client.post(
        "/v1/academic-years", json={"name": "Fictional year", "starts_on": start, "ends_on": end}
    )
    assert response.status_code == 201, response.text
    return {"academic_year_id": response.json()["id"], "starts_on": start}


def preview(client, options, data=CSV, filename="roster.csv"):
    return client.post("/v1/roster-imports/preview", data=options, files={"file": (filename, data)})


def commit(client, options, digest, data=CSV, filename="roster.csv", import_id=None, **extra):
    return client.post(
        "/v1/roster-imports",
        data={
            **options,
            "expected_fingerprint": digest,
            "import_id": str(import_id or uuid4()),
            "confirmed": "true",
            **extra,
        },
        files={"file": (filename, data)},
    )


def workbook(rows, *, second_sheet=False, dimension="A1:A1", formula=False, numeric_id=False):
    """Craft OOXML directly to test stale dimensions and cell types without writer assumptions."""
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr(
            "[Content_Types].xml",
            """<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
        <Default Extension="xml" ContentType="application/xml"/>
        <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
        <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
        <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
        </Types>""",
        )
        archive.writestr(
            "_rels/.rels",
            """<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>""",
        )
        extra = '<sheet name="Other" sheetId="2" r:id="rId2"/>' if second_sheet else ""
        archive.writestr(
            "xl/workbook.xml",
            f"""<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
        xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Masterlist" sheetId="1" r:id="rId1"/>{extra}</sheets></workbook>""",
        )
        extra = (
            '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>'
            if second_sheet
            else ""
        )
        archive.writestr(
            "xl/_rels/workbook.xml.rels",
            f"""<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
        <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>{extra}</Relationships>""",
        )
        body = ""
        for r, row in enumerate(rows, 1):
            cells = ""
            for c, value in enumerate(row):
                address = f"{chr(65 + c)}{r}"
                if address == "A2" and formula:
                    cells += '<c r="A2"><f>1+1</f><v>2</v></c>'
                elif address == "A2" and numeric_id:
                    cells += '<c r="A2" t="n"><v>1</v></c>'
                else:
                    cells += f'<c r="{address}" t="inlineStr"><is><t>{escape(str(value))}</t></is></c>'
            body += f'<row r="{r}">{cells}</row>'
        xml = f'<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><dimension ref="{dimension}"/><sheetData>{body}</sheetData></worksheet>'
        archive.writestr("xl/worksheets/sheet1.xml", xml)
        if second_sheet:
            archive.writestr("xl/worksheets/sheet2.xml", xml)
    return output.getvalue()


ROWS = [HEAD.strip().split(","), ["000001", "learner.a@example.com", "Fictional Learner A", "7", "Orchid"]]


def test_csv_preview_commit_categories_filters_and_retries(client):
    options = academic_year(client)
    response = preview(client, options)
    assert response.status_code == 200, response.text
    result = response.json()
    assert result["valid"] and result["total_rows"] == 3
    assert [a["grade_level"] for a in result["assignments"]] == ["Grade 7", "Grade 7", "Grade 8"]
    assert client.get("/v1/students").json()["items"] == []
    import_id = uuid4()
    saved = commit(client, options, result["fingerprint"], import_id=import_id)
    assert saved.status_code == 200, saved.text
    result = saved.json()
    assert (result["students_created"], result["enrollments_created"]) == (3, 3)
    first, second, third = result["assignments"]
    assert first["section_id"] == second["section_id"] != third["section_id"]
    assert third["section"] == "Unassigned"
    students = client.get(
        "/v1/students",
        params={"grade_level_id": first["grade_level_id"], "academic_year_id": options["academic_year_id"]},
    ).json()["items"]
    assert {s["student_number"] for s in students} == {"000001", "000002"}
    assert students[0]["email"].endswith("@example.com")
    retry = commit(client, options, response.json()["fingerprint"], import_id=import_id).json()
    assert retry == result | {"status": "already_imported"}
    assert client.get(f"/v1/roster-imports/{import_id}").json() == result
    # A new import ID for unchanged rows also reuses existing students/enrollments.
    again = commit(client, options, response.json()["fingerprint"]).json()
    assert (again["students_created"], again["students_reused"], again["enrollments_created"]) == (0, 3, 0)


def test_excel_text_ids_stale_dimensions_and_sheet_selection(client):
    options = academic_year(client)
    data = workbook(ROWS, second_sheet=True)
    assert preview(client, options, data, "master.xlsx").json()["error"]["code"] == "sheet_required"
    options["sheet_name"] = "Masterlist"
    result = preview(client, options, data, "master.xlsx").json()
    assert result["valid"] and result["assignments"][0]["student_number"] == "000001"
    saved = commit(client, options, result["fingerprint"], data, "master.xlsx")
    assert saved.status_code == 200, saved.text


@pytest.mark.parametrize(
    "kwargs,code",
    [({"formula": True}, "formula_not_allowed"), ({"numeric_id": True}, "student_number_must_be_text")],
)
def test_excel_rejects_formulas_and_numeric_student_numbers(client, kwargs, code):
    result = preview(client, academic_year(client), workbook(ROWS, **kwargs), "master.xlsx").json()
    assert not result["valid"] and code in {i["code"] for i in result["issues"]}


@pytest.mark.parametrize(
    "data,code",
    [
        ((HEAD + "001,invalid-email,Fictional A,7,A\n").encode(), "invalid_value"),
        (CSV + b"000001,learner.a@example.com,Fictional Learner A,7,Orchid\n", "duplicate_student_number"),
        ((HEAD + "=1+1,a@example.com,Fictional A,7,A\n").encode(), "formula_not_allowed"),
        ((HEAD + "001,a@example.com,Fictional A,99,A\n").encode(), "invalid_grade_level"),
    ],
    ids=["email", "duplicate", "formula", "grade"],
)
def test_invalid_rows_do_not_save_partial_imports(client, data, code):
    options = academic_year(client)
    result = preview(client, options, data).json()
    assert not result["valid"] and code in {i["code"] for i in result["issues"]}
    assert commit(client, options, result["fingerprint"], data).status_code == 409
    assert client.get("/v1/students").json()["items"] == []
    assert client.get("/v1/grade-levels").json()["items"] == []


def test_roster_conflicts_confirmation_and_no_overwrites(client):
    options = academic_year(client)
    initial = preview(client, options).json()
    assert commit(client, options, initial["fingerprint"], confirmed="false").status_code == 409
    identifier = uuid4()
    saved = commit(client, options, initial["fingerprint"], import_id=identifier).json()
    changed = CSV.replace(b"learner.a@example.com", b"changed@example.com")
    assert (
        commit(client, options, initial["fingerprint"], changed).json()["error"]["code"] == "roster_changed"
    )
    current = preview(client, options, changed).json()
    assert current["issues"][0]["code"] == "student_details_conflict"
    assert (
        commit(client, options, current["fingerprint"], changed, import_id=identifier).json()["error"]["code"]
        == "upload_conflict"
    )
    student = client.get(f"/v1/students/{saved['assignments'][0]['student_id']}").json()
    assert student["email"] == "learner.a@example.com"
    # Legacy frontend PATCH requests preserve newly introduced student contact fields.
    edited = client.patch(
        f"/v1/students/{student['id']}", json={"display_name": student["display_name"]}
    ).json()
    assert edited["email"] == student["email"] and edited["student_number"] == "000001"


def test_new_year_preserves_history_and_overlapping_transfers_are_blocked(client):
    options = academic_year(client)
    first = commit(client, options, preview(client, options).json()["fingerprint"]).json()
    changed = CSV.replace(b"Orchid", b"Maple")
    assert preview(client, options, changed).json()["issues"][0]["code"] == "enrollment_conflict"
    next_year = academic_year(client, "2027-06-01", "2028-05-31")
    result = preview(client, next_year, changed).json()
    assert result["valid"]
    second = commit(client, next_year, result["fingerprint"], changed).json()
    assert (second["students_created"], second["enrollments_created"]) == (0, 3)
    assert first["assignments"][0]["student_id"] == second["assignments"][0]["student_id"]
    old_students = client.get(
        "/v1/students", params={"section_id": first["assignments"][0]["section_id"], "as_of": "2026-09-15"}
    ).json()["items"]
    assert len(old_students) == 2


def test_owner_isolation_and_auth(client, app):
    options = academic_year(client)
    draft = preview(client, options).json()
    saved = commit(client, options, draft["fingerprint"]).json()
    app.dependency_overrides[get_principal] = lambda: Principal(OTHER, "aal2")
    assert preview(client, options).status_code == 404
    assert client.get(f"/v1/roster-imports/{saved['import_id']}").status_code == 404
    assert client.get(f"/v1/students/{saved['assignments'][0]['student_id']}").status_code == 404
    assert client.get("/v1/students").json()["items"] == []
    own_year = academic_year(client)
    own = commit(client, own_year, preview(client, own_year).json()["fingerprint"]).json()
    assert own["students_created"] == 3  # Same numbers allowed for a different teacher.
    app.dependency_overrides.clear()
    assert preview(client, options).status_code == 401


@pytest.mark.parametrize(
    "data,filename,code",
    [
        (b"anything", "master.xls", "unsupported_roster"),
        (b"not zip", "master.xlsx", "invalid_roster_file"),
        (b"\xff\xfe", "master.csv", "invalid_roster_file"),
        (HEAD.encode(), "master.csv", "empty_roster"),
        (b"student_number,student_name\n001,Fictional A\n", "master.csv", "missing_headers"),
        ((HEAD + "001,a@example.com,Fictional A,7,A\n" * 2001).encode(), "master.csv", "roster_too_large"),
    ],
    ids=["xls", "invalid-zip", "encoding", "empty", "missing-headers", "too-many-rows"],
)
def test_malformed_and_bounded_files(client, data, filename, code):
    response = preview(client, academic_year(client), data, filename)
    assert response.status_code in {413, 415, 422}, response.text
    assert response.json()["error"]["code"] == code


def test_excel_security_and_size_limits(client):
    options = academic_year(client)
    valid = workbook(ROWS)
    for path, payload, expected in [
        ("xl/vbaProject.bin", b"macro", "unsupported_workbook"),
        ("xl/externalLinks/externalLink1.xml", b"link", "unsupported_workbook"),
        (
            "extra.xml",
            b'<!DOCTYPE root [<!ENTITY secret SYSTEM "file:///not-read">]><root>&secret;</root>',
            "invalid_roster_file",
        ),
        ("large.xml", b"x" * (20 * 1024 * 1024 + 1), "roster_too_large"),
        ("deep.xml", b"<a>" * 65 + b"</a>" * 65, "roster_too_large"),
        ("complex.xml", b"<a>" + b"<b/>" * 100_001 + b"</a>", "roster_too_large"),
    ]:
        stream = io.BytesIO(valid)
        with zipfile.ZipFile(stream, "a", zipfile.ZIP_DEFLATED) as archive:
            archive.writestr(path, payload)
        response = preview(client, options, stream.getvalue(), "roster.xlsx")
        assert response.json()["error"]["code"] == expected, response.text
    assert preview(client, options, b"x" * (5 * 1024 * 1024 + 1)).status_code == 413
    # Inflated dimensions cannot hide data beyond the supported columns.
    assert preview(client, options, workbook([list(range(17))]), "wide.xlsx").status_code == 413


def test_alias_headers_unicode_names_and_college_categories(client):
    options = academic_year(client)
    data = (
        "Student No,Student Email,Student Name,Year Level\n"
        '000007,fictional@example.com,"Fictional Reyes, Ana María",1st year\n'
    ).encode("utf-8-sig")
    result = preview(client, options, data).json()
    assert result["valid"]
    assert result["assignments"][0]["grade_level"] == "Year 1"
    assert result["assignments"][0]["display_name"] == "Fictional Reyes, Ana María"


def test_legacy_identifier_ambiguous_categories_and_stale_preview(client):
    options = academic_year(client)
    first = preview(client, options).json()
    student = client.post(
        "/v1/students", json={"display_name": "Fictional Learner A", "local_identifier": "000001"}
    ).json()
    result = preview(client, options).json()
    assert result["issues"][0]["code"] == "legacy_identifier"
    assert commit(client, options, first["fingerprint"]).status_code == 409
    client.patch(
        f"/v1/students/{student['id']}",
        json={
            "display_name": student["display_name"],
            "student_number": "000001",
            "email": "learner.a@example.com",
        },
    )
    assert preview(client, options).json()["valid"]
    for name in ("Grade 7", "G7"):
        client.post("/v1/grade-levels", json={"name": name})
    assert "ambiguous_category" in {i["code"] for i in preview(client, options).json()["issues"]}


def test_options_validation_and_parser_admission(client, app):
    options = academic_year(client)
    assert preview(client, options | {"starts_on": "2020-01-01"}).status_code == 422
    assert preview(client, options | {"default_section": "   "}).status_code == 422
    assert preview(client, options | {"default_section": "=1+1"}).status_code == 422
    assert preview(client, options | {"sheet_name": "Other"}).status_code == 422
    app.state.roster_slots.acquire()
    app.state.roster_slots.acquire()
    try:
        response = preview(client, options)
        assert response.status_code == 429 and response.json()["error"]["code"] == "roster_busy"
    finally:
        app.state.roster_slots.release()
        app.state.roster_slots.release()


def test_configured_roster_file_limit(client, app):
    app.state.settings.max_roster_bytes = 1024
    response = preview(client, academic_year(client), b"x" * 1025)
    assert response.status_code == 413
    assert response.json()["error"]["code"] == "roster_too_large"


def test_existing_local_sqlite_upgrade_preserves_records(tmp_path):
    import sqlite3

    from scripts.migrate_local_students import migrate

    path = tmp_path / "old.db"
    with closing(sqlite3.connect(path)) as conn, conn:
        conn.execute(
            "CREATE TABLE students(id TEXT PRIMARY KEY, owner_id TEXT, display_name TEXT, local_identifier TEXT)"
        )
        conn.execute("INSERT INTO students VALUES ('1','teacher-a','Fictional Learner','local-001')")
    migrate(path)
    migrate(path)
    with closing(sqlite3.connect(path)) as conn, conn:
        assert conn.execute("SELECT id,local_identifier,student_number,email FROM students").fetchone() == (
            "1",
            "local-001",
            None,
            None,
        )
        conn.execute("UPDATE students SET student_number='000001', email='learner@example.com' WHERE id='1'")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO students(id,owner_id,display_name,student_number) VALUES ('2','teacher-a','Duplicate','000001')"
            )
