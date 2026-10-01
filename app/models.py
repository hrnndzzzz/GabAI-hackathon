"""Portable ORM schema; production DDL and RLS live in supabase/migrations."""

from datetime import date, datetime, timezone
from decimal import Decimal
from uuid import UUID, uuid4

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    Date,
    DateTime,
    ForeignKeyConstraint,
    Integer,
    LargeBinary,
    Numeric,
    String,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, declared_attr, mapped_column


def now():
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Owned:
    id: Mapped[UUID] = mapped_column(Uuid, primary_key=True, default=uuid4)
    owner_id: Mapped[UUID] = mapped_column(Uuid, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=now, onupdate=now)

    @declared_attr.directive
    def __table_args__(cls):
        return (UniqueConstraint("id", "owner_id"),)


def ref(table, column, target):
    return ForeignKeyConstraint(
        [column, "owner_id"],
        [f"{target}.id", f"{target}.owner_id"],
        name=f"fk_{table}_{column}",
        ondelete="RESTRICT",
    )


class Profile(Owned, Base):
    __tablename__ = "teacher_profiles"
    display_name: Mapped[str] = mapped_column(String(120), default="Teacher")
    # Mobile v1.2 profile: shown on the teacher's own devices only.
    full_name: Mapped[str | None] = mapped_column(String(120))
    school_name: Mapped[str | None] = mapped_column(String(160))
    avatar_style: Mapped[str] = mapped_column(String(10), default="initials")
    avatar_color: Mapped[str | None] = mapped_column(String(7))
    avatar_pattern: Mapped[str | None] = mapped_column(String(20))
    # Re-encoded 256 px JPEG (metadata stripped), at most a few tens of KB.
    avatar_image: Mapped[bytes | None] = mapped_column(LargeBinary, deferred=True)
    avatar_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    preferences: Mapped[dict] = mapped_column(JSON, default=dict)
    preferences_updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        UniqueConstraint("id", "owner_id"),
        UniqueConstraint("owner_id"),
        CheckConstraint("avatar_style IN ('initials', 'pattern', 'photo')"),
    )


class AcademicYear(Owned, Base):
    __tablename__ = "academic_years"
    name: Mapped[str] = mapped_column(String(120))
    starts_on: Mapped[date] = mapped_column(Date)
    ends_on: Mapped[date] = mapped_column(Date)
    __table_args__ = (UniqueConstraint("id", "owner_id"), CheckConstraint("ends_on >= starts_on"))


class Term(Owned, Base):
    __tablename__ = "terms"
    name: Mapped[str] = mapped_column(String(120))
    academic_year_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    starts_on: Mapped[date] = mapped_column(Date)
    ends_on: Mapped[date] = mapped_column(Date)
    __table_args__ = (
        UniqueConstraint("id", "owner_id"),
        ref(__tablename__, "academic_year_id", "academic_years"),
        CheckConstraint("ends_on >= starts_on"),
    )


class GradeLevel(Owned, Base):
    __tablename__ = "grade_levels"
    name: Mapped[str] = mapped_column(String(120))
    # School level and grade number, set for grade levels created by the mobile app's classes.
    level: Mapped[str | None] = mapped_column(String(20))
    grade: Mapped[int | None] = mapped_column(Integer)
    __table_args__ = (
        UniqueConstraint("id", "owner_id"),
        UniqueConstraint("owner_id", "level", "grade"),
        CheckConstraint("level IS NULL OR level IN ('elementary', 'highschool', 'college')"),
        CheckConstraint(
            "(level IS NULL AND grade IS NULL) OR (level = 'elementary' AND grade BETWEEN 0 AND 6)"
            " OR (level = 'highschool' AND grade BETWEEN 7 AND 12) OR (level = 'college' AND grade BETWEEN 1 AND 4)"
        ),
    )


