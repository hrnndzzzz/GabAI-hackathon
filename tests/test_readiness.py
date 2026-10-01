from unittest.mock import MagicMock

import pytest

from app.errors import DomainError
from app.models import Base
from app.readiness import check_production_database


def connection(role=("teachease_login", False, False), missing_column=None, unprotected=None):
    conn = MagicMock()
    role_result, columns_result, rls_result = MagicMock(), MagicMock(), MagicMock()
    role_result.one.return_value = role
    columns_result.tuples.return_value = [
        (table.name, column.name)
        for table in Base.metadata.tables.values()
        for column in table.columns
        if (table.name, column.name) != missing_column
    ]
    rls_result.scalars.return_value = [table for table in Base.metadata.tables if table != unprotected]
    conn.execute.side_effect = [role_result, MagicMock(), MagicMock(), columns_result, rls_result]
    return conn


@pytest.mark.parametrize("role", [("postgres", True, True), ("teachease_login", False, True)])
def test_readiness_rejects_privileged_credentials(role):
    with pytest.raises(DomainError) as caught:
        check_production_database(connection(role))
    assert caught.value.status == 503 and caught.value.code == "database_misconfigured"


@pytest.mark.parametrize("column", ["student_number", "email"])
def test_readiness_rejects_missing_roster_migration(column):
    with pytest.raises(DomainError) as caught:
        check_production_database(connection(missing_column=("students", column)))
    assert caught.value.status == 503 and caught.value.code == "database_schema_outdated"


def test_readiness_rejects_missing_student_rls():
    with pytest.raises(DomainError) as caught:
        check_production_database(connection(unprotected="students"))
    assert caught.value.code == "database_misconfigured"


def test_readiness_accepts_complete_restricted_schema():
    check_production_database(connection())
