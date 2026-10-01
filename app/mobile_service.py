"""Mobile v1.2: classes with class lists, late and pending tracking, section summaries, avatars.

A mobile "class" is one section taught one subject. Its class list is stored on the class in the
teacher's order, and mirrored into the existing organization model (students, enrollments,
expected assessments) so performance reports and associations keep working.
"""

import io
import warnings
from datetime import date, timedelta
from decimal import ROUND_HALF_UP, Decimal
from uuid import UUID

from PIL import Image, ImageOps, UnidentifiedImageError

from app import models as m
from app import schemas as s
from app.errors import DomainError, fail
from app.organization_service import close_enrollment
from app.schemas import as_utc

MAX_CLASSES = 60
AVATAR_PX = 256
MAX_AVATAR_BYTES = 512 * 1024


def name_key(name: str) -> str:
    return " ".join(name.split()).casefold()


def grade_name(level: str, grade: int) -> str:
    if level == "college":
        return f"{grade}{ {1: 'st', 2: 'nd', 3: 'rd'}.get(grade, 'th') } Year College"
    return "Kindergarten" if grade == 0 else f"Grade {grade}"


# --- Organization lookups (find or create, per teacher) ------------------------------------


def current_year(repo, today: date) -> m.AcademicYear:
    """The school year covering today, created as a June-to-May year when the teacher has none."""
    for year in repo.rows(m.AcademicYear, m.AcademicYear.starts_on <= today, m.AcademicYear.ends_on >= today):
        return year
    start = date(today.year if today.month >= 6 else today.year - 1, 6, 1)
    return repo.add(
        m.AcademicYear,
        name=f"SY {start.year}-{start.year + 1}",
        starts_on=start,
        ends_on=date(start.year + 1, 5, 31),
    )


def grade_level_for(repo, level: str, grade: int) -> m.GradeLevel:
    found = repo.rows(m.GradeLevel, m.GradeLevel.level == level, m.GradeLevel.grade == grade)
    return (
        found[0] if found else repo.add(m.GradeLevel, name=grade_name(level, grade), level=level, grade=grade)
    )


def subject_for(repo, name: str) -> m.Subject:
    key = name_key(name)
    for subject in repo.rows(m.Subject):
        if name_key(subject.name) == key:
            return subject
    return repo.add(m.Subject, name=" ".join(name.split()))


def section_for(repo, grade_level: m.GradeLevel, name: str, year: m.AcademicYear) -> m.Section:
    key = name_key(name)
    for section in repo.rows(
        m.Section, m.Section.grade_level_id == grade_level.id, m.Section.academic_year_id == year.id
    ):
        if name_key(section.name) == key:
            return section
    return repo.add(
        m.Section, name=" ".join(name.split()), grade_level_id=grade_level.id, academic_year_id=year.id
    )


def roster_ids(cls: m.TeachingClass) -> list[UUID]:
    return [UUID(entry["student_id"]) for entry in cls.roster or []]


def section_students(repo, section: m.Section) -> dict[str, m.Student]:
    """Everyone ever enrolled in the section, by name, so re-adding a student keeps their history."""
    ids = {e.student_id for e in repo.rows(m.Enrollment, m.Enrollment.section_id == section.id)}
    students = repo.rows(m.Student, m.Student.id.in_(ids)) if ids else []
    return {name_key(student.display_name): student for student in students}


def open_enrollment(repo, student: m.Student, section: m.Section, year: m.AcademicYear, today: date):
    enrollments = repo.rows(
        m.Enrollment, m.Enrollment.student_id == student.id, m.Enrollment.section_id == section.id
    )
    for enrollment in enrollments:
        if enrollment.ends_on is None:
            return enrollment
    # New students cover the whole school year; a returning student starts after their last stint.
    last_end = max((e.ends_on for e in enrollments), default=None)
    starts = year.starts_on if last_end is None else max(today, last_end + timedelta(days=1))
    if starts > year.ends_on:
        return None
    return repo.add(m.Enrollment, student_id=student.id, section_id=section.id, starts_on=starts)


