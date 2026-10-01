import { displayScore, formatHundredths, scorePercent, toHundredths, type KeyQuestion, type Score } from './scoring'

/** DepEd K-12 proficiency descriptors. */
export function descriptor(percent: number): { label: string; tone: 'green' | 'blue' | 'yellow' | 'coral' } {
  if (percent >= 90) return { label: 'Outstanding', tone: 'green' }
  if (percent >= 85) return { label: 'Very Satisfactory', tone: 'green' }
  if (percent >= 80) return { label: 'Satisfactory', tone: 'blue' }
  if (percent >= 75) return { label: 'Fairly Satisfactory', tone: 'yellow' }
  return { label: 'Did Not Meet Expectations', tone: 'coral' }
}

export function formatPercent(percent: number): string {
  return `${Math.round(percent * 10) / 10}%`.replace('.0%', '%')
}

export const KIND_LABEL: Record<KeyQuestion['kind'], string> = {
  multiple_choice: 'Multiple Choice',
  true_false: 'True or False',
  essay: 'Essay',
}

export interface PartTotal {
  kind: KeyQuestion['kind']
  label: string
  earned: string
  possible: string
  weight: number
}

/** Points per question type; weight is that type's share of the possible score. */
export function partTotals(questions: KeyQuestion[], score: Score): PartTotal[] {
  const total = toHundredths(score.possible_score)
  const kinds = [...new Set(questions.map((q) => q.kind))]
  return kinds.map((kind) => {
    const numbers = new Set(questions.filter((q) => q.kind === kind).map((q) => q.number))
    const items = score.items.filter((i) => numbers.has(i.number))
    const earned = items.reduce((s, i) => s + (i.final_score ? toHundredths(i.final_score) : 0), 0)
    const possible = items.reduce((s, i) => s + toHundredths(i.possible_score), 0)
    return {
      kind,
      label: KIND_LABEL[kind],
      earned: displayScore(formatHundredths(earned)),
      possible: displayScore(formatHundredths(possible)),
      weight: total ? Math.round((possible / total) * 100) : 0,
    }
  })
}

export interface FeedbackOptions {
  warm: boolean
  nextStep: boolean
  short: boolean
  bilingual: boolean
}

function joinList(list: string[], conjunction = 'and'): string {
  if (list.length <= 1) return list.join('')
  return `${list.slice(0, -1).join(', ')} ${conjunction} ${list[list.length - 1]}`
}

/** Template feedback written on the device; the teacher edits it before saving. */
export function buildFeedback(
  student: string,
  score: Score,
  topics: Record<number, string>,
  opts: FeedbackOptions,
): string {
  const first = student.trim().split(/\s+/)[0] || 'Student'
  const missed = score.items.filter(
    (i) => i.final_score !== null && toHundredths(i.final_score) < toHundredths(i.possible_score),
  )
  const topicOf = (n: number) => topics[n]
  const allTopics = [...new Set(score.items.map((i) => topicOf(i.number)).filter(Boolean))]
  const weak = [...new Set(missed.map((m) => topicOf(m.number)).filter(Boolean))]
  const strong = allTopics.filter((t) => !weak.includes(t))
  const pct = formatPercent(scorePercent(score))
  const earned = `${displayScore(score.final_score)}/${displayScore(score.possible_score)}`
  const qList = missed.map((m) => `Q${m.number}`).join(', ')

  const opening = opts.warm
    ? scorePercent(score) >= 85
      ? `Wonderful work, ${first}! You earned ${earned} (${pct}).`
      : `Thank you for your effort, ${first}. You earned ${earned} (${pct}), and you are building real skills.`
    : `${first}, you scored ${earned} (${pct}).`

  // Without topic tags (keys made on the device) there is nothing honest to say about strengths.
  const strength = strong.length
    ? `You showed solid understanding of ${joinList(strong)}.`
    : allTopics.length && missed.length
      ? 'Every topic has room to grow, so let us take it one step at a time.'
      : ''
  const growth = missed.length
    ? weak.length
      ? `Review ${joinList(weak)} by revisiting ${qList}.`
      : `Revisit ${qList} and compare your answers with your notes.`
    : 'No missed items — excellent mastery across the whole test.'
  const next = missed.length
    ? `Next step: redo ${qList}${weak[0] ? ` using your notes on ${weak[0]}` : ''}, then explain your answer to a classmate.`
    : 'Next step: try a harder extension problem to stretch your thinking.'

  const sentences = opts.short ? [opening, missed.length ? growth : strength || growth] : [opening, strength, growth]
  if (opts.nextStep) sentences.push(next)

  let text = sentences.filter(Boolean).join(' ')
  if (opts.bilingual) {
    const tl = missed.length
      ? `Sa Filipino: Mahusay, ${first}! Balikan ang ${qList}${
          weak.length ? ` at pag-aralang muli ang ${joinList(weak.map((t) => t.replace(/^the /, '')), 'at')}` : ''
        }.`
      : `Sa Filipino: Napakahusay, ${first}! Wala kang mali sa pagsusulit na ito.`
    text += `\n\n${tl}`
  }
  return text
}
