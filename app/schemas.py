from datetime import date, datetime
from decimal import Decimal
from typing import Annotated, Generic, Literal, TypeVar
from uuid import UUID, uuid4

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    StringConstraints,
    field_validator,
    model_validator,
)

Money = Annotated[Decimal, Field(ge=0, le=100000, max_digits=8, decimal_places=2)]
PositivePoints = Annotated[Decimal, Field(gt=0, le=10000, max_digits=7, decimal_places=2)]
Short = Annotated[str, Field(min_length=1, max_length=120)]
QuestionKind = Literal["multiple_choice", "true_false", "essay"]
AnswerState = Literal[
    "recognized", "blank_candidate", "ambiguous", "unreadable", "confirmed", "confirmed_blank"
]
MaterialKind = Literal["lesson_plan", "quiz", "rubric", "examples", "activity", "rewrite", "follow_up"]


class Schema(BaseModel):
    model_config = ConfigDict(extra="forbid", from_attributes=True, str_strip_whitespace=True)


class Identified(Schema):
    id: UUID = Field(default_factory=uuid4)


class Record(Schema):
    id: UUID
    owner_id: UUID
    created_at: datetime
    updated_at: datetime


T = TypeVar("T")


class Page(Schema, Generic[T]):
    items: list[T]
    limit: int
    offset: int
    has_more: bool


class ErrorDetail(Schema):
    code: str
    message: str
    request_id: str


class ErrorResponse(Schema):
    error: ErrorDetail


class ProfileOut(Schema):
    id: UUID
    display_name: str
    mfa_required: bool


class ProfileEdit(Schema):
    display_name: Short


class NameEdit(Schema):
    name: Short


class QuestionIn(Schema):
    number: int = Field(ge=1, le=500)
    kind: QuestionKind = "multiple_choice"
    points: PositivePoints = Decimal("1.00")
    correct_answer: Annotated[str, StringConstraints(strip_whitespace=False, max_length=200)] | None = None
    alternatives: list[
        Annotated[str, StringConstraints(strip_whitespace=False, min_length=1, max_length=200)]
    ] = Field(default_factory=list, max_length=26)
    choices: list[Annotated[str, Field(pattern=r"^[A-Z]$")]] = Field(default_factory=list, max_length=26)
    competency_ids: list[UUID] = Field(default_factory=list, max_length=20)
    rubric: Annotated[str, Field(max_length=10000)] | None = None

    @model_validator(mode="after")
    def validate_options(self):
        from app.scoring import normalize

        if len(set(self.competency_ids)) != len(self.competency_ids):
            raise ValueError("Duplicate competency IDs")
        if self.kind == "multiple_choice":
            if len(set(self.choices)) != len(self.choices) or len(self.choices) < 2:
                raise ValueError("Multiple choice requires at least two unique A-Z choice labels")
        elif self.choices:
            raise ValueError("Choices apply only to multiple choice")
        if self.kind == "essay" and (self.correct_answer is not None or self.alternatives):
            raise ValueError("Essays use a rubric and teacher-entered score, not an objective key")
        if self.kind != "essay":
            for value in (
                [self.correct_answer] if self.correct_answer is not None else []
            ) + self.alternatives:
                normalized = normalize(value, self.kind)
                if normalized is None or (self.kind == "multiple_choice" and normalized not in self.choices):
                    raise ValueError("Key answers must normalize to a valid choice or True/False value")
        return self


class KeyCreate(Identified):
    questions: list[QuestionIn] = Field(min_length=1, max_length=500)

    @field_validator("questions")
    @classmethod
    def unique_numbers(cls, questions):
        if len({q.number for q in questions}) != len(questions):
            raise ValueError("Question numbers must be unique")
        if sum(q.points for q in questions) > 100000:
            raise ValueError("Total points cannot exceed 100000")
        return sorted(questions, key=lambda q: q.number)


class QuestionOut(QuestionIn):
    id: UUID


class KeyOut(Record):
    assessment_id: UUID
    version: int
    verified: bool
    verified_by: UUID | None
    verified_at: datetime | None
    questions: list[QuestionOut]


class AssessmentCreate(Identified):
    title: Annotated[str, Field(min_length=1, max_length=200)]
    description: Annotated[str, Field(max_length=5000)] | None = None
    template_id: Annotated[str, Field(min_length=1, max_length=100)]
    subject_id: UUID | None = None
    term_id: UUID | None = None
    assessment_date: date
    category: Annotated[str, Field(min_length=1, max_length=80)] | None = None
    answer_key: KeyCreate


class AssessmentEdit(Schema):
    title: Annotated[str, Field(min_length=1, max_length=200)]
    description: Annotated[str, Field(max_length=5000)] | None = None