class Section(Owned, Base):
    __tablename__ = "sections"
    name: Mapped[str] = mapped_column(String(120))
    grade_level_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    academic_year_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    __table_args__ = (
        UniqueConstraint("id", "owner_id"),
        ref(__tablename__, "grade_level_id", "grade_levels"),
        ref(__tablename__, "academic_year_id", "academic_years"),
    )


class Student(Owned, Base):
    __tablename__ = "students"
    display_name: Mapped[str] = mapped_column(String(120))
    local_identifier: Mapped[str | None] = mapped_column(String(120))


class Enrollment(Owned, Base):
    __tablename__ = "enrollments"
    student_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    section_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    starts_on: Mapped[date] = mapped_column(Date)
    ends_on: Mapped[date | None] = mapped_column(Date)
    __table_args__ = (
        UniqueConstraint("id", "owner_id"),
        ref(__tablename__, "student_id", "students"),
        ref(__tablename__, "section_id", "sections"),
        CheckConstraint("ends_on IS NULL OR ends_on >= starts_on"),
    )


class Subject(Owned, Base):
    __tablename__ = "subjects"
    name: Mapped[str] = mapped_column(String(120))


class Competency(Owned, Base):
    __tablename__ = "competencies"
    name: Mapped[str] = mapped_column(String(120))
    subject_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    __table_args__ = (UniqueConstraint("id", "owner_id"), ref(__tablename__, "subject_id", "subjects"))


class TeachingClass(Owned, Base):
    """A section the teacher teaches one subject to, with its class list (the mobile app's "class")."""

    __tablename__ = "teaching_classes"
    section_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    subject_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    # Current class list in the teacher's order: [{"student_id": ...}]. Enrollments keep the history.
    roster: Mapped[list] = mapped_column(JSON, default=list)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    __table_args__ = (
        UniqueConstraint("id", "owner_id"),
        ref(__tablename__, "section_id", "sections"),
        ref(__tablename__, "subject_id", "subjects"),
    )


class Assessment(Owned, Base):
    __tablename__ = "assessments"
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str | None] = mapped_column(Text)
    template_id: Mapped[str] = mapped_column(String(100))
    subject_id: Mapped[UUID | None] = mapped_column(Uuid, index=True)
    term_id: Mapped[UUID | None] = mapped_column(Uuid, index=True)
    assessment_date: Mapped[date] = mapped_column(Date)
    category: Mapped[str | None] = mapped_column(String(80))
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    class_id: Mapped[UUID | None] = mapped_column(Uuid, index=True)
    due_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        UniqueConstraint("id", "owner_id"),
        ref(__tablename__, "subject_id", "subjects"),
        ref(__tablename__, "term_id", "terms"),
        ref(__tablename__, "class_id", "teaching_classes"),
    )


class AnswerKey(Owned, Base):
    __tablename__ = "answer_key_versions"
    assessment_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    version: Mapped[int] = mapped_column(Integer)
    verified: Mapped[bool] = mapped_column(Boolean, default=False)
    verified_by: Mapped[UUID | None] = mapped_column(Uuid)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        UniqueConstraint("id", "owner_id"),
        ref(__tablename__, "assessment_id", "assessments"),
        UniqueConstraint("assessment_id", "version"),
        CheckConstraint("version > 0"),
    )


class Question(Owned, Base):
    __tablename__ = "assessment_questions"
    answer_key_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    number: Mapped[int] = mapped_column(Integer)
    kind: Mapped[str] = mapped_column(String(24))
    points: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    correct_answer: Mapped[str | None] = mapped_column(String(200))
    alternatives: Mapped[list] = mapped_column(JSON, default=list)
    choices: Mapped[list] = mapped_column(JSON, default=list)
    rubric: Mapped[str | None] = mapped_column(Text)
    __table_args__ = (
        UniqueConstraint("id", "owner_id"),
        ref(__tablename__, "answer_key_id", "answer_key_versions"),
        UniqueConstraint("answer_key_id", "number"),
        CheckConstraint("number > 0 AND points > 0"),
        CheckConstraint("kind IN ('multiple_choice', 'true_false', 'essay')"),
    )


