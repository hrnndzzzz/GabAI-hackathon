"""Run PostgreSQL tests using portable Windows binaries already downloaded to .tools/pgsql.

Creates only a loopback test cluster under this workspace; never installs a Windows service.
The caller supplies pytest arguments. Credentials are random, local and never printed.
"""

import os
import secrets
import subprocess
import sys
import tempfile
from pathlib import Path

import psycopg

ROOT = Path(__file__).resolve().parents[1]
TOOLS = ROOT / ".tools"
BIN = TOOLS / "pgsql" / "bin"
DATA = TOOLS / "pgdata"
PASSWORD = TOOLS / "test-pg-password.txt"


def run(args, **kwargs):
    # pg_ctl's background server inherits handles; a pipe would wait for the server to exit.
    with tempfile.TemporaryFile() as output:
        result = subprocess.run(
            args,
            cwd=ROOT,
            creationflags=subprocess.CREATE_NO_WINDOW,
            stdout=output,
            stderr=subprocess.STDOUT,
            **kwargs,
        )
        output.seek(0)
        print(output.read().decode("utf-8", errors="replace"), end="", flush=True)
    result.check_returncode()
    return result


def main():
    if os.name != "nt" or not (BIN / "pg_ctl.exe").exists():
        raise SystemExit(
            "This helper requires Windows and official portable PostgreSQL binaries in .tools/pgsql"
        )
    if sys.argv[1:] == ["--stop"]:
        run([str(BIN / "pg_ctl.exe"), "-D", str(DATA), "-m", "fast", "-w", "stop"])
        return
    if not PASSWORD.exists():
        PASSWORD.write_text(secrets.token_urlsafe(32), encoding="ascii")
    password = PASSWORD.read_text(encoding="ascii").strip()
    if not (DATA / "PG_VERSION").exists():
        run(
            [
                str(BIN / "initdb.exe"),
                "-D",
                str(DATA),
                "-U",
                "postgres",
                "-A",
                "scram-sha-256",
                "--pwfile",
                str(PASSWORD),
                "--encoding=UTF8",
                "--locale=C",
            ]
        )
    run(
        [
            str(BIN / "pg_ctl.exe"),
            "-D",
            str(DATA),
            "-l",
            str(TOOLS / "postgres-test.log"),
            "-o",
            "-h 127.0.0.1 -p 55432",
            "-w",
            "start",
        ]
    )
    try:
        url = f"postgresql://postgres:{password}@127.0.0.1:55432/postgres"
        env = os.environ | {"TEST_POSTGRES_URL": url, "MIGRATION_DATABASE_URL": url}
        with psycopg.connect(url, autocommit=True) as conn:
            if conn.execute("SELECT to_regnamespace('auth')").fetchone()[0] is None:
                run([sys.executable, "scripts/bootstrap_test_db.py"], env=env)
        run([sys.executable, "scripts/migrate.py"], env=env)
        test_temp = TOOLS / "test-runs" / secrets.token_hex(8)
        assert test_temp.resolve().is_relative_to(ROOT)
        test_temp.parent.mkdir(parents=True, exist_ok=True)
        run(
            [
                sys.executable,
                "-m",
                "pytest",
                "--basetemp",
                str(test_temp),
                "--tb=short",
                *(sys.argv[1:] or ["-m", "postgres", "-q"]),
            ],
            env=env,
        )
    finally:
        run([str(BIN / "pg_ctl.exe"), "-D", str(DATA), "-m", "fast", "-w", "stop"])


if __name__ == "__main__":
    main()
