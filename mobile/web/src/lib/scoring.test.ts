import { describe, expect, it } from 'vitest'
import fixtures from '../../../../fixtures/scoring-v1.json'
import { ScoringError, calculate, normalize, type Answer, type KeyQuestion } from './scoring'

// The same hand-calculated cases the Python suite runs (fixtures/scoring-v1.json).
describe('scoring-v1 fixtures', () => {
  const questions = fixtures.questions as KeyQuestion[]

  for (const c of fixtures.cases) {
    it(c.name, () => {
      const score = calculate(questions, true, c.answers as Answer[], 'adjustments' in c ? c.adjustments : [])
      expect(score.automatic_score).toBe(c.automatic_score)
      expect(score.final_score).toBe(c.final_score)
      expect(score.possible_score).toBe(c.possible_score)
      expect(score.unresolved_numbers).toEqual(c.unresolved_numbers)
      expect(score.items.map((i) => i.automatic_score)).toEqual(c.item_automatic)
      expect(score.items.map((i) => i.final_score)).toEqual(c.item_final)
      expect(score.approvable).toBe(c.unresolved_numbers.length === 0)
    })
  }

  for (const n of fixtures.normalization) {
    it(`normalizes ${JSON.stringify(n.input)} as ${n.kind}`, () => {
      expect(normalize(n.input, n.kind as KeyQuestion['kind'])).toBe(n.expected)
    })
  }
})

describe('scoring-v1 guards', () => {
  const questions = fixtures.questions as KeyQuestion[]

  it('is never approvable with an unverified key', () => {
    const answers: Answer[] = [
      { number: 1, state: 'confirmed', value: 'A' },
      { number: 2, state: 'confirmed', value: 'T' },
      { number: 3, state: 'confirmed', value: 'C' },
    ]
    expect(calculate(questions, false, answers).approvable).toBe(false)
  })

  it('rejects an invalid teacher-confirmed choice', () => {
    expect(() => calculate(questions, true, [{ number: 1, state: 'confirmed', value: '(A)' }])).toThrow(ScoringError)
  })

  it('rejects an adjustment above the item points', () => {
    expect(() => calculate(questions, true, [], [{ number: 3, score: '0.30', reason: 'too high' }])).toThrow(
      /exceeds/,
    )
  })

  it('needs a teacher score to resolve an essay', () => {
    const essay: KeyQuestion[] = [{ number: 1, kind: 'essay', points: '5.00', rubric: '5 = complete' }]
    const confirmed: Answer[] = [{ number: 1, state: 'confirmed', value: 'Plants make food.' }]
    expect(calculate(essay, true, confirmed).unresolved_numbers).toEqual([1])
    const scored = calculate(essay, true, confirmed, [{ number: 1, score: '3.50', reason: 'Rubric level 3' }])
    expect(scored.final_score).toBe('3.50')
    expect(scored.items[0].automatic_score).toBeNull()
  })
})
