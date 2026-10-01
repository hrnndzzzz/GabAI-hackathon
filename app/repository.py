from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.errors import fail


class Repo:
    def __init__(self, session: Session, owner: UUID):
        self.db, self.owner = session, owner

    def query(self, model):
        return select(model).where(model.owner_id == self.owner)

    def get(self, model, identifier, *, lock=False):
        query = self.query(model).where(model.id == identifier)
        if lock:
            query = query.with_for_update()
        value = self.db.scalar(query)
        if value is None:
            fail(404, "not_found", "Record not found")
        return value

    def add(self, model, **values):
        value = model(owner_id=self.owner, **values)
        self.db.add(value)
        self.db.flush()
        return value

    def rows(self, model, *conditions):
        return list(self.db.scalars(self.query(model).where(*conditions)))

    def page(self, model, limit, offset, *conditions):
        rows = list(
            self.db.scalars(
                self.query(model)
                .where(*conditions)
                .order_by(model.created_at, model.id)
                .limit(limit + 1)
                .offset(offset)
            )
        )
        return rows[:limit], len(rows) > limit


def check_revision(record, revision):
    if record.revision != revision:
        fail(409, "stale_revision", "Record changed; download it and review the latest revision")


def draft_only(record):
    if record.status == "approved":
        fail(
            409,
            "already_approved",
            "Approved results are immutable; create a new submission for a correction",
        )