class AssessmentOut(Record):
    title: str
    description: str | None
    template_id: str
    subject_id: UUID | None
    term_id: UUID | None
    assessment_date: date
    category: str | None
    archived: bool
    answer_keys: list[KeyOut]


class Confirmation(Schema):
    confirmed: Literal[True]


class RevisionAction(Confirmation):
    expected_revision: int = Field(ge=1)


class ExtractionItem(Schema):
    number: int = Field(ge=1, le=500)
    value: Annotated[str, Field(max_length=10000)] | None
    state: Literal["recognized", "blank_candidate", "ambiguous", "unreadable"]
    review_flags: list[Annotated[str, Field(max_length=300)]] = Field(max_length=20)
    notes: Annotated[str, Field(max_length=2000)]

    @model_validator(mode="after")
    def valid_recognition(self):
        if self.state == "recognized" and not self.value:
            raise ValueError("Recognized answers need text")
        if self.state == "blank_candidate" and self.value:
            raise ValueError("Blank candidates must not contain an answer")
        return self


class ExtractionDraft(Schema):
    items: list[ExtractionItem] = Field(max_length=500)
    text: Annotated[str, Field(max_length=30000)]
    notes: list[Annotated[str, Field(max_length=1000)]] = Field(max_length=30)

    @field_validator("items")
    @classmethod
    def unique_numbers(cls, items):
        if len({i.number for i in items}) != len(items):
            raise ValueError("Duplicate extracted question numbers")
        return items


class Provenance(Schema):
    provider: Literal["google_gemini", "teacher"]
    model: str | None
    generated_at: datetime
    prompt_version: str
    ai_generated: bool


class OCROut(ExtractionDraft):
    purpose: Literal["reference", "student", "notes"]
    status: Literal["draft"] = "draft"
    requires_teacher_review: Literal[True] = True
    provenance: Provenance


class AnswerIn(Schema):
    number: int = Field(ge=1, le=500)
    state: AnswerState
    value: Annotated[str, StringConstraints(strip_whitespace=False, max_length=10000)] | None = None
    extracted: ExtractionItem | None = None

    @model_validator(mode="after")
    def state_matches_value(self):
        if self.state in ("confirmed", "recognized") and not self.value:
            raise ValueError("Confirmed/recognized answers require nonempty text")
        if self.state in ("confirmed_blank", "blank_candidate") and self.value:
            raise ValueError("Blank answers cannot have a value")
        if self.extracted and self.extracted.number != self.number:
            raise ValueError("Extracted and confirmed question numbers must match")
        return self


class AdjustmentIn(Schema):
    number: int = Field(ge=1, le=500)
    score: Money
    reason: Annotated[str, Field(min_length=3, max_length=2000)]


class ItemScore(Schema):
    number: int
    resolved: bool
    automatic_score: Decimal | None
    adjusted_score: Decimal | None
    final_score: Decimal | None
    possible_score: Decimal


class ScoreOut(Schema):
    answer_key_id: UUID
    answer_key_version: int
    key_verified: bool
    items: list[ItemScore]
    automatic_score: Decimal
    final_score: Decimal
    possible_score: Decimal
    unresolved_numbers: list[int]
    approvable: bool


class ClientScore(Schema):
    automatic_score: Money
    final_score: Money
    possible_score: Money
    items: list[ItemScore] = Field(min_length=1, max_length=500)


class ScoreRequest(Schema):
    answer_key_id: UUID
    answers: list[AnswerIn] = Field(max_length=500)
    adjustments: list[AdjustmentIn] = Field(default_factory=list, max_length=500)
    client_score: ClientScore | None = None


class SubmissionCreate(Identified):
    assessment_id: UUID
    answer_key_id: UUID
    student_label: Short
    student_id: UUID | None = None
    enrollment_id: UUID | None = None
    source: Literal["on_device", "gemini", "manual"]
    answers: list[AnswerIn] = Field(max_length=500)
    client_score: ClientScore | None = None


class SubmissionEdit(Schema):
    expected_revision: int = Field(ge=1)
    answers: list[AnswerIn] = Field(max_length=500)


class AdjustmentRequest(Schema):
    expected_revision: int = Field(ge=1)
    adjustment: AdjustmentIn


class Association(Schema):
    expected_revision: int = Field(ge=1)
    student_id: UUID
    enrollment_id: UUID


class AdjustmentOut(AdjustmentIn):
    id: UUID
    actor_id: UUID
    created_at: datetime
    sequence: int


