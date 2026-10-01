from collections import defaultdict
from uuid import uuid4

from sqlalchemy import or_, text

from app import models as m
from app.errors import fail
from app.roster_parser import clean_label, fingerprint, grade_label, parse_roster
from app.roster_schemas import RosterAssignment, RosterImportOut, RosterIssue, RosterPreview


def category_key(name):
    return clean_label(name).casefold()


def level_key(name):
    try:
        return category_key(grade_label(name))
    except ValueError:
        return category_key(name)


def roster_preview(repo, data, filename, options, *, lock=False):
    year = repo.get(m.AcademicYear, options.academic_year_id)
    if not year.starts_on <= options.starts_on <= year.ends_on:
        fail(422, "date_outside_year", "Import enrollment date must lie inside the academic year")
    rows, issues, total = parse_roster(data, filename, options)
    levels, sections = defaultdict(list), defaultdict(list)
    for level in repo.rows(m.GradeLevel):
        levels[level_key(level.name)].append(level)
    for section in repo.rows(m.Section, m.Section.academic_year_id == year.id):
        sections[(section.grade_level_id, category_key(section.name))].append(section)
    numbers = [row.student_number for row in rows]
    query = (
        repo.query(m.Student)
        .where(
            or_(
                m.Student.student_number.in_(numbers),
                (m.Student.student_number.is_(None) & m.Student.local_identifier.in_(numbers)),
            )
        )
        .order_by(m.Student.id)
    )
    if lock:
        query = query.with_for_update()
    students, legacy = {}, set()
    for student in repo.db.scalars(query):
        if student.student_number:
            students[student.student_number] = student
        else:
            legacy.add(student.local_identifier)
    enrollments = defaultdict(list)
    enrollment_query = (
        repo.query(m.Enrollment)
        .add_columns(m.Section.grade_level_id, m.Section.academic_year_id, m.AcademicYear.ends_on)
        .join(m.Section, m.Section.id == m.Enrollment.section_id)
        .join(m.AcademicYear, m.AcademicYear.id == m.Section.academic_year_id)
        .where(
            m.Enrollment.student_id.in_([s.id for s in students.values()]),
            m.Section.owner_id == repo.owner,
            m.AcademicYear.owner_id == repo.owner,
        )
    )
    for enrollment, grade_id, year_id, year_end in repo.db.execute(enrollment_query):
        enrollments[enrollment.student_id].append((enrollment, grade_id, year_id, year_end))
    assignments = []
    for row in rows:

        def issue(field, code, message):
            issues.append(RosterIssue(row=row.row, field=field, code=code, message=message))

        item = RosterAssignment(**row.model_dump())
        matched_levels = levels[level_key(row.grade_level)]
        if len(matched_levels) > 1:
            issue(
                "grade_level",
                "ambiguous_category",
                "Multiple existing grade levels match; resolve category names before importing",
            )
        elif matched_levels:
            level = matched_levels[0]
            item.grade_level_id, item.grade_level = level.id, level.name
            matched_sections = sections[(level.id, category_key(row.section))]
            if len(matched_sections) > 1:
                issue(
                    "section",
                    "ambiguous_category",
                    "Multiple existing sections match this grade and academic year",
                )
            elif matched_sections:
                item.section_id, item.section = matched_sections[0].id, matched_sections[0].name
        student = students.get(row.student_number)
        if row.student_number in legacy:
            issue(
                "student_number",
                "legacy_identifier",
                "Existing local identifier matches; set that student's student_number explicitly before importing",
            )
        if student:
            item.student_id, item.student_action = student.id, "reuse"
            if (
                category_key(student.display_name) != category_key(row.display_name)
                or student.email != row.email
            ):
                issue(
                    "student_number",
                    "student_details_conflict",
                    "Student number exists with different name or email; review and edit the student explicitly",
                )
            for old, _grade, _year, end in enrollments[student.id]:
                old_end = old.ends_on or end
                if options.starts_on <= old_end and old.starts_on <= year.ends_on:
                    if (
                        old.section_id == item.section_id
                        and old.starts_on <= options.starts_on
                        and old_end == year.ends_on
                    ):
                        item.enrollment_id, item.enrollment_action = old.id, "reuse"
                    else:
                        issue(
                            "section",
                            "enrollment_conflict",
                            "Student has an overlapping enrollment; review dates and close it before a transfer",
                        )
        assignments.append(item)
    return RosterPreview(
        valid=not issues,
        fingerprint=fingerprint(data, filename, options),
        options=options,
        total_rows=total,
        assignments=assignments,
        issues=issues,
    )