def expect(repo, assessment: m.Assessment, enrollment: m.Enrollment) -> None:
    """Record that this student should have a result for the assessment, when the dates allow it."""
    if enrollment.starts_on > assessment.assessment_date or (
        enrollment.ends_on and enrollment.ends_on < assessment.assessment_date
    ):
        return
    if assessment.term_id:
        term = repo.get(m.Term, assessment.term_id)
        section = repo.get(m.Section, enrollment.section_id)
        if term.academic_year_id != section.academic_year_id:
            return
    exists = repo.rows(
        m.ExpectedAssessment,
        m.ExpectedAssessment.assessment_id == assessment.id,
        m.ExpectedAssessment.enrollment_id == enrollment.id,
    )
    if not exists:
        repo.add(m.ExpectedAssessment, assessment_id=assessment.id, enrollment_id=enrollment.id)


def release(repo, cls: m.TeachingClass, student_id: UUID, today: date) -> None:
    """Take a student off the class list; close their enrollment unless another class still lists them."""
    others = repo.rows(
        m.TeachingClass,
        m.TeachingClass.section_id == cls.section_id,
        m.TeachingClass.id != cls.id,
        m.TeachingClass.archived.is_(False),
    )
    if any(student_id in roster_ids(other) for other in others):
        return
    for enrollment in repo.rows(
        m.Enrollment,
        m.Enrollment.student_id == student_id,
        m.Enrollment.section_id == cls.section_id,
        m.Enrollment.ends_on.is_(None),
    ):
        ends = max(today, enrollment.starts_on)
        for expected in repo.rows(m.ExpectedAssessment, m.ExpectedAssessment.enrollment_id == enrollment.id):
            assessment = repo.get(m.Assessment, expected.assessment_id)
            graded = repo.rows(
                m.Submission,
                m.Submission.enrollment_id == enrollment.id,
                m.Submission.assessment_id == assessment.id,
            )
            if assessment.assessment_date > ends and not graded:
                repo.db.delete(expected)
        repo.db.flush()
        try:
            close_enrollment(repo, enrollment, ends)
        except DomainError:
            # A result dated later still needs this enrollment; the class list no longer shows them.
            pass


# --- Classes --------------------------------------------------------------------------------


def class_out(repo, cls: m.TeachingClass) -> s.ClassOut:
    section = repo.get(m.Section, cls.section_id)
    grade_level = repo.get(m.GradeLevel, section.grade_level_id)
    subject = repo.get(m.Subject, cls.subject_id)
    ids = roster_ids(cls)
    by_id = {st.id: st for st in repo.rows(m.Student, m.Student.id.in_(ids))} if ids else {}
    students = [by_id[i] for i in ids if i in by_id]
    return s.ClassOut(
        id=cls.id,
        owner_id=cls.owner_id,
        created_at=cls.created_at,
        updated_at=cls.updated_at,
        level=grade_level.level or "highschool",
        grade=grade_level.grade if grade_level.grade is not None else 7,
        section=section.name,
        subject=subject.name,
        students=[st.display_name for st in students],
        student_ids=[st.id for st in students],
        section_id=section.id,
        subject_id=subject.id,
        grade_level_id=grade_level.id,
        academic_year_id=section.academic_year_id,
        archived=cls.archived,
        revision=cls.revision,
    )


def class_assessments(repo, cls: m.TeachingClass) -> list[m.Assessment]:
    return repo.rows(m.Assessment, m.Assessment.class_id == cls.id, m.Assessment.archived.is_(False))