class SubmissionOut(Record):
    assessment_id: UUID
    answer_key_id: UUID
    student_label: str
    student_id: UUID | None
    enrollment_id: UUID | None
    source: str
    status: Literal["draft", "approved"]
    revision: int
    answers: list[AnswerIn]
    score: ScoreOut
    adjustments: list[AdjustmentOut]
    approved_by: UUID | None
    approved_at: datetime | None
    local_approved_at: datetime | None


class OfflineAssessment(Schema):
    assessment: AssessmentCreate
    key_teacher_verified: Literal[True]


class OfflineSubmission(Schema):
    submission: SubmissionCreate
    adjustments: list[AdjustmentIn] = Field(default_factory=list, max_length=500)
    teacher_approved: Literal[True]
    local_approved_at: datetime
    client_score: ClientScore

    @field_validator("local_approved_at")
    @classmethod
    def timezone_required(cls, value):
        if value.tzinfo is None:
            raise ValueError("local_approved_at requires a timezone")
        return value


class UploadOut(Schema):
    server_id: UUID
    status: Literal["created", "already_uploaded"]
    created_at: datetime
    answer_key_id: UUID
    answer_key_version: int


class Finding(Schema):
    concept: Short
    evidence: Annotated[str, Field(min_length=1, max_length=1500)]


class GenerateMaterial(Schema):
    kind: MaterialKind
    topic: Annotated[str, Field(min_length=1, max_length=500)]
    student_level: Short
    objectives: list[Annotated[str, Field(min_length=1, max_length=500)]] = Field(min_length=1, max_length=20)
    preferences: Annotated[str, Field(max_length=3000)] = ""
    source_text: Annotated[str, Field(max_length=30000)] | None = None
    findings: list[Finding] = Field(default_factory=list, max_length=30)

    @model_validator(mode="after")
    def required_context(self):
        if self.kind == "rewrite" and not self.source_text:
            raise ValueError("Rewriting requires source_text")
        if self.kind == "follow_up" and not self.findings:
            raise ValueError("Follow-up lessons require teacher-selected findings")
        return self


class ContentSection(Schema):
    heading: Annotated[str, Field(min_length=1, max_length=200)]
    body: Annotated[str, Field(min_length=1, max_length=12000)]


class QuizQuestion(Schema):
    number: int = Field(ge=1, le=100)
    prompt: Annotated[str, Field(min_length=1, max_length=2000)]
    options: list[Annotated[str, Field(min_length=1, max_length=1000)]] = Field(min_length=2, max_length=26)
    answer: Annotated[str, Field(pattern=r"^[A-Z]$")]
    explanation: Annotated[str, Field(max_length=2000)]

    @model_validator(mode="after")
    def valid_answer(self):
        if ord(self.answer) - ord("A") >= len(self.options):
            raise ValueError("Answer must refer to an option")
        return self


class RubricCriterion(Schema):
    criterion: Short
    max_points: int = Field(ge=1, le=1000)
    descriptors: list[Annotated[str, Field(min_length=1, max_length=1500)]] = Field(
        min_length=1, max_length=10
    )


class MaterialContent(Schema):
    title: Annotated[str, Field(min_length=1, max_length=200)]
    sections: list[ContentSection] = Field(max_length=30)
    quiz_questions: list[QuizQuestion] = Field(max_length=100)
    rubric_criteria: list[RubricCriterion] = Field(max_length=30)
    rewritten_text: Annotated[str, Field(max_length=30000)] | None

    def validate_kind(self, kind):
        if kind == "quiz" and not self.quiz_questions:
            raise ValueError("Quiz draft must include questions and an answer key")
        if len({q.number for q in self.quiz_questions}) != len(self.quiz_questions):
            raise ValueError("Quiz numbers must be unique")
        if kind == "rubric" and not self.rubric_criteria:
            raise ValueError("Rubric draft must include criteria")
        if kind == "rewrite" and not self.rewritten_text:
            raise ValueError("Rewrite draft must include rewritten_text")
        if kind in ("lesson_plan", "examples", "activity", "follow_up") and not self.sections:
            raise ValueError("This material requires content sections")
        return self


class MaterialEdit(Schema):
    expected_revision: int = Field(ge=1)
    content: MaterialContent


class MaterialOut(Record):
    kind: MaterialKind
    content: MaterialContent
    original_content: MaterialContent
    provenance: Provenance
    revision: int
    status: Literal["draft", "reviewed"]
    reviewed_by: UUID | None
    reviewed_at: datetime | None


class NamedCreate(Identified):
    name: Short


class NamedOut(Record):
    name: str


class YearCreate(NamedCreate):
    starts_on: date
    ends_on: date

    @model_validator(mode="after")
    def date_order(self):
        if self.ends_on < self.starts_on:
            raise ValueError("ends_on must follow starts_on")
        return self


class YearOut(Record, YearCreate):
    pass


