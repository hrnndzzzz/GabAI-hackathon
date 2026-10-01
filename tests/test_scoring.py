import json
from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4

import pytest

from app import schemas as s
from app.errors import DomainError
from app.scoring import calculate, normalize

FIXTURE = json.loads((Path(__file__).parents[1] / "fixtures/scoring-v1.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("case", FIXTURE["cases"], ids=lambda case: case["name"])
def test_shared_dart_scoring_fixtures(case):
    questions = [s.QuestionIn.model_validate(q) for q in FIXTURE["questions"]]
    answers = [s.AnswerIn.model_validate(a) for a in case["answers"]]
    adjustments = [s.AdjustmentIn.model_validate(a) for a in case.get("adjustments", [])]
    score = calculate(UUID(FIXTURE["answer_key_id"]), 1, True, questions, answers, adjustments)
    for field in ("automatic_score", "final_score", "possible_score"):
        assert getattr(score, field) == Decimal(case[field])
    assert score.unresolved_numbers == case["unresolved_numbers"]
    assert score.approvable == (not case["unresolved_numbers"])
    assert [i.automatic_score for i in score.items] == [
        Decimal(v) if v is not None else None for v in case["item_automatic"]
    ]
    assert [i.final_score for i in score.items] == [
        Decimal(v) if v is not None else None for v in case["item_final"]
    ]


@pytest.mark.parametrize("case", FIXTURE["normalization"])
def test_normalization_contract(case):
    assert normalize(case["input"], case["kind"]) == case["expected"]


def test_essay_requires_teacher_score_and_reason():
    q = s.QuestionIn(number=1, kind="essay", points="5.00", rubric="Clarity: 5 points")
    answer = s.AnswerIn(number=1, state="confirmed", value="Fictional response")
    score = calculate(uuid4(), 1, True, [q], [answer])
    assert score.approvable is False
    adjusted = s.AdjustmentIn(number=1, score="3.50", reason="Clear claim, needs supporting example")
    score = calculate(uuid4(), 1, True, [q], [answer], [adjusted])
    assert score.automatic_score == Decimal("0.00")
    assert score.items[0].automatic_score is None
    assert score.final_score == Decimal("3.50")
    assert score.approvable


def test_adjustment_cannot_resolve_unreadable_and_duplicate_rejected():
    q = s.QuestionIn.model_validate(FIXTURE["questions"][0])
    answer = s.AnswerIn(number=1, state="unreadable")
    adjustment = s.AdjustmentIn(number=1, score="2.00", reason="Not enough to resolve recognition")
    assert calculate(uuid4(), 1, True, [q], [answer], [adjustment]).approvable is False
    with pytest.raises(DomainError):
        calculate(uuid4(), 1, True, [q], [answer, answer])
    with pytest.raises(DomainError):
        calculate(uuid4(), 1, True, [q], [s.AnswerIn(number=1, state="confirmed", value="A/B")])
