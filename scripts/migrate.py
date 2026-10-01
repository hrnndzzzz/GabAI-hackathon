"""Explicit migration runner. Requires administrator URL in MIGRATION_DATABASE_URL; never starts automatically."""

import os
from pathlib import Path

import psycopg


def main():
    url = os.environ.get("MIGRATION_DATABASE_URL")
    if not url:
        raise SystemExit("Set MIGRATION_DATABASE_URL for a database you intend to migrate")
    folder = Path(__file__).resolve().parents[1] / "supabase/migrations"
    with psycopg.connect(url, autocommit=True) as conn:
        conn.execute(
            "CREATE TABLE IF NOT EXISTS public.teachease_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())"
        )
        conn.execute("REVOKE ALL ON public.teachease_migrations FROM PUBLIC, anon, authenticated")
        conn.execute("SELECT pg_advisory_lock(7290122026)")
        try:
            for path in sorted(folder.glob("*.sql")):
                if conn.execute(
                    "SELECT 1 FROM public.teachease_migrations WHERE name=%s", (path.name,)
                ).fetchone():
                    continue
                # Migration files include their own transaction. Record marker in that same transaction.
                sql = path.read_text(encoding="utf-8")
                marker = (
                    "INSERT INTO public.teachease_migrations(name) VALUES ('" + path.name + "');\nCOMMIT;"
                )
                conn.execute(sql.rsplit("COMMIT;", 1)[0] + marker)
                print("Applied", path.name)
        finally:
            conn.execute("SELECT pg_advisory_unlock(7290122026)")


if __name__ == "__main__":
    main()
