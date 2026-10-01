# Shared scoring contract: scoring-v1

This specification is authoritative for Python and the frontend team's Dart implementation. `fixtures/scoring-v1.json` contains fictional, hand-calculated cases. Python runs these cases in pytest. The Flutter team must independently run them in Dart and test recognition on actual target devices.

## Numbers and answer keys

- Use exact decimal arithmetic, at most two fractional digits. JSON points/scores are decimal **strings**, never IEEE-754 numbers. Dart can parse these into integer hundredths. Sum integers; render two decimal places. Python uses `Decimal`.
- Each key has a stable UUID and an increasing assessment-local version. Questions have unique positive numbers, not necessarily contiguous. Maximum 500 questions; each item 0.01–10000.00 points; total at most 100000.00.
- MCQ choices are distinct uppercase single ASCII letters A–Z (at least two). A question has one correct answer and optional accepted alternatives, all of which must normalize to one of those choice labels.
- True/False has no choices list. Only `TRUE`, `T`, `FALSE`, `F` normalize, case-insensitively.
- Missing correct answers are allowed in a draft key. Verification requires every objective answer and an essay rubric. Blank reference papers provide no answers: never solve their questions to make a key.
- Key contents are immutable. To change answers, points, rubric or tags, create a new key version, then verify it. Results remain linked to the original key UUID/version.

## Normalization

1. Remove only ASCII space, tab, CR and LF from both ends.
2. Reject non-ASCII characters for MCQ and True/False. Do not perform Unicode folding.
3. Uppercase ASCII letters.
4. MCQ: require exactly one letter A–Z and membership in the question's choices. No punctuation removal, parenthesis removal, inferred labels, comma lists or answer-text lookup.
5. True/False: `T`/`TRUE` → `TRUE`, `F`/`FALSE` → `FALSE`. Do not accept `1`, `0`, `yes` or `no`.

For example, `" a\t"` → `A`; `(A)`, `A.`, `A B`, full-width `Ａ` and nonbreaking-space-wrapped `A` are invalid. Reject an invalid teacher-confirmed objective answer with 422; ask the teacher to correct it.

## Answer states

| State | Final-score treatment |
|---|---|
| `recognized` | Unresolved until the teacher confirms |
| `blank_candidate` | Unresolved; never automatically becomes a zero |
| `ambiguous` | Unresolved |
| `unreadable` | Unresolved |
| omitted question | Unresolved |
| `confirmed` | Compare valid normalized answer with key/alternatives |
| `confirmed_blank` | Objective automatic score is zero; resolved |

An unresolved item's `automatic_score` and `final_score` are null. Draft totals sum only available scores; they are **partial**, not grades. `possible_score` always includes every question. `unresolved_numbers` and `approvable` must control the UI.

Matching objective answers earn all item points, others earn zero. No negative marking, partial matching, fuzzy matching or AI arithmetic. An unverified key may produce a labeled preview but `approvable` remains false. A key without a correct objective answer leaves that item unresolved.

## Teacher adjustments and essay scores

An adjustment gives a new absolute score for one item, bounded by 0 and its available points. A nonblank reason of at least three characters is required. The original automatic score remains unchanged. The latest adjustment per item is effective; every adjustment remains in history with teacher actor and sequence.

Adjustments never resolve ambiguous/unreadable/missing answers. First correct the answer state. For essays, require a teacher-confirmed answer (or confirmed blank), reviewed rubric and explicit teacher-entered score using the adjustment endpoint. An essay has null automatic score, even when resolved. Teacher scores contribute to `final_score` only.

Approval recalculates all item scores and totals, requires a verified key and no unresolved questions, records the verified teacher actor/server timestamp, and locks the grade. Corrections after approval use a new submission, preserving the old attempt.

## Client validation

When `client_score` is supplied, send automatic, final and possible totals plus all item results. The server compares exact decimals, null values, resolved state, adjusted score and item numbers. Item ordering does not matter. Duplicates, omitted items, fabricated totals or mismatched key content are rejected. Offline submission upload requires this validation payload.

## Consultation arithmetic

Reports select the student, subject and term, then select the latest approved attempt for each assessment (`approved_at`, UUID tie-break). Pending attempts never replace approved evidence. Percentages = earned × 100 / possible, rounded half-up to 2 decimals. Latest-minus-earliest percentage is a descriptive trend, not an official term grade or evidence of equivalent test difficulty.

Each tagged item contributes its final teacher-adjusted score and possible points to each tag. Multi-tag area totals overlap and must not be summed together. A learning area is `insufficient_evidence` if either configured minimum is unmet; otherwise `< needs_support_below` is `needs_support`, `>= stronger_at_least` is `stronger`, and the rest is `developing`. Defaults: 60%, 80%, 3 questions, 2 assessments. Every finding includes item-level evidence.

Missing expected work is reported only for explicit expected-assessment records. It contributes no numerical zero. A draft/unresolved submission is `pending_review`. An approved zero is valid evaluated evidence. Untagged items remain in assessment scores but not learning-area analysis. No official term grading formula is assumed or implemented.
