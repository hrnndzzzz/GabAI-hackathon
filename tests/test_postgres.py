"""Real RLS/transaction tests. No SQLite substitution: require a migrated disposable PostgreSQL database."""

import json
import os
from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.auth import Principal, get_principal
from app.config import Settings
from app.main import create_app
from tests.conftest import OTHER, TEACHER, create_assessment, create_submission, submission_payload

pytestmark = pytest.mark.postgres


@pytest.fixture
def pg_url():
    url = os.environ.get("TEST_POSTGRES_URL")
    if not url:
        pytest.skip("TEST_POSTGRES_URL not configured; real PostgreSQL RLS tests are not simulated")
    return url


def identity(conn, owner, role="teachease_api"):
    # Fixed known role, never derived from user input.
    assert role in {"teachease_api", "anon", "authenticated"}
    conn.execute(f"SET LOCAL ROLE {role}")
    conn.execute(
        "SELECT set_config('request.jwt.claims', %s, true)", (json.dumps({"sub": str(owner), "aal": "aal2"}),)
    )


def test_every_table_rls_enabled_and_forced(pg_url):
    from app.models import Base

    with psycopg.connect(pg_url) as conn:
        for name in Base.metadata.tables:
            row = conn.execute(
                "SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid=%s::regclass", (name,)
            ).fetchone()
            assert row == (True, True), name
            assert (
                conn.execute(
                    "SELECT count(*) FROM pg_policies WHERE tablename=%s AND policyname='teacher_owns_record'",
                    (name,),
                ).fetchone()[0]
                == 1
            )


@pytest.mark.parametrize("role", ["anon", "authenticated"])
def test_supabase_rest_roles_cannot_bypass_backend_validation(pg_url, role):
    with psycopg.connect(pg_url) as conn:
        identity(conn, TEACHER, role)
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("SELECT * FROM public.submissions")
        conn.rollback()
        identity(conn, TEACHER, role)
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            conn.execute("INSERT INTO public.submissions DEFAULT VALUES")
        conn.rollback()


def test_rls_select_insert_update_delete_and_cross_owner_foreign_keys(pg_url):
    first, second = uuid4(), uuid4()
    with psycopg.connect(pg_url) as conn:
        identity(conn, TEACHER)
        conn.execute(
            "INSERT INTO subjects(id,owner_id,name,created_at,updated_at) VALUES (%s,%s,'Fictional Maths',now(),now())",
            (first, TEACHER),
        )
        identity(conn, OTHER)
        conn.execute(
            "INSERT INTO subjects(id,owner_id,name,created_at,updated_at) VALUES (%s,%s,'Fictional Science',now(),now())",
            (second, OTHER),
        )
        identity(conn, TEACHER)
        assert conn.execute("SELECT id FROM subjects WHERE id IN (%s,%s)", (first, second)).fetchall() == [
            (first,)
        ]
        assert conn.execute("UPDATE subjects SET name='Tampered' WHERE id=%s", (second,)).rowcount == 0
        assert conn.execute("DELETE FROM subjects WHERE id=%s", (second,)).rowcount == 0
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            with conn.transaction():
                conn.execute(
                    "INSERT INTO subjects(id,owner_id,name,created_at,updated_at) VALUES (%s,%s,'Spoof',now(),now())",
                    (uuid4(), OTHER),
                )
        with pytest.raises(psycopg.errors.ForeignKeyViolation):
            with conn.transaction():
                conn.execute(
                    "INSERT INTO competencies(id,owner_id,subject_id,name,created_at,updated_at) VALUES (%s,%s,%s,'Cross owner',now(),now())",
                    (uuid4(), TEACHER, second),
                )
        conn.rollback()


@pytest.fixture
def pg_client(pg_url):
    url = pg_url.replace("postgresql://", "postgresql+psycopg://", 1)
    app = create_app(Settings(app_env="test", database_url=url, _env_file=None))
    app.dependency_overrides[get_principal] = lambda: Principal(TEACHER, "aal2")
    with TestClient(app) as client:
        yield client


def test_postgres_approved_history_and_provenance_triggers(pg_client, pg_url, assessment_payload):
    assessment, key = create_assessment(pg_client, assessment_payload)
    sub = create_submission(pg_client, submission_payload(assessment, key), approved=True)
    with psycopg.connect(pg_url) as conn:
        identity(conn, TEACHER)
        for statement, identifier in [
            ("UPDATE submissions SET final_score=0 WHERE id=%s", sub["id"]),
            ("UPDATE assessment_questions SET correct_answer='B' WHERE answer_key_id=%s", key["id"]),
            ("DELETE FROM submission_answers WHERE submission_id=%s", sub["id"]),
        ]:
            with pytest.raises(psycopg.errors.CheckViolation):
                with conn.transaction():
                    conn.execute(statement, (identifier,))
        conn.rollback()