def upsert_class(repo, class_id: UUID, payload: s.ClassIn, today: date) -> m.TeachingClass:
    cls = repo.db.scalar(repo.query(m.TeachingClass).where(m.TeachingClass.id == class_id).with_for_update())
    if cls and payload.expected_revision and cls.revision != payload.expected_revision:
        fail(409, "stale_revision", "This class changed on another device; download it before saving again")
    if cls is None and len(repo.rows(m.TeachingClass, m.TeachingClass.archived.is_(False))) >= MAX_CLASSES:
        fail(422, "too_many_classes", f"A teacher can keep up to {MAX_CLASSES} active classes")

    year = (
        repo.get(m.AcademicYear, payload.academic_year_id)
        if payload.academic_year_id
        else current_year(repo, today)
    )
    grade_level = grade_level_for(repo, payload.level, payload.grade)
    subject = subject_for(repo, payload.subject)
    section = section_for(repo, grade_level, payload.section, year)

    if cls is None:
        cls = repo.add(m.TeachingClass, id=class_id, section_id=section.id, subject_id=subject.id, roster=[])
        previous: list[UUID] = []
    else:
        previous = roster_ids(cls)
        if cls.section_id != section.id:
            # Moved to another section: the old section's list is released, the new one is built below.
            for student_id in previous:
                release(repo, cls, student_id, today)
            previous = []
            cls.section_id = section.id
        cls.subject_id = subject.id
        cls.archived = False
        cls.revision += 1

    known = section_students(repo, section)
    roster, enrollments = [], []
    for name in payload.students:
        student = known.get(name_key(name)) or repo.add(m.Student, display_name=name)
        known[name_key(name)] = student
        enrollment = open_enrollment(repo, student, section, year, today)
        if enrollment:
            enrollments.append(enrollment)
        roster.append({"student_id": str(student.id)})
    kept = {UUID(entry["student_id"]) for entry in roster}
    for student_id in previous:
        if student_id not in kept:
            release(repo, cls, student_id, today)
    cls.roster = roster
    for assessment in class_assessments(repo, cls):
        for enrollment in enrollments:
            expect(repo, assessment, enrollment)
    repo.db.flush()
    return cls


def class_enrollments(repo, cls: m.TeachingClass) -> dict[UUID, list[m.Enrollment]]:
    ids = roster_ids(cls)
    out: dict[UUID, list[m.Enrollment]] = {}
    if ids:
        for enrollment in repo.rows(
            m.Enrollment, m.Enrollment.section_id == cls.section_id, m.Enrollment.student_id.in_(ids)
        ):
            out.setdefault(enrollment.student_id, []).append(enrollment)
    return out


def expect_class(repo, assessment: m.Assessment) -> None:
    """A new assessment for a class expects a result from everyone on its class list."""
    cls = repo.get(m.TeachingClass, assessment.class_id)
    for enrollments in class_enrollments(repo, cls).values():
        for enrollment in enrollments:
            expect(repo, assessment, enrollment)


def link_by_name(repo, assessment: m.Assessment, label: str):
    """Match a result's student name to the class list, returning (student_id, enrollment_id)."""
    if not assessment.class_id:
        return None, None
    cls = repo.db.scalar(repo.query(m.TeachingClass).where(m.TeachingClass.id == assessment.class_id))
    if cls is None:
        return None, None
    ids = roster_ids(cls)
    if not ids:
        return None, None
    key = name_key(label)
    for student in repo.rows(m.Student, m.Student.id.in_(ids)):
        if name_key(student.display_name) != key:
            continue
        for enrollment in class_enrollments(repo, cls).get(student.id, []):
            if enrollment.starts_on <= assessment.assessment_date and (
                enrollment.ends_on is None or enrollment.ends_on >= assessment.assessment_date
            ):
                return student.id, enrollment.id
    return None, None


# --- Late, pending and summaries ------------------------------------------------------------


def handed_in(sub: m.Submission):
    return as_utc(sub.submitted_at or sub.local_approved_at or sub.approved_at)


def is_late(sub: m.Submission, assessment: m.Assessment) -> bool:
    when = handed_in(sub)
    return bool(assessment.due_at and when and when > as_utc(assessment.due_at))


def percent(sub: m.Submission) -> Decimal | None:
    if not sub.possible_score:
        return None
    return Decimal(sub.final_score) * 100 / Decimal(sub.possible_score)


