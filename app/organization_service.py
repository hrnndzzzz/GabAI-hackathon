from app import models as m
from app.errors import fail


def validate_organization(repo, model, data):
    if model == m.Term:
        year = repo.get(m.AcademicYear, data.academic_year_id)
        if not year.starts_on <= data.starts_on <= data.ends_on <= year.ends_on:
            fail(422, "date_outside_year", "Term dates must lie inside the academic year")
    elif model == m.Section:
        repo.get(m.GradeLevel, data.grade_level_id)
        repo.get(m.AcademicYear, data.academic_year_id)
    elif model == m.Competency:
        repo.get(m.Subject, data.subject_id)
    elif model == m.Enrollment:
        # Serialize changes for this student, including overlap checks.
        repo.get(m.Student, data.student_id, lock=True)
        section = repo.get(m.Section, data.section_id)
        year = repo.get(m.AcademicYear, section.academic_year_id)
        end = data.ends_on or year.ends_on
        if not year.starts_on <= data.starts_on <= end <= year.ends_on:
            fail(
                422,
                "invalid_enrollment_dates",
                "Enrollment dates must lie inside the section's academic year",
            )
        for existing in repo.rows(m.Enrollment, m.Enrollment.student_id == data.student_id):
            old_section = repo.get(m.Section, existing.section_id)
            old_year = repo.get(m.AcademicYear, old_section.academic_year_id)
            if data.starts_on <= (existing.ends_on or old_year.ends_on) and existing.starts_on <= end:
                fail(
                    409,
                    "overlapping_enrollment",
                    "Close the previous enrollment before creating a new non-overlapping one",
                )
    elif model == m.ExpectedAssessment:
        from app.submission_service import validate_association

        assessment = repo.get(m.Assessment, data.assessment_id)
        enrollment = repo.get(m.Enrollment, data.enrollment_id)
        validate_association(repo, assessment, enrollment.student_id, enrollment.id)


def close_enrollment(repo, enrollment, ends_on):
    section = repo.get(m.Section, enrollment.section_id)
    year = repo.get(m.AcademicYear, section.academic_year_id)
    if enrollment.ends_on is not None:
        if enrollment.ends_on == ends_on:
            return enrollment
        fail(409, "enrollment_closed", "Closed enrollment dates are immutable")
    if not enrollment.starts_on <= ends_on <= year.ends_on:
        fail(422, "invalid_enrollment_dates", "Closing date must be within enrollment and academic year")
    assessment_ids = {
        x.assessment_id for x in repo.rows(m.Submission, m.Submission.enrollment_id == enrollment.id)
    }
    assessment_ids.update(
        x.assessment_id
        for x in repo.rows(m.ExpectedAssessment, m.ExpectedAssessment.enrollment_id == enrollment.id)
    )
    if any(repo.get(m.Assessment, identifier).assessment_date > ends_on for identifier in assessment_ids):
        fail(
            409,
            "enrollment_in_use",
            "Closing date would invalidate a historical submission or expected assessment",
        )
    enrollment.ends_on = ends_on
    repo.db.flush()
    return enrollment