def test_postgres_concurrent_upload_is_idempotent(pg_client, assessment_payload):
    payload = {"assessment": assessment_payload, "key_teacher_verified": True}
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: pg_client.post("/v1/uploads/assessments", json=payload), range(2)))
    assert all(r.status_code == 200 for r in results), [r.text for r in results]
    assert sorted(r.json()["status"] for r in results) == ["already_uploaded", "created"]


def test_postgres_roster_concurrency_and_contact_rls(pg_client, pg_url):
    from tests.test_roster_imports import HEAD, academic_year, commit, preview

    number = str(uuid4())
    data = (HEAD + f"{number},learner@example.com,Fictional Roster Learner,Grade 6,Orchid\n").encode()
    options = academic_year(pg_client)
    digest = preview(pg_client, options, data).json()["fingerprint"]
    identifier = uuid4()
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(
            pool.map(lambda _: commit(pg_client, options, digest, data, import_id=identifier), range(2))
        )
    assert all(r.status_code == 200 for r in results), [r.text for r in results]
    assert sorted(r.json()["status"] for r in results) == ["already_imported", "imported"]
    # Two further imports with distinct UUIDs cannot duplicate the student or enrollment.
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: commit(pg_client, options, digest, data), range(2)))
    assert all(
        r.status_code == 200 and r.json()["students_created"] == 0 and r.json()["enrollments_created"] == 0
        for r in results
    )
    student_id = results[0].json()["assignments"][0]["student_id"]
    with psycopg.connect(pg_url) as conn:
        identity(conn, TEACHER)
        assert (
            conn.execute("SELECT count(*) FROM students WHERE student_number=%s", (number,)).fetchone()[0]
            == 1
        )
        assert (
            conn.execute("SELECT count(*) FROM enrollments WHERE student_id=%s", (student_id,)).fetchone()[0]
            == 1
        )
        identity(conn, OTHER)
        assert conn.execute("SELECT email FROM students WHERE id=%s", (student_id,)).fetchall() == []
        assert (
            conn.execute("SELECT response FROM upload_receipts WHERE id=%s", (identifier,)).fetchall() == []
        )
        assert (
            conn.execute(
                "UPDATE students SET email='tampered@example.com' WHERE id=%s", (student_id,)
            ).rowcount
            == 0
        )
        with pytest.raises(psycopg.errors.InsufficientPrivilege):
            with conn.transaction():
                conn.execute(
                    "INSERT INTO students(id,owner_id,display_name,student_number,email,created_at,updated_at) VALUES (%s,%s,'Spoof',%s,'spoof@example.com',now(),now())",
                    (uuid4(), TEACHER, str(uuid4())),
                )
        conn.rollback()


def test_postgres_roster_receipt_collision_rolls_back_entire_import(pg_client, pg_url):
    from tests.test_roster_imports import HEAD, academic_year, commit, preview

    identifier, number = uuid4(), str(uuid4())
    with psycopg.connect(pg_url) as conn:
        identity(conn, OTHER)
        conn.execute(
            "INSERT INTO upload_receipts(id,owner_id,kind,payload_hash,response,created_at,updated_at) VALUES (%s,%s,'roster',%s,'{}',now(),now())",
            (identifier, OTHER, "0" * 64),
        )
    options = academic_year(pg_client)
    category = "Fictional level " + str(uuid4())
    data = (HEAD + f"{number},learner@example.com,Fictional Learner,{category},Maple\n").encode()
    digest = preview(pg_client, options, data).json()["fingerprint"]
    response = commit(pg_client, options, digest, data, import_id=identifier)
    assert response.status_code == 409, response.text
    with psycopg.connect(pg_url) as conn:
        identity(conn, TEACHER)
        assert (
            conn.execute("SELECT count(*) FROM students WHERE student_number=%s", (number,)).fetchone()[0]
            == 0
        )
        assert conn.execute("SELECT count(*) FROM grade_levels WHERE name=%s", (category,)).fetchone()[0] == 0
        assert (
            conn.execute(
                "SELECT count(*) FROM sections WHERE academic_year_id=%s", (options["academic_year_id"],)
            ).fetchone()[0]
            == 0
        )
        conn.rollback()