class TermCreate(YearCreate):
    academic_year_id: UUID


class TermOut(Record, TermCreate):
    pass


class SectionCreate(NamedCreate):
    grade_level_id: UUID
    academic_year_id: UUID


class SectionOut(Record, SectionCreate):
    pass


class StudentCreate(Identified):
    display_name: Short
    local_identifier: Short | None = None
    student_number: Short | None = None
    email: Annotated[EmailStr, Field(max_length=254)] | None = None


class StudentOut(Record, StudentCreate):
    pass


class StudentEdit(Schema):
    display_name: Short
    local_identifier: Short | None = None
    student_number: Short | None = None
    email: Annotated[EmailStr, Field(max_length=254)] | None = None


class EnrollmentCreate(Identified):
    student_id: UUID
    section_id: UUID
    starts_on: date
    ends_on: date | None = None


class EnrollmentOut(Record, EnrollmentCreate):
    pass


class EnrollmentClose(Schema):
    ends_on: date


class CompetencyCreate(NamedCreate):
    subject_id: UUID


class CompetencyOut(Record, CompetencyCreate):
    pass


class ExpectedCreate(Identified):
    assessment_id: UUID
    enrollment_id: UUID


class ExpectedOut(Record, ExpectedCreate):
    pass


class Thresholds(Schema):
    needs_support_below: Decimal = Field(default=Decimal("60"), ge=0, le=100, decimal_places=2)
    stronger_at_least: Decimal = Field(default=Decimal("80"), ge=0, le=100, decimal_places=2)
    min_questions: int = Field(default=3, ge=1, le=500)
    min_assessments: int = Field(default=2, ge=1, le=100)

    @model_validator(mode="after")
    def ordered(self):
        if self.stronger_at_least < self.needs_support_below:
            raise ValueError("Stronger threshold cannot be below support threshold")
        return self


class PerformanceQuery(Thresholds):
    subject_id: UUID
    term_id: UUID


class PerformanceEvidence(Schema):
    assessment_id: UUID
    submission_id: UUID
    answer_key_id: UUID
    question_number: int
    earned: Decimal
    possible: Decimal


class LearningArea(Schema):
    competency_id: UUID
    name: str
    earned: Decimal
    possible: Decimal
    percentage: Decimal
    evaluated_questions: int
    assessment_count: int
    flag: Literal["insufficient_evidence", "needs_support", "stronger", "developing"]
    evidence: list[PerformanceEvidence]


class PerformanceAssessment(Schema):
    assessment_id: UUID
    title: str
    assessment_date: date
    submission_id: UUID
    answer_key_id: UUID
    answer_key_version: int
    automatic_score: Decimal
    final_score: Decimal
    possible_score: Decimal
    percentage: Decimal
    enrollment_id: UUID | None
    section: str | None
    grade_level: str | None


class ExpectedStatus(Schema):
    assessment_id: UUID
    title: str
    status: Literal["missing", "pending_review", "approved"]


class EnrollmentSummary(Schema):
    enrollment_id: UUID
    section: str
    grade_level: str
    starts_on: date
    ends_on: date | None


class PerformanceOut(Schema):
    student_id: UUID
    subject_id: UUID
    term_id: UUID
    calculated_at: datetime
    thresholds: Thresholds
    enrollments: list[EnrollmentSummary]
    assessments: list[PerformanceAssessment]
    learning_areas: list[LearningArea]
    expected_assessments: list[ExpectedStatus]
    untagged_evaluated_questions: int
    notices: list[str]
    suggested_next_steps: list[str]
    trend_percentage_points: Decimal | None
    official_term_grade: None = None


class ConsultationContent(Schema):
    summary: Annotated[str, Field(min_length=1, max_length=12000)]
    practice_suggestions: list[Annotated[str, Field(min_length=1, max_length=2000)]] = Field(max_length=20)
    limitations: list[Annotated[str, Field(min_length=1, max_length=2000)]] = Field(max_length=20)


class ConsultationCreate(Schema):
    student_id: UUID
    query: PerformanceQuery
    use_ai: bool = False
    teacher_notes: Annotated[str, Field(max_length=10000)] = ""


class ConsultationEdit(Schema):
    expected_revision: int = Field(ge=1)
    content: ConsultationContent
    teacher_notes: Annotated[str, Field(max_length=10000)] = ""


class ConsultationOut(Record):
    student_id: UUID
    subject_id: UUID
    term_id: UUID
    snapshot: PerformanceOut
    content: ConsultationContent
    original_content: ConsultationContent
    provenance: Provenance
    teacher_notes: str
    revision: int
    status: Literal["draft", "approved"]
    approved_by: UUID | None
    approved_at: datetime | None
