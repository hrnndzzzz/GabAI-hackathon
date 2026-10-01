from datetime import date
from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Request, UploadFile
from sqlalchemy.orm import Session

from app.auth import Principal, get_principal
from app.db import get_db
from app.errors import fail
from app.models import UploadReceipt
from app.repository import Repo
from app.roster_parser import MAX_BYTES
from app.roster_schemas import RosterImportOut, RosterOptions, RosterPreview
from app.roster_service import import_roster, roster_preview

router = APIRouter(prefix="/v1/roster-imports", tags=["Student roster imports"])
Auth = Annotated[Principal, Depends(get_principal)]
DB = Annotated[Session, Depends(get_db, scope="function")]


def import_options(
    academic_year_id: Annotated[UUID, Form()],
    starts_on: Annotated[date, Form()],
    default_section: Annotated[str, Form(min_length=1, max_length=120)] = "Unassigned",
    sheet_name: Annotated[str | None, Form(min_length=1, max_length=120)] = None,
):
    if not default_section.strip() or (sheet_name is not None and not sheet_name.strip()):
        fail(422, "invalid_import_options", "Section and worksheet names cannot be blank")
    if any(ord(c) < 32 for c in default_section) or default_section.lstrip().startswith(("=", "+", "-", "@")):
        fail(422, "invalid_import_options", "Use a plain section name without formulas or control characters")
    return RosterOptions(
        academic_year_id=academic_year_id,
        starts_on=starts_on,
        default_section=default_section,
        sheet_name=sheet_name,
    )


Options = Annotated[RosterOptions, Depends(import_options)]


def process_file(request, file, callback):
    # Per-instance admission bound, in addition to request/file/ZIP/row/column bounds.
    if not request.app.state.roster_slots.acquire(blocking=False):
        fail(429, "roster_busy", "Roster parser is busy; retry shortly")
    try:
        max_bytes = min(MAX_BYTES, request.app.state.settings.max_roster_bytes)
        data = file.file.read(max_bytes + 1)
        if len(data) > max_bytes:
            fail(413, "roster_too_large", f"Roster file exceeds the {max_bytes}-byte limit")
        return callback(data, file.filename or "")
    finally:
        request.app.state.roster_slots.release()


@router.post("/preview", response_model=RosterPreview)
def preview(request: Request, user: Auth, db: DB, options: Options, file: Annotated[UploadFile, File()]):
    """Validate CSV/XLSX and preview grade/section assignments. Does not save records.

    Select an existing academic year and enrollment start date. Required columns:
    student_number, student_email, student_name, grade_level; optional section.
    Row errors return 200 with valid=false. File-level errors use the standard error envelope.
    """
    return process_file(
        request, file, lambda data, name: roster_preview(Repo(db, user.id), data, name, options)
    )


@router.post("", response_model=RosterImportOut)
def commit(
    request: Request,
    user: Auth,
    db: DB,
    options: Options,
    file: Annotated[UploadFile, File()],
    import_id: Annotated[UUID, Form()],
    expected_fingerprint: Annotated[str, Form(pattern=r"^[0-9a-f]{64}$")],
    confirmed: Annotated[bool, Form()],
):
    """Save all students and enrollments atomically after teacher confirmation.

    Re-send the previewed file/options and its fingerprint, plus a stable client import UUID.
    Identical retries return already_imported. Changed data with a reused UUID returns 409.
    Conflicting rows save nothing; preview again for detailed row errors.
    """
    if not confirmed:
        fail(409, "review_required", "Review the roster preview and explicitly confirm the import")
    return process_file(
        request,
        file,
        lambda data, name: import_roster(
            Repo(db, user.id), data, name, options, import_id, expected_fingerprint
        ),
    )


@router.get("/{import_id}", response_model=RosterImportOut)
def get_import(import_id: UUID, user: Auth, db: DB):
    """Retrieve the original teacher-scoped import receipt, including assigned server UUIDs."""
    record = Repo(db, user.id).get(UploadReceipt, import_id)
    if record.kind != "roster":
        fail(404, "not_found", "Record not found")
    return RosterImportOut.model_validate(record.response)
