from datetime import date, datetime
from typing import Annotated, Literal
from uuid import UUID

from pydantic import EmailStr, Field

from app.schemas import Schema, Short


class RosterOptions(Schema):
    academic_year_id: UUID
    starts_on: date
    default_section: Short = "Unassigned"
    sheet_name: Short | None = None


class RosterRow(Schema):
    row: int
    student_number: Short
    email: Annotated[EmailStr, Field(max_length=254)]
    display_name: Short
    grade_level: Short
    section: Short


class RosterIssue(Schema):
    row: int
    field: str
    code: str
    message: str


class RosterAssignment(RosterRow):
    student_id: UUID | None = None
    grade_level_id: UUID | None = None
    section_id: UUID | None = None
    enrollment_id: UUID | None = None
    student_action: Literal["create", "reuse"] = "create"
    enrollment_action: Literal["create", "reuse"] = "create"


class RosterPreview(Schema):
    valid: bool
    fingerprint: str
    options: RosterOptions
    total_rows: int
    assignments: list[RosterAssignment]
    issues: list[RosterIssue]


class RosterImportOut(Schema):
    import_id: UUID
    status: Literal["imported", "already_imported"]
    created_at: datetime
    students_created: int
    students_reused: int
    enrollments_created: int
    assignments: list[RosterAssignment]
