import hashlib
import json
from datetime import date
from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from sqlalchemy import select, text
from sqlalchemy.orm import Session

from app import models as m
from app import schemas as s
from app.ai import consume_ai_limit, sanitize_image
from app.assessment_service import (
    assessment_out,
    create_assessment,
    create_key,
    key_out,
    key_questions,
    verify_key,
)
from app.auth import Principal, get_principal
from app.db import get_db
from app.errors import fail
from app.organization_service import close_enrollment, validate_organization
from app.performance import performance
from app.repository import Repo, check_revision, draft_only
from app.scoring import calculate, validate_client
from app.submission_service import (
    add_adjustment,
    approve,
    create_submission,
    replace_answers,
    save_score,
    submission_out,
    validate_association,
)

router = APIRouter(prefix="/v1")
Auth = Annotated[Principal, Depends(get_principal)]
DB = Annotated[Session, Depends(get_db, scope="function")]
Limit = Annotated[int, Query(ge=1, le=100)]
Offset = Annotated[int, Query(ge=0, le=100000)]


@router.get("/me", response_model=s.ProfileOut, tags=["Authentication"])
def me(request: Request, user: Auth, db: DB):
    repo = Repo(db, user.id)
    profile = db.scalar(repo.query(m.Profile))
    return s.ProfileOut(
        id=user.id,
        display_name=profile.display_name if profile else "Teacher",
        mfa_required=request.app.state.settings.require_mfa,
    )


@router.put("/me", response_model=s.ProfileOut, tags=["Authentication"])
def edit_me(payload: s.ProfileEdit, request: Request, user: Auth, db: DB):
    repo = Repo(db, user.id)
    profile = db.scalar(repo.query(m.Profile).with_for_update())
    if profile:
        profile.display_name = payload.display_name
    else:
        repo.add(m.Profile, id=user.id, display_name=payload.display_name)
    return s.ProfileOut(
        id=user.id, display_name=payload.display_name, mfa_required=request.app.state.settings.require_mfa
    )


@router.post("/assessments", response_model=s.AssessmentOut, status_code=201, tags=["Assessments"])
def assessment_create(payload: s.AssessmentCreate, user: Auth, db: DB):
    repo = Repo(db, user.id)
    assessment, _ = create_assessment(repo, payload)
    return assessment_out(repo, assessment)


@router.get("/assessments", response_model=s.Page[s.AssessmentOut], tags=["Assessments"])
def assessment_list(
    user: Auth,
    db: DB,
    limit: Limit = 20,
    offset: Offset = 0,
    subject_id: UUID | None = None,
    term_id: UUID | None = None,
    archived: bool = False,
):
    repo = Repo(db, user.id)
    filters = [m.Assessment.archived == archived]
    if subject_id:
        repo.get(m.Subject, subject_id)
        filters.append(m.Assessment.subject_id == subject_id)
    if term_id:
        repo.get(m.Term, term_id)
        filters.append(m.Assessment.term_id == term_id)
    rows, more = repo.page(m.Assessment, limit, offset, *filters)
    return s.Page(items=[assessment_out(repo, a) for a in rows], limit=limit, offset=offset, has_more=more)


@router.get("/assessments/{assessment_id}", response_model=s.AssessmentOut, tags=["Assessments"])
def assessment_get(assessment_id: UUID, user: Auth, db: DB):
    repo = Repo(db, user.id)
    return assessment_out(repo, repo.get(m.Assessment, assessment_id))


@router.patch("/assessments/{assessment_id}", response_model=s.AssessmentOut, tags=["Assessments"])
def assessment_edit(assessment_id: UUID, payload: s.AssessmentEdit, user: Auth, db: DB):
    repo = Repo(db, user.id)
    assessment = repo.get(m.Assessment, assessment_id, lock=True)
    assessment.title, assessment.description = payload.title, payload.description
    db.flush()
    return assessment_out(repo, assessment)


@router.delete(
    "/assessments/{assessment_id}",
    response_model=s.AssessmentOut,
    tags=["Assessments"],
    description="Archives an assessment, retaining keys and historical results. Repeat calls are idempotent.",
)
def assessment_archive(assessment_id: UUID, user: Auth, db: DB):
    repo = Repo(db, user.id)
    assessment = repo.get(m.Assessment, assessment_id, lock=True)
    assessment.archived = True
    db.flush()
    return assessment_out(repo, assessment)


