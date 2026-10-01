from decimal import ROUND_HALF_UP, Decimal

from app import models as m
from app import schemas as s
from app.models import now


def percentage(earned, possible):
    return (earned * 100 / possible).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def performance(repo, student_id, query):
    repo.get(m.Student, student_id)
    repo.get(m.Subject, query.subject_id)
    term = repo.get(m.Term, query.term_id)
    thresholds = s.Thresholds(**query.model_dump(exclude={"subject_id", "term_id"}))
    assessments = {
        a.id: a
        for a in repo.rows(
            m.Assessment, m.Assessment.subject_id == query.subject_id, m.Assessment.term_id == query.term_id
        )
    }
    enrollments = {e.id: e for e in repo.rows(m.Enrollment, m.Enrollment.student_id == student_id)}
    enrollment_summaries = {}
    for enrollment in enrollments.values():
        section = repo.get(m.Section, enrollment.section_id)
        if (
            section.academic_year_id != term.academic_year_id
            or enrollment.starts_on > term.ends_on
            or (enrollment.ends_on and enrollment.ends_on < term.starts_on)
        ):
            continue
        grade = repo.get(m.GradeLevel, section.grade_level_id)
        enrollment_summaries[enrollment.id] = s.EnrollmentSummary(
            enrollment_id=enrollment.id,
            section=section.name,
            grade_level=grade.name,
            starts_on=enrollment.starts_on,
            ends_on=enrollment.ends_on,
        )
    submissions = [
        sub
        for sub in repo.rows(m.Submission, m.Submission.student_id == student_id)
        if sub.assessment_id in assessments
    ]
    # Explicit retake rule: most recently approved attempt per assessment, deterministic UUID tie break.
    approved = {}
    for sub in sorted(
        (sub for sub in submissions if sub.status == "approved"),
        key=lambda sub: (sub.approved_at, str(sub.id)),
    ):
        approved[sub.assessment_id] = sub
    history, areas, untagged = [], {}, 0
    for assessment_id, sub in sorted(
        approved.items(), key=lambda pair: (assessments[pair[0]].assessment_date, str(pair[0]))
    ):
        assessment = assessments[assessment_id]
        key = repo.get(m.AnswerKey, sub.answer_key_id)
        enrollment = enrollment_summaries.get(sub.enrollment_id)
        history.append(
            s.PerformanceAssessment(
                assessment_id=assessment.id,
                title=assessment.title,
                assessment_date=assessment.assessment_date,
                submission_id=sub.id,
                answer_key_id=key.id,
                answer_key_version=key.version,
                automatic_score=sub.automatic_score,
                final_score=sub.final_score,
                possible_score=sub.possible_score,
                percentage=percentage(sub.final_score, sub.possible_score),
                enrollment_id=sub.enrollment_id,
                section=enrollment.section if enrollment else None,
                grade_level=enrollment.grade_level if enrollment else None,
            )
        )
        for item in repo.rows(m.ItemResult, m.ItemResult.submission_id == sub.id):
            if not item.resolved or item.final_score is None:
                continue  # Defense in depth; approval already prohibits this.
            tags = repo.rows(m.QuestionCompetency, m.QuestionCompetency.question_id == item.question_id)
            if not tags:
                untagged += 1
            for tag in tags:
                area = areas.setdefault(tag.competency_id, {"name": tag.competency_name, "evidence": []})
                area["evidence"].append(
                    s.PerformanceEvidence(
                        assessment_id=assessment.id,
                        submission_id=sub.id,
                        answer_key_id=key.id,
                        question_number=item.number,
                        earned=item.final_score,
                        possible=item.possible_score,
                    )
                )
    learning = []
    for identifier, area in sorted(areas.items(), key=lambda pair: str(pair[0])):
        evidence = area["evidence"]
        earned = sum((e.earned for e in evidence), Decimal("0.00"))
        possible = sum((e.possible for e in evidence), Decimal("0.00"))
        percent = percentage(earned, possible)
        count = len({e.assessment_id for e in evidence})
        if len(evidence) < thresholds.min_questions or count < thresholds.min_assessments:
            flag = "insufficient_evidence"
        elif percent < thresholds.needs_support_below:
            flag = "needs_support"
        elif percent >= thresholds.stronger_at_least:
            flag = "stronger"
        else:
            flag = "developing"
        learning.append(
            s.LearningArea(
                competency_id=identifier,
                name=area["name"],
                earned=earned,
                possible=possible,
                percentage=percent,
                evaluated_questions=len(evidence),
                assessment_count=count,
                flag=flag,
                evidence=evidence,
            )
        )
    expected, seen = [], set()
    for item in repo.rows(m.ExpectedAssessment):
        if (
            item.enrollment_id not in enrollments
            or item.assessment_id not in assessments
            or item.assessment_id in seen
        ):
            continue
        seen.add(item.assessment_id)
        state = (
            "approved"
            if item.assessment_id in approved
            else (
                "pending_review"
                if any(sub.assessment_id == item.assessment_id for sub in submissions)
                else "missing"
            )
        )
        expected.append(
            s.ExpectedStatus(
                assessment_id=item.assessment_id, title=assessments[item.assessment_id].title, status=state
            )
        )
    notices = [
        "Only approved results are included. Most recently approved attempt per assessment is used.",
        "No official term grade is calculated; no school grading policy has been configured.",
        "Questions tagged to several areas count once in each area; area totals must not be added together.",
    ]
    if not learning:
        notices.append("Topic-level analysis is unavailable: no tagged approved question results.")
    if untagged:
        notices.append(
            f"{untagged} evaluated questions lack learning-area tags and are excluded from topic analysis."
        )
    if not expected:
        notices.append("No expected assessments are explicitly tracked; missing work cannot be inferred.")
    suggestions = [
        f"Review {a.name} and offer targeted practice using the listed assessment evidence."
        for a in learning
        if a.flag == "needs_support"
    ]
    if any(a.flag == "insufficient_evidence" for a in learning):
        suggestions.append(
            "Collect more reviewed question evidence before drawing conclusions in flagged areas."
        )
    return s.PerformanceOut(
        student_id=student_id,
        subject_id=query.subject_id,
        term_id=query.term_id,
        calculated_at=now(),
        thresholds=thresholds,
        enrollments=list(enrollment_summaries.values()),
        assessments=history,
        learning_areas=learning,
        expected_assessments=expected,
        untagged_evaluated_questions=untagged,
        notices=notices,
        suggested_next_steps=suggestions,
        trend_percentage_points=(history[-1].percentage - history[0].percentage)
        if len(history) > 1
        else None,
    )
