"""Explicit upgrade for an existing LOCAL SQLite database; production uses Supabase migrations."""

import argparse
import sqlite3
from contextlib import closing
from pathlib import Path


def migrate(path: Path):
    # mode=rw refuses nonexistent paths; no accidental new empty database.
    with closing(sqlite3.connect(path.resolve().as_uri() + "?mode=rw", uri=True)) as conn, conn:
        conn.execute("BEGIN IMMEDIATE")
        columns = {row[1] for row in conn.execute("PRAGMA table_info(students)")}
        if not {"id", "owner_id", "display_name"}.issubset(columns):
            raise ValueError("Expected an existing TeachEase students table")
        if "student_number" not in columns:
            conn.execute(
                "ALTER TABLE students ADD COLUMN student_number VARCHAR(120) CHECK (student_number IS NULL OR length(trim(student_number)) > 0)"
            )
        if "email" not in columns:
            conn.execute("ALTER TABLE students ADD COLUMN email VARCHAR(254)")
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS uq_students_owner_number ON students(owner_id, student_number)"
        )


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path, help="Path to an existing local SQLite database; back it up first")
    migrate(parser.parse_args().path)
    print("Local student fields upgraded; existing IDs and records preserved")
