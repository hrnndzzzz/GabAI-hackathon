from sqlalchemy import func

from app import models as m
from app import schemas as s
from app.errors import fail
from app.mobile_service import expect_class
from app.models import now
from app.schemas import as_utc


def key_questions(repo, key):
    return sorted(repo.rows(m.Question, m.Question.answer_key_id == key.id), key=lambda q: q.number)


def key_out(repo, key):
    questions = []
    for q in key_questions(repo, key):
        tags = repo.rows(m.QuestionCompetency, m.QuestionCompetency.question_id == q.id)
        questions.append(
            s.QuestionOut(
                id=q.id,
                number=q.number,
                kind=q.kind,
                points=q.points,
                correct_answer=q.correct_answer,
                alternatives=q.alternatives,
                choices=q.choices,
                rubric=q.rubric,
                competency_ids=[t.competency_id for t in tags],
            )
        )
    return s.KeyOut(**{c.name: getattr(key, c.name) for c in key.__table__.columns}, questions=questions)


def assessment_out(repo, assessment):
    keys = sorted(repo.rows(m.AnswerKey, m.AnswerKey.assessment_id == assessment.id), key=lambda k: k.version)
    values = {c.name: getattr(assessment, c.name) for c in assessment.__table__.columns}
    values["due_at"] = as_utc(assessment.due_at)
    return s.AssessmentOut(**values, answer_keys=[key_out(repo, key) for key in keys])


def create_key(repo, assessment, payload):
    if assessment.archived:
        fail(409, "assessment_archived", "Archived assessments cannot receive new keys")
    # Caller holds the assessment row lock, serializing version allocation.
    version = (
        repo.db.scalar(
            repo.query(m.AnswerKey)
            .with_only_columns(func.max(m.AnswerKey.version))
            .where(m.AnswerKey.assessment_id == assessment.id)
        )
        or 0
    ) + 1
    key = repo.add(m.AnswerKey, id=payload.id, assessment_id=assessment.id, version=version)
    for data in payload.questions:
        q = repo.add(m.Question, answer_key_id=key.id, **data.model_dump(exclude={"competency_ids"}))
        for identifier in data.competency_ids:
            competency = repo.get(m.Competency, identifier)
            if assessment.subject_id != competency.subject_id:
                fail(422, "subject_mismatch", "Learning competencies must belong to the assessment subject")
            repo.add(
                m.QuestionCompetency,
                question_id=q.id,
                competency_id=competency.id,
                competency_name=competency.name,
            )
    return key


def create_assessment(repo, payload):
    if payload.subject_id:
        repo.get(m.Subject, payload.subject_id)
    if payload.term_id:
        term = repo.get(m.Term, payload.term_id)
        if not term.starts_on <= payload.assessment_date <= term.ends_on:
            fail(422, "date_outside_term", "Assessment date must be inside its term")
    if (
        payload.class_id
        and repo.db.scalar(repo.query(m.TeachingClass).where(m.TeachingClass.id == payload.class_id)) is None
    ):
        fail(422, "unknown_class", "Upload the class before the assessments given to it")
    assessment = repo.add(m.Assessment, **payload.model_dump(exclude={"answer_key"}))
    key = create_key(repo, assessment, payload.answer_key)
    if assessment.class_id:
        expect_class(repo, assessment)
    return assessment, key


def verify_key(repo, key):
    questions = key_questions(repo, key)
    if not questions or any(q.kind != "essay" and q.correct_answer is None for q in questions):
        fail(409, "incomplete_key", "Provide teacher-confirmed correct answers for every objective question")
    if any(q.kind == "essay" and not q.rubric for q in questions):
        fail(409, "missing_rubric", "Essay questions require a teacher-reviewed rubric")
    if not key.verified:
        key.verified, key.verified_by, key.verified_at = True, repo.owner, now()
        repo.db.flush()
    return key
