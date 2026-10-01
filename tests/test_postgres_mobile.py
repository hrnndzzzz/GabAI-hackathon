"""The mobile v1.2 API scenarios again, on migrated PostgreSQL with RLS (not SQLite)."""

import inspect

import psycopg
import pytest
from fastapi.testclient import TestClient

from app.auth import Principal, get_principal
from app.config import Settings
from app.main import create_app
from app.models import Base
from tests import test_mobile
from tests.conftest import TEACHER
from tests.test_postgres import pg_url  # noqa: F401  (fixture)

pytestmark = pytest.mark.postgres

SCENARIOS = [
    getattr(test_mobile, name)
    for name in dir(test_mobile)
    if name.startswith("test_") and "client" in inspect.signature(getattr(test_mobile, name)).parameters
]


@pytest.fixture
def pg_app(pg_url):  # noqa: F811
    # Each scenario starts from empty application tables (the auth stub users stay).
    with psycopg.connect(pg_url, autocommit=True) as conn:
        tables = ", ".join(f"public.{name}" for name in Base.metadata.tables)
        conn.execute(f"TRUNCATE {tables} CASCADE")
    url = pg_url.replace("postgresql://", "postgresql+psycopg://", 1)
    app = create_app(Settings(app_env="test", database_url=url, _env_file=None))
    app.dependency_overrides[get_principal] = lambda: Principal(TEACHER, "aal2")
    return app


@pytest.mark.parametrize("scenario", SCENARIOS, ids=[f.__name__ for f in SCENARIOS])
def test_mobile_scenario_on_postgres(scenario, pg_app, assessment_payload):
    with TestClient(pg_app) as client:
        available = {"client": client, "app": pg_app, "assessment_payload": assessment_payload}
        scenario(**{name: available[name] for name in inspect.signature(scenario).parameters})
