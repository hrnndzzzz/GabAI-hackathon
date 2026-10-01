"""Read-only production checks: connecting alone does not prove the API can use its schema."""

from sqlalchemy import text

from app.errors import fail
from app.models import Base


def check_production_database(conn):
    role = conn.execute(
        text("SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user")
    ).one()
    if role[0] != "teachease_login" or role[1] or role[2]:
        fail(503, "database_misconfigured", "Database runtime role is not configured correctly")
    # The enclosing transaction rolls back this role change when the connection is returned.
    conn.execute(text("SET LOCAL ROLE teachease_api"))
    conn.execute(text("SET LOCAL statement_timeout = '5000'"))
    columns = set(
        conn.execute(
            text("SELECT table_name, column_name FROM information_schema.columns WHERE table_schema='public'")
        ).tuples()
    )
    required = {
        (table.name, column.name) for table in Base.metadata.tables.values() for column in table.columns
    }
    if not required.issubset(columns):
        fail(503, "database_schema_outdated", "Required database migrations or table permissions are missing")
    protected = set(
        conn.execute(
            text(
                "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace "
                "WHERE n.nspname='public' AND c.relkind='r' AND c.relrowsecurity AND c.relforcerowsecurity"
            )
        ).scalars()
    )
    if not set(Base.metadata.tables).issubset(protected):
        fail(503, "database_misconfigured", "Required database access protections are missing")
