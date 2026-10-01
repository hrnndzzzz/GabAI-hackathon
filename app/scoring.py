"""scoring-v1: pure Decimal scoring, shared with Dart through docs/scoring.md and fixtures."""

import re
from decimal import Decimal

from app.errors import fail

ZERO = Decimal("0.00")


def normalize(value: str, kind: str) -> str | None:
    # Intentionally ASCII-only. Dart implementations need no Unicode normalization library.
    value = value.strip(" \t\r\n")
    if kind in ("multiple_choice", "true_false") and not value.isascii():
        return None
    value = value.upper()
    if kind == "multiple_choice":
        return value if re.fullmatch(r"[A-Z]", value) else None
    if kind == "true_false":
        return {"TRUE": "TRUE", "T": "TRUE", "FALSE": "FALSE", "F": "FALSE"}.get(value)
    return value


def calculate(key_id, version, verified, questions, answers, adjustments=()):
    from app.schemas import ItemScore, ScoreOut

    answer_map = {a.number: a for a in answers}
    adjustment_map = {a.number: a for a in adjustments}
    numbers = {q.number for q in questions}
    if len(answer_map) != len(answers) or len(adjustment_map) != len(adjustments):
        fail(422, "duplicate_question", "Answers and current adjustments must have unique question numbers")
    if (answer_map.keys() | adjustment_map.keys()) - numbers:
        fail(422, "unknown_question", "Answers or adjustments reference an unknown question")
    items, unresolved = [], []
    for q in sorted(questions, key=lambda q: q.number):
        answer = answer_map.get(q.number)
        resolved = answer is not None and answer.state in ("confirmed", "confirmed_blank")
        automatic = None
        adjustment = adjustment_map.get(q.number)
        adjusted = adjustment.score.quantize(Decimal("0.01")) if adjustment else None
        if adjusted is not None and adjusted > q.points:
            fail(422, "invalid_adjustment", "Adjusted score exceeds item points")
        if resolved and q.kind != "essay":
            if q.correct_answer is None:
                resolved = False
            elif answer.state == "confirmed_blank":
                automatic = ZERO
            else:
                actual = normalize(answer.value, q.kind)
                if actual is None or (q.kind == "multiple_choice" and actual not in q.choices):
                    fail(422, "invalid_answer", f"Question {q.number} needs a valid confirmed choice")
                accepted = {normalize(v, q.kind) for v in [q.correct_answer, *q.alternatives]}
                automatic = q.points if actual in accepted else ZERO
        elif resolved and q.kind == "essay":
            # Essays never receive an automatic score; a reasoned teacher score is required.
            resolved = adjusted is not None
        if not resolved:
            unresolved.append(q.number)
        final = (adjusted if adjusted is not None else automatic) if resolved else None
        items.append(
            ItemScore(
                number=q.number,
                resolved=resolved,
                automatic_score=automatic,
                adjusted_score=adjusted,
                final_score=final,
                possible_score=q.points,
            )
        )
    return ScoreOut(
        answer_key_id=key_id,
        answer_key_version=version,
        key_verified=verified,
        items=items,
        automatic_score=sum((i.automatic_score or ZERO for i in items), ZERO),
        final_score=sum((i.final_score or ZERO for i in items), ZERO),
        possible_score=sum((i.possible_score for i in items), ZERO),
        unresolved_numbers=unresolved,
        approvable=verified and not unresolved,
    )


def validate_client(score, client):
    if client is None:
        return
    expected_items = sorted(score.items, key=lambda i: i.number)
    actual_items = sorted(client.items, key=lambda i: i.number)
    if (
        score.automatic_score != client.automatic_score
        or score.final_score != client.final_score
        or score.possible_score != client.possible_score
        or expected_items != actual_items
    ):
        fail(409, "score_mismatch", "Client scores do not match scoring-v1 for this answer-key version")