def test_production_runtime_login_and_mfa_startup(pg_url):
    from psycopg.conninfo import conninfo_to_dict
    from sqlalchemy.engine import URL

    params = conninfo_to_dict(pg_url)
    # Disposable cluster only; explicitly a test-only password, not an application secret.
    with psycopg.connect(pg_url, autocommit=True) as conn:
        conn.execute("ALTER ROLE teachease_login PASSWORD 'test-only-runtime-password'")
    url = URL.create(
        "postgresql+psycopg",
        username="teachease_login",
        password="test-only-runtime-password",
        host=params.get("host", "localhost"),
        port=int(params.get("port", "5432")),
        database=params.get("dbname", "postgres"),
    )
    app = create_app(
        Settings(
            app_env="production",
            database_url=url.render_as_string(hide_password=False),
            supabase_url="https://fictional.supabase.co",
            supabase_publishable_key="test-key",
            _env_file=None,
        )
    )
    app.dependency_overrides[get_principal] = lambda: Principal(TEACHER, "aal2")
    with TestClient(app) as client:
        assert client.get("/health/ready").status_code == 200
        # Readiness must not leak SET LOCAL ROLE into a pooled connection.
        from sqlalchemy import text

        with app.state.engine.connect() as conn:
            assert conn.execute(text("SELECT current_user")).scalar_one() == "teachease_login"
        response = client.post("/v1/students", json={"display_name": "Fictional runtime-login test"})
        assert response.status_code == 201, response.text


def test_postgres_readiness_detects_missing_roster_column(pg_client):
    from sqlalchemy import text

    from app.errors import DomainError
    from app.readiness import check_production_database

    # Disposable local PostgreSQL only. Roll back the simulated unapplied migration.
    with pg_client.app.state.engine.connect() as conn:
        transaction = conn.begin()
        try:
            conn.execute(text("ALTER TABLE students RENAME COLUMN email TO email_unapplied"))
            conn.execute(text("SET LOCAL ROLE teachease_login"))
            with pytest.raises(DomainError) as caught:
                check_production_database(conn)
            assert caught.value.code == "database_schema_outdated"
        finally:
            transaction.rollback()


def test_postgres_consultation_and_material_provenance_edit_guard(pg_client, pg_url):
    from datetime import datetime, timezone

    from app import schemas as s
    from tests.test_ai import draft_material, material_request
    from tests.test_performance import setup_class

    data = setup_class(pg_client)
    response = pg_client.post(
        "/v1/consultations",
        json={
            "student_id": data["student"]["id"],
            "query": {"subject_id": data["subject"]["id"], "term_id": data["term"]["id"]},
        },
    )
    assert response.status_code == 201, response.text
    consultation = response.json()
    response = pg_client.patch(
        f"/v1/consultations/{consultation['id']}",
        json={
            "expected_revision": 1,
            "content": {"summary": "Teacher edited summary", "practice_suggestions": [], "limitations": []},
            "teacher_notes": "Fictional notes",
        },
    )
    assert response.status_code == 200, response.text
    pg_client.app.state.ai.material = lambda _: s.MaterialContent.model_validate(draft_material())
    pg_client.app.state.ai.provenance = lambda: s.Provenance(
        provider="google_gemini",
        model="test-only-model",
        generated_at=datetime.now(timezone.utc),
        prompt_version="mock-v1",
        ai_generated=True,
    )
    response = pg_client.post("/v1/materials/generate", json=material_request())
    assert response.status_code == 201, response.text
    material = response.json()
    edited = draft_material() | {"title": "Teacher edited"}
    assert (
        pg_client.patch(
            f"/v1/materials/{material['id']}", json={"expected_revision": 1, "content": edited}
        ).status_code
        == 200
    )
    with psycopg.connect(pg_url) as conn:
        identity(conn, TEACHER)
        for table, column, identifier in [
            ("teaching_materials", "provenance", material["id"]),
            ("consultation_reports", "snapshot", consultation["id"]),
        ]:
            with pytest.raises(psycopg.errors.CheckViolation):
                with conn.transaction():
                    conn.execute(f"UPDATE {table} SET {column}='{{}}' WHERE id=%s", (identifier,))
        conn.rollback()


def test_postgres_failed_offline_upload_rolls_back_all_rows(pg_client, pg_url, assessment_payload):
    assessment, key = create_assessment(pg_client, assessment_payload)
    sub = submission_payload(assessment, key)
    score = pg_client.post(
        "/v1/scoring/preview", json={"answer_key_id": key["id"], "answers": sub["answers"]}
    ).json()
    client_score = {k: score[k] for k in ["automatic_score", "final_score", "possible_score", "items"]}
    client_score["final_score"] = "99.00"
    response = pg_client.post(
        "/v1/uploads/submissions",
        json={
            "submission": sub,
            "teacher_approved": True,
            "local_approved_at": "2026-09-15T00:00:00Z",
            "client_score": client_score,
        },
    )
    assert response.status_code == 409, response.text
    with psycopg.connect(pg_url) as conn:
        for table, column in [
            ("submissions", "id"),
            ("submission_answers", "submission_id"),
            ("item_results", "submission_id"),
            ("upload_receipts", "id"),
        ]:
            assert (
                conn.execute(f"SELECT count(*) FROM {table} WHERE {column}=%s", (sub["id"],)).fetchone()[0]
                == 0
            )
