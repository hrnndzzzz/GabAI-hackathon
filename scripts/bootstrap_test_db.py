"""Initialize Supabase-like auth stubs ONLY in an empty disposable test database."""

import os
from pathlib import Path

import psycopg


def main():
    url = os.environ.get("TEST_POSTGRES_URL")
    if not url:
        raise SystemExit("Set TEST_POSTGRES_URL for an empty, disposable database")
    with psycopg.connect(url, autocommit=True) as conn:
        if conn.execute("SELECT to_regnamespace('auth')").fetchone()[0] is not None:
            raise SystemExit(
                "Refusing to bootstrap an existing auth schema. Use a new disposable test database."
            )
        conn.execute((Path(__file__).parents[1] / "tests/postgres_bootstrap.sql").read_text(encoding="utf-8"))
    print("Bootstrapped disposable test Auth schema")


if __name__ == "__main__":
    main()
