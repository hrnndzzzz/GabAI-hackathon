// scoring-v1, ported from app/scoring.py (see docs/scoring.md). Points travel as
// decimal strings and all arithmetic happens in integer hundredths, so results
// match the server's Decimal math exactly. Run against fixtures/scoring-v1.json.

export type QuestionKind = 'multiple_choice' | 'true_false' | 'essay'
export type ExtractionState = 'recognized' | 'blank_candidate' | 'ambiguous' | 'unreadable'
export type AnswerState = ExtractionState | 'confirmed' | 'confirmed_blank'

export interface KeyQuestion {
  number: number
  kind: QuestionKind
  points: string
  choices?: string[]
  correct_answer?: string | null
  alternatives?: string[]
  rubric?: string | null
}

export interface ExtractionItem {
  number: number
  value: string | null
  state: ExtractionState
  review_flags: string[]
  notes: string
}

export interface Answer {
  number: number
  state: AnswerState
  value?: string | null
  extracted?: ExtractionItem | null
}

export interface Adjustment {
  number: number
  score: string
  reason: string
}

export interface ItemScore {
  number: number
  resolved: boolean
  automatic_score: string | null
  adjusted_score: string | null
  final_score: string | null
  possible_score: string
}

export interface Score {
  items: ItemScore[]
  automatic_score: string
  final_score: string
  possible_score: string
  unresolved_numbers: number[]
  approvable: boolean
}

export class ScoringError extends Error {
  code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

export function toHundredths(value: string): number {
  const match = /^(\d{1,8})(?:\.(\d{1,2}))?$/.exec(value)
  if (!match) throw new ScoringError('invalid_decimal', `Expected a decimal with at most two places: ${value}`)
  return Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'))
}

export function formatHundredths(value: number): string {
  return `${Math.floor(value / 100)}.${String(value % 100).padStart(2, '0')}`
}

const TRUE_FALSE: Record<string, string> = { TRUE: 'TRUE', T: 'TRUE', FALSE: 'FALSE', F: 'FALSE' }

/** ASCII-only on purpose, exactly like the server: no Unicode folding or punctuation removal. */
export function normalize(value: string, kind: QuestionKind): string | null {
  let v = value.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, '')
  if (kind !== 'essay' && /[^\x00-\x7f]/.test(v)) return null
  v = v.toUpperCase()
  if (kind === 'multiple_choice') return /^[A-Z]$/.test(v) ? v : null
  if (kind === 'true_false') return TRUE_FALSE[v] ?? null
  return v
}

export function isResolvedState(state: AnswerState | undefined): boolean {
  return state === 'confirmed' || state === 'confirmed_blank'
}

export function calculate(
  questions: KeyQuestion[],
  verified: boolean,
  answers: Answer[],
  adjustments: Adjustment[] = [],
): Score {
  const answerMap = new Map(answers.map((a) => [a.number, a]))
  const adjustmentMap = new Map(adjustments.map((a) => [a.number, a]))
  if (answerMap.size !== answers.length || adjustmentMap.size !== adjustments.length) {
    throw new ScoringError('duplicate_question', 'Answers and current adjustments must have unique question numbers')
  }
  const numbers = new Set(questions.map((q) => q.number))
  for (const n of [...answerMap.keys(), ...adjustmentMap.keys()]) {
    if (!numbers.has(n)) throw new ScoringError('unknown_question', 'Answers or adjustments reference an unknown question')
  }

  const items: ItemScore[] = []
  const unresolved: number[] = []
  let automaticTotal = 0
  let finalTotal = 0
  let possibleTotal = 0

  for (const q of [...questions].sort((a, b) => a.number - b.number)) {
    const points = toHundredths(q.points)
    const answer = answerMap.get(q.number)
    let resolved = answer !== undefined && isResolvedState(answer.state)
    let automatic: number | null = null
    const adjustment = adjustmentMap.get(q.number)
    const adjusted = adjustment ? toHundredths(adjustment.score) : null
    if (adjusted !== null && adjusted > points) {
      throw new ScoringError('invalid_adjustment', 'Adjusted score exceeds item points')
    }
    if (resolved && q.kind !== 'essay') {
      if (q.correct_answer == null) {
        resolved = false
      } else if (answer!.state === 'confirmed_blank') {
        automatic = 0
      } else {
        const actual = normalize(answer!.value ?? '', q.kind)
        if (actual === null || (q.kind === 'multiple_choice' && !(q.choices ?? []).includes(actual))) {
          throw new ScoringError('invalid_answer', `Question ${q.number} needs a valid confirmed choice`)
        }
        const accepted = new Set([q.correct_answer, ...(q.alternatives ?? [])].map((v) => normalize(v, q.kind)))
        automatic = accepted.has(actual) ? points : 0
      }
    } else if (resolved && q.kind === 'essay') {
      // Essays never receive an automatic score; a reasoned teacher score resolves them.
      resolved = adjusted !== null
    }
    if (!resolved) unresolved.push(q.number)
    const final = resolved ? (adjusted ?? automatic) : null

    automaticTotal += automatic ?? 0
    finalTotal += final ?? 0
    possibleTotal += points
    items.push({
      number: q.number,
      resolved,
      automatic_score: automatic === null ? null : formatHundredths(automatic),
      adjusted_score: adjusted === null ? null : formatHundredths(adjusted),
      final_score: final === null ? null : formatHundredths(final),
      possible_score: formatHundredths(points),
    })
  }

  return {
    items,
    automatic_score: formatHundredths(automaticTotal),
    final_score: formatHundredths(finalTotal),
    possible_score: formatHundredths(possibleTotal),
    unresolved_numbers: unresolved,
    approvable: verified && unresolved.length === 0,
  }
}

/** Percent of possible, as a float for display only (never sent to the server). */
export function scorePercent(score: Pick<Score, 'final_score' | 'possible_score'>): number {
  const possible = toHundredths(score.possible_score)
  return possible ? (toHundredths(score.final_score) / possible) * 100 : 0
}

export function displayScore(value: string): string {
  return value.endsWith('.00') ? value.slice(0, -3) : value
}