@router.post(
    "/assessments/{assessment_id}/answer-keys",
    response_model=s.KeyOut,
    status_code=201,
    tags=["Answer keys"],
    description="Creates a new immutable draft version, including updated question competency tags. Never changes earlier results.",
)
def key_create(assessment_id: UUID, payload: s.KeyCreate, user: Auth, db: DB):
    repo = Repo(db, user.id)
    assessment = repo.get(m.Assessment, assessment_id, lock=True)
    return key_out(repo, create_key(repo, assessment, payload))


@router.get("/answer-keys/{key_id}", response_model=s.KeyOut, tags=["Answer keys"])
def key_get(key_id: UUID, user: Auth, db: DB):
    repo = Repo(db, user.id)
    return key_out(repo, repo.get(m.AnswerKey, key_id))


@router.post("/answer-keys/{key_id}/verify", response_model=s.KeyOut, tags=["Answer keys"])
def key_verify(key_id: UUID, payload: s.Confirmation, user: Auth, db: DB):
    repo = Repo(db, user.id)
    return key_out(repo, verify_key(repo, repo.get(m.AnswerKey, key_id, lock=True)))


@router.post("/scoring/preview", response_model=s.ScoreOut, tags=["Scoring"])
def preview(payload: s.ScoreRequest, user: Auth, db: DB):
    repo = Repo(db, user.id)
    key = repo.get(m.AnswerKey, payload.answer_key_id)
    score = calculate(
        key.id, key.version, key.verified, key_questions(repo, key), payload.answers, payload.adjustments
    )
    validate_client(score, payload.client_score)
    return score


@router.post("/submissions", response_model=s.SubmissionOut, status_code=201, tags=["Submissions"])
def submission_create(payload: s.SubmissionCreate, user: Auth, db: DB):
    repo = Repo(db, user.id)
    return submission_out(repo, create_submission(repo, payload))


@router.get("/submissions", response_model=s.Page[s.SubmissionOut], tags=["Submissions"])
def submission_list(
    user: Auth,
    db: DB,
    limit: Limit = 20,
    offset: Offset = 0,
    assessment_id: UUID | None = None,
    student_id: UUID | None = None,
    status: Literal["draft", "approved"] | None = None,
):
    repo = Repo(db, user.id)
    filters = []
    if assessment_id:
        repo.get(m.Assessment, assessment_id)
        filters.append(m.Submission.assessment_id == assessment_id)
    if student_id:
        repo.get(m.Student, student_id)
        filters.append(m.Submission.student_id == student_id)
    if status:
        filters.append(m.Submission.status == status)
    rows, more = repo.page(m.Submission, limit, offset, *filters)
    return s.Page(
        items=[submission_out(repo, sub) for sub in rows], limit=limit, offset=offset, has_more=more
    )


@router.get("/submissions/{submission_id}", response_model=s.SubmissionOut, tags=["Submissions"])
def submission_get(submission_id: UUID, user: Auth, db: DB):
    repo = Repo(db, user.id)
    return submission_out(repo, repo.get(m.Submission, submission_id))


@router.put("/submissions/{submission_id}/answers", response_model=s.SubmissionOut, tags=["Submissions"])
def submission_answers(submission_id: UUID, payload: s.SubmissionEdit, user: Auth, db: DB):
    repo = Repo(db, user.id)
    sub = repo.get(m.Submission, submission_id, lock=True)
    draft_only(sub)
    check_revision(sub, payload.expected_revision)
    replace_answers(repo, sub, payload.answers)
    save_score(repo, sub)
    sub.revision += 1
    db.flush()
    return submission_out(repo, sub)


@router.post("/submissions/{submission_id}/adjustments", response_model=s.SubmissionOut, tags=["Submissions"])
def submission_adjust(submission_id: UUID, payload: s.AdjustmentRequest, user: Auth, db: DB):
    repo = Repo(db, user.id)
    sub = repo.get(m.Submission, submission_id, lock=True)
    draft_only(sub)
    check_revision(sub, payload.expected_revision)
    add_adjustment(repo, sub, payload.adjustment)
    sub.revision += 1
    db.flush()
    return submission_out(repo, sub)


@router.post("/submissions/{submission_id}/approve", response_model=s.SubmissionOut, tags=["Submissions"])
def submission_approve(submission_id: UUID, payload: s.RevisionAction, user: Auth, db: DB):
    repo = Repo(db, user.id)
    sub = repo.get(m.Submission, submission_id, lock=True)
    check_revision(sub, payload.expected_revision)
    return submission_out(repo, approve(repo, sub))