def two(value: Decimal | None) -> Decimal | None:
    return None if value is None else value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def mean(values: list[Decimal]) -> Decimal | None:
    return two(sum(values) / len(values)) if values else None


def band(value: Decimal) -> str:
    if value >= 90:
        return "outstanding"
    if value >= 85:
        return "very_satisfactory"
    if value >= 80:
        return "satisfactory"
    if value >= 75:
        return "fairly_satisfactory"
    return "did_not_meet"


def class_results(repo, cls: m.TeachingClass, assessment_id: UUID | None):
    assessments = class_assessments(repo, cls)
    if assessment_id:
        assessments = [a for a in assessments if a.id == assessment_id]
        if not assessments:
            fail(404, "not_found", "That assessment is not part of this class")
    ids = [a.id for a in assessments]
    subs = (
        repo.rows(m.Submission, m.Submission.assessment_id.in_(ids), m.Submission.status == "approved")
        if ids
        else []
    )
    students = repo.rows(m.Student, m.Student.id.in_(roster_ids(cls))) if cls.roster else []
    order = {sid: i for i, sid in enumerate(roster_ids(cls))}
    students.sort(key=lambda st: order.get(st.id, 0))
    return assessments, subs, students


def owner_of(sub: m.Submission, students: list[m.Student]) -> m.Student | None:
    if sub.student_id:
        return next((st for st in students if st.id == sub.student_id), None)
    key = name_key(sub.student_label)
    return next((st for st in students if name_key(st.display_name) == key), None)


def summary(repo, cls: m.TeachingClass, assessment_id: UUID | None) -> s.ClassSummary:
    assessments, subs, students = class_results(repo, cls, assessment_id)
    by_id = {a.id: a for a in assessments}
    bands = s.Bands()
    values = []
    for sub in subs:
        value = percent(sub)
        if value is not None:
            values.append(value)
            setattr(bands, band(value), getattr(bands, band(value)) + 1)
    parts = []
    for assessment in assessments:
        mine = [sub for sub in subs if sub.assessment_id == assessment.id]
        done = {owner.id for owner in (owner_of(sub, students) for sub in mine) if owner}
        parts.append(
            s.AssessmentSummary(
                assessment_id=assessment.id,
                title=assessment.title,
                due_at=as_utc(assessment.due_at),
                average=mean([v for v in (percent(sub) for sub in mine) if v is not None]),
                results=len(mine),
                late=sum(is_late(sub, assessment) for sub in mine),
                pending=[
                    s.PendingStudent(student_id=st.id, name=st.display_name)
                    for st in students
                    if st.id not in done
                ],
            )
        )
    return s.ClassSummary(
        class_id=cls.id,
        average=mean(values),
        results=len(subs),
        late=sum(is_late(sub, by_id[sub.assessment_id]) for sub in subs),
        pending=sum(len(part.pending) for part in parts),
        bands=bands,
        assessments=parts,
    )