class QuestionCompetency(Owned, Base):
    __tablename__ = "question_competencies"
    question_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    competency_id: Mapped[UUID] = mapped_column(Uuid)
    competency_name: Mapped[str] = mapped_column(String(120))  # Immutable historical label.
    __table_args__ = (
        UniqueConstraint("id", "owner_id"),
        ref(__tablename__, "question_id", "assessment_questions"),
        ref(__tablename__, "competency_id", "competencies"),
        UniqueConstraint("question_id", "competency_id"),
    )


class Submission(Owned, Base):
    __tablename__ = "submissions"
    assessment_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    answer_key_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    student_label: Mapped[str] = mapped_column(String(120))
    student_id: Mapped[UUID | None] = mapped_column(Uuid, index=True)
    enrollment_id: Mapped[UUID | None] = mapped_column(Uuid)
    source: Mapped[str] = mapped_column(String(20))
    status: Mapped[str] = mapped_column(String(20), default="draft")
    revision: Mapped[int] = mapped_column(Integer, default=1)
    automatic_score: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)
    final_score: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)
    possible_score: Mapped[Decimal] = mapped_column(Numeric(10, 2), default=0)
    approved_by: Mapped[UUID | None] = mapped_column(Uuid)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    local_approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # When the paper was handed in (the app sends its capture time); decides "late" against due_at.
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        UniqueConstraint("id", "owner_id"),
        ref(__tablename__, "assessment_id", "assessments"),
        ref(__tablename__, "answer_key_id", "answer_key_versions"),
        ref(__tablename__, "student_id", "students"),
        ref(__tablename__, "enrollment_id", "enrollments"),
        CheckConstraint("status IN ('draft', 'approved')"),
        CheckConstraint("source IN ('on_device', 'gemini', 'manual')"),
        CheckConstraint("automatic_score >= 0 AND final_score >= 0 AND final_score <= possible_score"),
    )


class SubmissionAnswer(Owned, Base):
    __tablename__ = "submission_answers"
    submission_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    number: Mapped[int] = mapped_column(Integer)
    state: Mapped[str] = mapped_column(String(24))
    value: Mapped[str | None] = mapped_column(Text)
    extracted: Mapped[dict | None] = mapped_column(JSON)
    __table_args__ = (
        UniqueConstraint("id", "owner_id"),
        ref(__tablename__, "submission_id", "submissions"),
        UniqueConstraint("submission_id", "number"),
        CheckConstraint(
            "state IN ('recognized','blank_candidate','ambiguous','unreadable','confirmed','confirmed_blank')"
        ),
    )


class ItemResult(Owned, Base):
    __tablename__ = "item_results"
    submission_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    question_id: Mapped[UUID] = mapped_column(Uuid)
    number: Mapped[int] = mapped_column(Integer)
    resolved: Mapped[bool] = mapped_column(Boolean)
    automatic_score: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    adjusted_score: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    final_score: Mapped[Decimal | None] = mapped_column(Numeric(10, 2))
    possible_score: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    __table_args__ = (
        UniqueConstraint("id", "owner_id"),
        ref(__tablename__, "submission_id", "submissions"),
        ref(__tablename__, "question_id", "assessment_questions"),
        UniqueConstraint("submission_id", "number"),
        CheckConstraint("final_score IS NULL OR (final_score >= 0 AND final_score <= possible_score)"),
    )


class Adjustment(Owned, Base):
    __tablename__ = "score_adjustments"
    submission_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    number: Mapped[int] = mapped_column(Integer)
    score: Mapped[Decimal] = mapped_column(Numeric(10, 2))
    reason: Mapped[str] = mapped_column(Text)
    actor_id: Mapped[UUID] = mapped_column(Uuid)
    sequence: Mapped[int] = mapped_column(Integer)
    __table_args__ = (
        UniqueConstraint("id", "owner_id"),
        ref(__tablename__, "submission_id", "submissions"),
        UniqueConstraint("submission_id", "sequence"),
        CheckConstraint("score >= 0"),
    )