def _lock(repo, key):
    if repo.db.bind.dialect.name == "postgresql":
        repo.db.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": key})


def import_roster(repo, data, filename, options, import_id, expected_fingerprint):
    digest = fingerprint(data, filename, options)
    if digest != expected_fingerprint:
        fail(409, "roster_changed", "File or import options changed; preview again before importing")
    _lock(repo, str(import_id))  # Same lock namespace as offline upload receipts.
    receipt = repo.db.scalar(repo.query(m.UploadReceipt).where(m.UploadReceipt.id == import_id))
    if receipt:
        if receipt.kind != "roster" or receipt.payload_hash != digest:
            fail(409, "upload_conflict", "This import UUID was already used for different content")
        return RosterImportOut(**(receipt.response | {"status": "already_imported"}))
    # Serializes category creation and overlapping imports for one teacher, including different UUIDs.
    _lock(repo, f"roster-owner:{repo.owner}")
    preview = roster_preview(repo, data, filename, options, lock=True)
    if not preview.valid:
        fail(
            409,
            "roster_conflict",
            "Import has row errors or conflicts; preview again for row-level details. Nothing was saved",
        )
    new_levels, new_sections, new_students, new_enrollments = {}, {}, [], []
    for item in preview.assignments:
        if item.grade_level_id is None:
            key = level_key(item.grade_level)
            if key not in new_levels:
                new_levels[key] = m.GradeLevel(id=uuid4(), owner_id=repo.owner, name=item.grade_level)
            item.grade_level_id = new_levels[key].id
            item.grade_level = new_levels[key].name
        if item.section_id is None:
            key = (item.grade_level_id, category_key(item.section))
            if key not in new_sections:
                new_sections[key] = m.Section(
                    id=uuid4(),
                    owner_id=repo.owner,
                    name=item.section,
                    grade_level_id=item.grade_level_id,
                    academic_year_id=options.academic_year_id,
                )
            item.section_id = new_sections[key].id
            item.section = new_sections[key].name
        if item.student_id is None:
            item.student_id = uuid4()
            new_students.append(
                m.Student(
                    id=item.student_id,
                    owner_id=repo.owner,
                    display_name=item.display_name,
                    student_number=item.student_number,
                    email=item.email,
                )
            )
        if item.enrollment_id is None:
            item.enrollment_id = uuid4()
            new_enrollments.append(
                m.Enrollment(
                    id=item.enrollment_id,
                    owner_id=repo.owner,
                    student_id=item.student_id,
                    section_id=item.section_id,
                    starts_on=options.starts_on,
                )
            )
    # Bulk flush each FK dependency layer. The request transaction includes the receipt.
    for records in (list(new_levels.values()), list(new_sections.values()), new_students, new_enrollments):
        repo.db.add_all(records)
        repo.db.flush()
    result = RosterImportOut(
        import_id=import_id,
        status="imported",
        created_at=m.now(),
        students_created=len(new_students),
        students_reused=len(preview.assignments) - len(new_students),
        enrollments_created=len(new_enrollments),
        assignments=preview.assignments,
    )
    repo.add(
        m.UploadReceipt,
        id=import_id,
        kind="roster",
        payload_hash=digest,
        response=result.model_dump(mode="json"),
    )
    return result