def student_stats(repo, cls: m.TeachingClass, assessment_id: UUID | None, sort: str) -> list[s.StudentStat]:
    assessments, subs, students = class_results(repo, cls, assessment_id)
    by_id = {a.id: a for a in assessments}
    rows: dict[str, dict] = {}
    for st in students:
        rows[f"id:{st.id}"] = {
            "student_id": st.id,
            "name": st.display_name,
            "on_class_list": True,
            "subs": [],
        }
    for sub in subs:
        owner = owner_of(sub, students)
        key = f"id:{owner.id}" if owner else f"name:{name_key(sub.student_label)}"
        rows.setdefault(
            key, {"student_id": sub.student_id, "name": sub.student_label, "on_class_list": False, "subs": []}
        )["subs"].append(sub)
    stats = []
    for row in rows.values():
        mine = row.pop("subs")
        times = sorted(t for t in (handed_in(sub) for sub in mine) if t)
        taken = {sub.assessment_id for sub in mine}
        stats.append(
            s.StudentStat(
                **row,
                average=mean([v for v in (percent(sub) for sub in mine) if v is not None]),
                results=len(mine),
                late=sum(is_late(sub, by_id[sub.assessment_id]) for sub in mine),
                missing=[a.id for a in assessments if a.id not in taken] if row["on_class_list"] else [],
                latest_at=times[-1] if times else None,
                oldest_at=times[0] if times else None,
            )
        )
    by_name = lambda st: name_key(st.name)  # noqa: E731
    if sort == "late":
        stats = [st for st in stats if st.late]
    if sort == "missing":
        stats = [st for st in stats if st.missing]
    keys = {
        "-average": lambda st: (st.average is None, -(st.average or 0), by_name(st)),
        "average": lambda st: (st.average is None, st.average or 0, by_name(st)),
        "latest": lambda st: (
            st.latest_at is None,
            -(st.latest_at.timestamp() if st.latest_at else 0),
            by_name(st),
        ),
        "oldest": lambda st: (
            st.oldest_at is None,
            st.oldest_at.timestamp() if st.oldest_at else 0,
            by_name(st),
        ),
        "late": lambda st: (-st.late, by_name(st)),
        "missing": lambda st: (-len(st.missing), by_name(st)),
        "name": by_name,
    }
    if sort == "-name":
        return sorted(stats, key=by_name, reverse=True)
    return sorted(stats, key=keys[sort])


# --- Profile and avatars --------------------------------------------------------------------


def ensure_profile(repo, user_id: UUID) -> m.Profile:
    profile = repo.db.scalar(repo.query(m.Profile).with_for_update())
    return profile or repo.add(m.Profile, id=user_id, display_name="Teacher")


def profile_out(user_id: UUID, profile: m.Profile | None, mfa_required: bool) -> s.ProfileOut:
    if profile is None:
        return s.ProfileOut(
            id=user_id,
            display_name="Teacher",
            mfa_required=mfa_required,
            avatar=s.AvatarOut(
                style="initials", color=None, pattern=None, has_photo=False, photo_updated_at=None
            ),
        )
    return s.ProfileOut(
        id=user_id,
        display_name=profile.display_name,
        mfa_required=mfa_required,
        full_name=profile.full_name,
        school_name=profile.school_name,
        avatar=s.AvatarOut(
            style=profile.avatar_style or "initials",
            color=profile.avatar_color,
            pattern=profile.avatar_pattern,
            # The picture itself is loaded only by GET /v1/me/avatar.
            has_photo=profile.avatar_updated_at is not None,
            photo_updated_at=as_utc(profile.avatar_updated_at),
        ),
        updated_at=as_utc(profile.updated_at),
    )


def clean_avatar(data: bytes, mime: str) -> bytes:
    """Square 256 px JPEG with metadata stripped, from a JPEG/PNG/WebP upload."""
    allowed = {"image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WEBP"}
    if mime not in allowed:
        fail(415, "unsupported_image", "Use a JPEG, PNG or WebP picture")
    if not data or len(data) > MAX_AVATAR_BYTES:
        fail(413, "image_too_large", "Profile pictures must be under 512 KB")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(data)) as probe:
                if probe.format != allowed[mime] or getattr(probe, "n_frames", 1) != 1:
                    fail(415, "unsupported_image", "Picture type must match its MIME type; no animations")
                if probe.width * probe.height > 25_000_000:
                    fail(413, "image_too_large", "Picture has too many pixels")
                probe.verify()
            with Image.open(io.BytesIO(data)) as decoded:
                decoded.load()
                picture = ImageOps.fit(
                    ImageOps.exif_transpose(decoded).convert("RGB"), (AVATAR_PX, AVATAR_PX)
                )
                output = io.BytesIO()
                picture.save(output, format="JPEG", quality=85)
                return output.getvalue()
    except (
        UnidentifiedImageError,
        OSError,
        ValueError,
        Image.DecompressionBombError,
        Image.DecompressionBombWarning,
    ):
        fail(422, "invalid_image", "Picture could not be safely decoded")
