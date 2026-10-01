import json
from collections.abc import Generator

from fastapi import Depends, Request
from sqlalchemy import create_engine, event, inspect, text
from sqlalchemy.orm import Session
from sqlalchemy.pool import StaticPool

from app.auth import Principal, get_principal


def make_engine(settings):
    url = settings.database_url.get_secret_value()
    if url.startswith("sqlite"):
        kwargs = {"connect_args": {"check_same_thread": False}}
        if ":memory:" in url:
            kwargs["poolclass"] = StaticPool
        engine = create_engine(url, **kwargs)

        @event.listens_for(engine, "connect")
        def foreign_keys(connection, _):
            connection.execute("PRAGMA foreign_keys=ON")

        return engine
    return create_engine(
        url, pool_pre_ping=True, pool_size=settings.db_pool_size, max_overflow=settings.db_max_overflow
    )


def upgrade_sqlite(engine, metadata):
    """Local/test SQLite only. create_all adds new tables but never new columns, so add any column a
    newer release introduced to an existing development database. Production uses supabase/migrations."""
    inspector = inspect(engine)
    with engine.begin() as conn:
        for table in metadata.sorted_tables:
            if not inspector.has_table(table.name):
                continue
            existing = {column["name"] for column in inspector.get_columns(table.name)}
            for column in table.columns:
                if column.name not in existing:
                    kind = column.type.compile(dialect=engine.dialect)
                    conn.execute(text(f'ALTER TABLE "{table.name}" ADD COLUMN "{column.name}" {kind}'))


def apply_identity(session: Session, principal: Principal):
    if session.bind.dialect.name == "postgresql":
        session.execute(text("SET LOCAL ROLE teachease_api"))
        session.execute(
            text("SELECT set_config('request.jwt.claims', :claims, true)"),
            {"claims": json.dumps({"sub": str(principal.id), "role": "authenticated", "aal": principal.aal})},
        )
        session.execute(text("SET LOCAL statement_timeout = '15000'"))


def get_db(request: Request, principal: Principal = Depends(get_principal)) -> Generator[Session]:
    with Session(request.app.state.engine, expire_on_commit=False) as session:
        with session.begin():
            apply_identity(session, principal)
            yield session
            session.flush()
