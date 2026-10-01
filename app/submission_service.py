from app import models as m
from app import schemas as s
from app.assessment_service import key_questions
from app.errors import fail
from app.mobile_service import is_late, link_by_name
from app.models import now
from app.schemas import as_utc
from app.scoring import calculate, validate_client


def validate_association(repo, assessment, student_id, enrollment_id):
    if bool(student_id) != bool(enrollment_id):
        fail(422, "enrollment_required", "Supply both student_id and enrollment_id, or neither")
    if student_id:
        repo.get(m.Student, student_id)
        enrollment = repo.get(m.Enrollment, enrollment_id)
        section = repo.get(m.Section, enrollment.section_id)
        if enrollment.student_id != student_id:
            fail(422, "enrollment_mismatch", "Enrollment belongs to a different student")
        if assessment.assessment_date < enrollment.starts_on or (
            enrollment.ends_on and assessment.assessment_date > enrollment.ends_on
        ):
            fail(422, "enrollment_date_mismatch", "Enrollment must cover the assessment date")
        if assessment.term_id:
            term = repo.get(m.Term, assessment.term_id)
            if section.academic_year_id != term.academic_year_id:
                fail(
                    422, "academic_year_mismatch", "Enrollment and assessment must use the same academic year"
                )


def answers_for(repo, sub):
    return [
        s.AnswerIn.model_validate(a)
        for a in sorted(
            repo.rows(m.SubmissionAnswer, m.SubmissionAnswer.submission_id == sub.id), key=lambda a: a.number
        )
    ]


def adjustments_for(repo, sub):
    history = sorted(repo.rows(m.Adjustment, m.Adjustment.submission_id == sub.id), key=lambda a: a.sequence)
    current = {a.number: s.AdjustmentIn.model_validate(a) for a in history}
    return history, list(current.values())


def score_for(repo, sub):
    key = repo.get(m.AnswerKey, sub.answer_key_id)
    _, adjustments = adjustments_for(repo, sub)
    return calculate(
        key.id, key.version, key.verified, key_questions(repo, key), answers_for(repo, sub), adjustments
    )


def save_score(repo, sub):
    score = score_for(repo, sub)
    key = repo.get(m.AnswerKey, sub.answer_key_id)
    questions = {q.number: q for q in key_questions(repo, key)}
    existing = {i.number: i for i in repo.rows(m.ItemResult, m.ItemResult.submission_id == sub.id)}
    for item in score.items:
        if item.number in existing:
            for name, value in item.model_dump().items():
                setattr(existing[item.number], name, value)
        else:
            repo.add(
                m.ItemResult, submission_id=sub.id, question_id=questions[item.number].id, **item.model_dump()
            )
    sub.automatic_score, sub.final_score, sub.possible_score = (
        score.automatic_score,
        score.final_score,
        score.possible_score,
    )
    repo.db.flush()
    return score


def replace_answers(repo, sub, answers):
    numbers = [a.number for a in answers]
    if len(numbers) != len(set(numbers)):
        fail(422, "duplicate_question", "Answers must have unique question numbers")
    existing = {
        a.number: a for a in repo.rows(m.SubmissionAnswer, m.SubmissionAnswer.submission_id == sub.id)
    }
    for answer in answers:
        data = answer.model_dump(mode="json")
        if answer.number in existing:
            for name, value in data.items():
                setattr(existing[answer.number], name, value)
        else:
            repo.add(m.SubmissionAnswer, submission_id=sub.id, **data)
    for number, answer in existing.items():
        if number not in numbers:
            repo.db.delete(answer)
    repo.db.flush()


def create_submission(repo, payload):
    assessment = repo.get(m.Assessment, payload.assessment_id)
    key = repo.get(m.AnswerKey, payload.answer_key_id)
    if assessment.archived:
        fail(409, "assessment_archived", "Cannot add submissions to an archived assessment")
    if key.assessment_id != assessment.id:
        fail(422, "key_mismatch", "Answer key does not belong to the assessment")
    validate_association(repo, assessment, payload.student_id, payload.enrollment_id)
    data = payload.model_dump(exclude={"answers", "client_score"})
    if not payload.student_id:
        # A result for a class assessment is matched to the class list by the student's name.
        student_id, enrollment_id = link_by_name(repo, assessment, payload.student_label)
        if student_id:
            data.update(student_id=student_id, enrollment_id=enrollment_id)
    sub = repo.add(m.Submission, **data)
    replace_answers(repo, sub, payload.answers)
    score = save_score(repo, sub)
    validate_client(score, payload.client_score)
    return sub


def add_adjustment(repo, sub, payload):
    history, current = adjustments_for(repo, sub)
    key = repo.get(m.AnswerKey, sub.answer_key_id)
    merged = {a.number: a for a in current}
    merged[payload.number] = payload
    calculate(
        key.id,
        key.version,
        key.verified,
        key_questions(repo, key),
        answers_for(repo, sub),
        list(merged.values()),
    )
    repo.add(
        m.Adjustment,
        submission_id=sub.id,
        actor_id=repo.owner,
        sequence=len(history) + 1,
        **payload.model_dump(),
    )
    return save_score(repo, sub)


def approve(repo, sub):
    score = save_score(repo, sub)
    if not score.approvable:
        fail(
            409,
            "review_required",
            "Approval requires a verified key, confirmed answers and scores for all items",
        )
    if sub.status != "approved":
        sub.status, sub.approved_by, sub.approved_at = "approved", repo.owner, now()
        sub.revision += 1
        repo.db.flush()
    return sub


def submission_out(repo, sub):
    history, _ = adjustments_for(repo, sub)
    values = {
        c.name: getattr(sub, c.name)
        for c in sub.__table__.columns
        if c.name not in ("automatic_score", "final_score", "possible_score")
    }
    values["submitted_at"] = as_utc(sub.submitted_at)
    return s.SubmissionOut(
        **values,
        answers=answers_for(repo, sub),
        score=score_for(repo, sub),
        adjustments=[s.AdjustmentOut.model_validate(a) for a in history],
        late=is_late(sub, repo.get(m.Assessment, sub.assessment_id)),
    )