class Material(Owned, Base):
    __tablename__ = "teaching_materials"
    kind: Mapped[str] = mapped_column(String(30))
    content: Mapped[dict] = mapped_column(JSON)
    original_content: Mapped[dict] = mapped_column(JSON)
    provenance: Mapped[dict] = mapped_column(JSON)
    revision: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(20), default="draft")
    reviewed_by: Mapped[UUID | None] = mapped_column(Uuid)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class ExpectedAssessment(Owned, Base):
    __tablename__ = "expected_assessments"
    assessment_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    enrollment_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    __table_args__ = (
        UniqueConstraint("id", "owner_id"),
        ref(__tablename__, "assessment_id", "assessments"),
        ref(__tablename__, "enrollment_id", "enrollments"),
        UniqueConstraint("assessment_id", "enrollment_id"),
    )


class Consultation(Owned, Base):
    __tablename__ = "consultation_reports"
    student_id: Mapped[UUID] = mapped_column(Uuid, index=True)
    subject_id: Mapped[UUID] = mapped_column(Uuid)
    term_id: Mapped[UUID] = mapped_column(Uuid)
    snapshot: Mapped[dict] = mapped_column(JSON)
    content: Mapped[dict] = mapped_column(JSON)
    original_content: Mapped[dict] = mapped_column(JSON)
    provenance: Mapped[dict] = mapped_column(JSON)
    teacher_notes: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(20), default="draft")
    revision: Mapped[int] = mapped_column(Integer, default=1)
    approved_by: Mapped[UUID | None] = mapped_column(Uuid)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        UniqueConstraint("id", "owner_id"),
        ref(__tablename__, "student_id", "students"),
        ref(__tablename__, "subject_id", "subjects"),
        ref(__tablename__, "term_id", "terms"),
    )


class CalendarEvent(Owned, Base):
    __tablename__ = "calendar_events"
    title: Mapped[str] = mapped_column(String(80))
    type: Mapped[str] = mapped_column(String(20))
    starts_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), index=True)
    duration_min: Mapped[int] = mapped_column(Integer, default=0)
    all_day: Mapped[bool] = mapped_column(Boolean, default=False)
    class_id: Mapped[UUID | None] = mapped_column(Uuid)
    assessment_id: Mapped[UUID | None] = mapped_column(Uuid)
    notes: Mapped[str] = mapped_column(Text, default="")
    revision: Mapped[int] = mapped_column(Integer, default=1)
    # Soft delete, so other devices learn about removals through incremental sync.
    deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    __table_args__ = (
        UniqueConstraint("id", "owner_id"),
        ref(__tablename__, "class_id", "teaching_classes"),
        ref(__tablename__, "assessment_id", "assessments"),
        CheckConstraint("type IN ('exam', 'quiz', 'class', 'deadline', 'meeting', 'reminder')"),
        CheckConstraint("duration_min BETWEEN 0 AND 600"),
    )


class Feedback(Owned, Base):
    __tablename__ = "feedback_messages"
    message: Mapped[str] = mapped_column(Text)
    app_version: Mapped[str | None] = mapped_column(String(40))
    platform: Mapped[str | None] = mapped_column(String(40))


class UploadReceipt(Owned, Base):
    __tablename__ = "upload_receipts"
    kind: Mapped[str] = mapped_column(String(30))
    payload_hash: Mapped[str] = mapped_column(String(64))
    response: Mapped[dict] = mapped_column(JSON)
    __table_args__ = (UniqueConstraint("id", "owner_id"),)


class RateBucket(Base):
    __tablename__ = "ai_rate_buckets"
    owner_id: Mapped[UUID] = mapped_column(Uuid, primary_key=True)
    bucket: Mapped[int] = mapped_column(Integer, nullable=False)
    count: Mapped[int] = mapped_column(Integer, nullable=False)