@router.put("/submissions/{submission_id}/student", response_model=s.SubmissionOut, tags=["Submissions"])
def submission_associate(submission_id: UUID, payload: s.Association, user: Auth, db: DB):
    repo = Repo(db, user.id)
    sub = repo.get(m.Submission, submission_id, lock=True)
    check_revision(sub, payload.expected_revision)
    if sub.student_id and (
        sub.student_id != payload.student_id or sub.enrollment_id != payload.enrollment_id
    ):
        fail(409, "already_associated", "Student association is immutable to preserve historical reports")
    assessment = repo.get(m.Assessment, sub.assessment_id)
    validate_association(repo, assessment, payload.student_id, payload.enrollment_id)
    if not sub.student_id:
        sub.student_id, sub.enrollment_id = payload.student_id, payload.enrollment_id
        sub.revision += 1
    db.flush()
    return submission_out(repo, sub)


def upload_hash(payload):
    def canonical(value):
        if isinstance(value, dict):
            return {key: canonical(item) for key, item in value.items()}
        if isinstance(value, list):
            return [canonical(item) for item in value]
        if isinstance(value, Decimal):
            return format(value.normalize(), "f")
        if isinstance(value, (UUID, date)):
            return str(value)
        return value

    return hashlib.sha256(
        json.dumps(canonical(payload.model_dump()), sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def upload_existing(repo, identifier, kind, payload):
    if repo.db.bind.dialect.name == "postgresql":
        repo.db.execute(
            text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": str(identifier)}
        )
    receipt = repo.db.scalar(repo.query(m.UploadReceipt).where(m.UploadReceipt.id == identifier))
    digest = upload_hash(payload)
    if receipt:
        if receipt.kind != kind or receipt.payload_hash != digest:
            fail(409, "upload_conflict", "This UUID was already uploaded with different content")
        return s.UploadOut(**(receipt.response | {"status": "already_uploaded"})), digest
    return None, digest


def save_receipt(repo, record, key, kind, digest):
    out = s.UploadOut(
        server_id=record.id,
        status="created",
        created_at=record.created_at,
        answer_key_id=key.id,
        answer_key_version=key.version,
    )
    repo.add(
        m.UploadReceipt, id=record.id, kind=kind, payload_hash=digest, response=out.model_dump(mode="json")
    )
    return out


@router.post(
    "/uploads/assessments",
    response_model=s.UploadOut,
    tags=["Offline upload"],
    description="Atomically creates and teacher-verifies a locally reviewed key. Identical retry returns already_uploaded; different data with the same UUID returns 409.",
)
def upload_assessment(payload: s.OfflineAssessment, user: Auth, db: DB):
    if (
        "id" not in payload.assessment.model_fields_set
        or "id" not in payload.assessment.answer_key.model_fields_set
    ):
        fail(422, "stable_ids_required", "Offline uploads require explicit assessment and answer-key UUIDs")
    repo = Repo(db, user.id)
    existing, digest = upload_existing(repo, payload.assessment.id, "assessment", payload)
    if existing:
        return existing
    assessment, key = create_assessment(repo, payload.assessment)
    verify_key(repo, key)
    return save_receipt(repo, assessment, key, "assessment", digest)


@router.post("/uploads/submissions", response_model=s.UploadOut, tags=["Offline upload"])
def upload_submission(payload: s.OfflineSubmission, user: Auth, db: DB):
    if "id" not in payload.submission.model_fields_set:
        fail(422, "stable_ids_required", "Offline uploads require an explicit submission UUID")
    repo = Repo(db, user.id)
    existing, digest = upload_existing(repo, payload.submission.id, "submission", payload)
    if existing:
        return existing
    # Compare client totals after adjustments have been applied, not against an intermediate score.
    nested_score = payload.submission.client_score
    sub = create_submission(repo, payload.submission.model_copy(update={"client_score": None}))
    numbers = [a.number for a in payload.adjustments]
    if len(numbers) != len(set(numbers)):
        fail(
            422, "duplicate_question", "Offline adjustments must contain one current adjustment per question"
        )
    for adjustment in payload.adjustments:
        add_adjustment(repo, sub, adjustment)
    score = save_score(repo, sub)
    validate_client(score, payload.client_score)
    validate_client(score, nested_score)
    sub.local_approved_at = payload.local_approved_at
    approve(repo, sub)
    key = repo.get(m.AnswerKey, sub.answer_key_id)
    return save_receipt(repo, sub, key, "submission", digest)


@router.post(
    "/ocr/{purpose}",
    response_model=s.OCROut,
    tags=["Online OCR"],
    description="Online-only Gemini extraction. Image is decoded and metadata stripped, then discarded after extraction. No key, submission or image is automatically saved.",
)
def ocr(
    purpose: Literal["reference", "student", "notes"],
    request: Request,
    user: Auth,
    file: UploadFile = File(...),
):
    settings = request.app.state.settings
    if not request.app.state.ocr_slots.acquire(blocking=False):
        file.file.close()
        fail(429, "ocr_busy", "This instance is processing other images; retry shortly")
    try:
        try:
            data = file.file.read(settings.max_image_bytes + 1)
            image = sanitize_image(data, file.content_type, settings)
        finally:
            file.file.close()
        consume_ai_limit(request.app, user)
        return request.app.state.ai.ocr(purpose, image)
    finally:
        request.app.state.ocr_slots.release()


@router.post(
    "/materials/generate", response_model=s.MaterialOut, status_code=201, tags=["Teaching materials"]
)
def material_generate(payload: s.GenerateMaterial, request: Request, user: Auth, db: DB):
    consume_ai_limit(request.app, user)
    content = request.app.state.ai.material(payload).model_dump(mode="json")
    provenance = request.app.state.ai.provenance().model_dump(mode="json")
    repo = Repo(db, user.id)
    return s.MaterialOut.model_validate(
        repo.add(
            m.Material, kind=payload.kind, content=content, original_content=content, provenance=provenance
        )
    )


@router.get("/materials", response_model=s.Page[s.MaterialOut], tags=["Teaching materials"])
def material_list(user: Auth, db: DB, limit: Limit = 20, offset: Offset = 0):
    rows, more = Repo(db, user.id).page(m.Material, limit, offset)
    return s.Page(
        items=[s.MaterialOut.model_validate(row) for row in rows], limit=limit, offset=offset, has_more=more
    )


@router.get("/materials/{material_id}", response_model=s.MaterialOut, tags=["Teaching materials"])
def material_get(material_id: UUID, user: Auth, db: DB):
    return s.MaterialOut.model_validate(Repo(db, user.id).get(m.Material, material_id))


@router.patch("/materials/{material_id}", response_model=s.MaterialOut, tags=["Teaching materials"])
def material_edit(material_id: UUID, payload: s.MaterialEdit, user: Auth, db: DB):
    record = Repo(db, user.id).get(m.Material, material_id, lock=True)
    check_revision(record, payload.expected_revision)
    try:
        payload.content.validate_kind(record.kind)
    except ValueError as exc:
        fail(422, "invalid_material", str(exc))
    record.content = payload.content.model_dump(mode="json")
    record.status, record.reviewed_by, record.reviewed_at = "draft", None, None
    record.revision += 1
    db.flush()
    return s.MaterialOut.model_validate(record)


@router.post("/materials/{material_id}/review", response_model=s.MaterialOut, tags=["Teaching materials"])
def material_review(material_id: UUID, payload: s.RevisionAction, user: Auth, db: DB):
    record = Repo(db, user.id).get(m.Material, material_id, lock=True)
    check_revision(record, payload.expected_revision)
    record.status, record.reviewed_by, record.reviewed_at = "reviewed", user.id, m.now()
    record.revision += 1
    db.flush()
    return s.MaterialOut.model_validate(record)


# Typed resource factory: each concrete route has its own named Pydantic input/output schema in OpenAPI.
def organization_routes(path, model, input_schema, output_schema, editable_name=True):
    def create(payload: input_schema, user: Auth, db: DB):
        repo = Repo(db, user.id)
        validate_organization(repo, model, payload)
        return output_schema.model_validate(repo.add(model, **payload.model_dump()))

    def listing(user: Auth, db: DB, limit: Limit = 20, offset: Offset = 0):
        rows, more = Repo(db, user.id).page(model, limit, offset)
        return s.Page(
            items=[output_schema.model_validate(row) for row in rows],
            limit=limit,
            offset=offset,
            has_more=more,
        )

    def get(identifier: UUID, user: Auth, db: DB):
        return output_schema.model_validate(Repo(db, user.id).get(model, identifier))

    def edit(identifier: UUID, payload: s.NameEdit, user: Auth, db: DB):
        record = Repo(db, user.id).get(model, identifier, lock=True)
        record.name = payload.name
        db.flush()
        return output_schema.model_validate(record)

    for endpoint, method, suffix, output in [
        (create, "POST", "", output_schema),
        (listing, "GET", "", s.Page[output_schema]),
        (get, "GET", "/{identifier}", output_schema),
    ]:
        router.add_api_route(
            path + suffix,
            endpoint,
            methods=[method],
            response_model=output,
            status_code=201 if method == "POST" else 200,
            tags=["Class organization"],
            name=f"{endpoint.__name__}_{model.__tablename__}",
        )
    if editable_name:
        router.add_api_route(
            path + "/{identifier}",
            edit,
            methods=["PATCH"],
            response_model=output_schema,
            tags=["Class organization"],
            name=f"rename_{model.__tablename__}",
            description="Rename only. Structural links and date ranges remain immutable to preserve history.",
        )


for resource in [
    ("/academic-years", m.AcademicYear, s.YearCreate, s.YearOut),
    ("/terms", m.Term, s.TermCreate, s.TermOut),
    ("/grade-levels", m.GradeLevel, s.NamedCreate, s.NamedOut),
    ("/sections", m.Section, s.SectionCreate, s.SectionOut),
    ("/subjects", m.Subject, s.NamedCreate, s.NamedOut),
    ("/competencies", m.Competency, s.CompetencyCreate, s.CompetencyOut),
    ("/enrollments", m.Enrollment, s.EnrollmentCreate, s.EnrollmentOut, False),
    ("/expected-assessments", m.ExpectedAssessment, s.ExpectedCreate, s.ExpectedOut, False),
]:
    organization_routes(*resource)


@router.post("/students", response_model=s.StudentOut, status_code=201, tags=["Students"])
def student_create(payload: s.StudentCreate, user: Auth, db: DB):
    return s.StudentOut.model_validate(Repo(db, user.id).add(m.Student, **payload.model_dump()))


@router.get("/students", response_model=s.Page[s.StudentOut], tags=["Students"])
def student_list(
    user: Auth,
    db: DB,
    limit: Limit = 20,
    offset: Offset = 0,
    section_id: UUID | None = None,
    grade_level_id: UUID | None = None,
    academic_year_id: UUID | None = None,
    as_of: date | None = None,
):
    repo = Repo(db, user.id)
    query = repo.query(m.Student)
    if section_id or grade_level_id or academic_year_id or as_of:
        for identifier, model in [
            (section_id, m.Section),
            (grade_level_id, m.GradeLevel),
            (academic_year_id, m.AcademicYear),
        ]:
            if identifier:
                repo.get(model, identifier)
        enrollment_query = (
            select(m.Enrollment.student_id)
            .join(m.Section, m.Section.id == m.Enrollment.section_id)
            .where(m.Enrollment.owner_id == user.id, m.Section.owner_id == user.id)
        )
        if section_id:
            enrollment_query = enrollment_query.where(m.Section.id == section_id)
        if grade_level_id:
            enrollment_query = enrollment_query.where(m.Section.grade_level_id == grade_level_id)
        if academic_year_id:
            enrollment_query = enrollment_query.where(m.Section.academic_year_id == academic_year_id)
        if as_of:
            enrollment_query = enrollment_query.join(
                m.AcademicYear, m.AcademicYear.id == m.Section.academic_year_id
            ).where(
                m.Enrollment.starts_on <= as_of,
                (m.Enrollment.ends_on.is_(None) | (m.Enrollment.ends_on >= as_of)),
                m.AcademicYear.starts_on <= as_of,
                m.AcademicYear.ends_on >= as_of,
            )
        query = query.where(m.Student.id.in_(enrollment_query))
    rows = list(
        db.scalars(query.order_by(m.Student.created_at, m.Student.id).offset(offset).limit(limit + 1))
    )
    return s.Page(
        items=[s.StudentOut.model_validate(row) for row in rows[:limit]],
        limit=limit,
        offset=offset,
        has_more=len(rows) > limit,
    )


@router.get("/students/{student_id}", response_model=s.StudentOut, tags=["Students"])
def student_get(student_id: UUID, user: Auth, db: DB):
    return s.StudentOut.model_validate(Repo(db, user.id).get(m.Student, student_id))


@router.patch("/students/{student_id}", response_model=s.StudentOut, tags=["Students"])
def student_edit(student_id: UUID, payload: s.StudentEdit, user: Auth, db: DB):
    record = Repo(db, user.id).get(m.Student, student_id, lock=True)
    record.display_name, record.local_identifier = payload.display_name, payload.local_identifier
    db.flush()
    return s.StudentOut.model_validate(record)


@router.post(
    "/enrollments/{enrollment_id}/close", response_model=s.EnrollmentOut, tags=["Class organization"]
)
def enrollment_close(enrollment_id: UUID, payload: s.EnrollmentClose, user: Auth, db: DB):
    repo = Repo(db, user.id)
    record = repo.get(m.Enrollment, enrollment_id, lock=True)
    repo.get(m.Student, record.student_id, lock=True)
    return s.EnrollmentOut.model_validate(close_enrollment(repo, record, payload.ends_on))


@router.get("/students/{student_id}/performance", response_model=s.PerformanceOut, tags=["Consultations"])
def student_performance(student_id: UUID, user: Auth, db: DB, query: Annotated[s.PerformanceQuery, Query()]):
    return performance(Repo(db, user.id), student_id, query)


@router.post("/consultations", response_model=s.ConsultationOut, status_code=201, tags=["Consultations"])
def consultation_create(payload: s.ConsultationCreate, request: Request, user: Auth, db: DB):
    repo = Repo(db, user.id)
    report = performance(repo, payload.student_id, payload.query)
    if payload.use_ai:
        consume_ai_limit(request.app, user)
        content = request.app.state.ai.consultation(report)
        provenance = request.app.state.ai.provenance()
    else:
        content = s.ConsultationContent(
            summary="Teacher consultation draft; review the attached numerical evidence.",
            practice_suggestions=report.suggested_next_steps,
            limitations=report.notices,
        )
        provenance = s.Provenance(
            provider="teacher",
            model=None,
            generated_at=m.now(),
            prompt_version="numerical-report-v1",
            ai_generated=False,
        )
    content = content.model_dump(mode="json")
    return s.ConsultationOut.model_validate(
        repo.add(
            m.Consultation,
            student_id=payload.student_id,
            subject_id=payload.query.subject_id,
            term_id=payload.query.term_id,
            snapshot=report.model_dump(mode="json"),
            content=content,
            original_content=content,
            provenance=provenance.model_dump(mode="json"),
            teacher_notes=payload.teacher_notes,
        )
    )


@router.get("/consultations", response_model=s.Page[s.ConsultationOut], tags=["Consultations"])
def consultation_list(
    user: Auth, db: DB, limit: Limit = 20, offset: Offset = 0, student_id: UUID | None = None
):
    repo = Repo(db, user.id)
    filters = []
    if student_id:
        repo.get(m.Student, student_id)
        filters.append(m.Consultation.student_id == student_id)
    rows, more = repo.page(m.Consultation, limit, offset, *filters)
    return s.Page(
        items=[s.ConsultationOut.model_validate(row) for row in rows],
        limit=limit,
        offset=offset,
        has_more=more,
    )


@router.get("/consultations/{consultation_id}", response_model=s.ConsultationOut, tags=["Consultations"])
def consultation_get(consultation_id: UUID, user: Auth, db: DB):
    return s.ConsultationOut.model_validate(Repo(db, user.id).get(m.Consultation, consultation_id))


@router.patch("/consultations/{consultation_id}", response_model=s.ConsultationOut, tags=["Consultations"])
def consultation_edit(consultation_id: UUID, payload: s.ConsultationEdit, user: Auth, db: DB):
    record = Repo(db, user.id).get(m.Consultation, consultation_id, lock=True)
    check_revision(record, payload.expected_revision)
    record.content, record.teacher_notes = payload.content.model_dump(mode="json"), payload.teacher_notes
    record.status, record.approved_by, record.approved_at = "draft", None, None
    record.revision += 1
    db.flush()
    return s.ConsultationOut.model_validate(record)


@router.post(
    "/consultations/{consultation_id}/approve", response_model=s.ConsultationOut, tags=["Consultations"]
)
def consultation_approve(consultation_id: UUID, payload: s.RevisionAction, user: Auth, db: DB):
    record = Repo(db, user.id).get(m.Consultation, consultation_id, lock=True)
    check_revision(record, payload.expected_revision)
    record.status, record.approved_by, record.approved_at = "approved", user.id, m.now()
    record.revision += 1
    db.flush()
    return s.ConsultationOut.model_validate(record)
