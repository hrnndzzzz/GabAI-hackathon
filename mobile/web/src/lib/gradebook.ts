import { descriptor, formatPercent } from './grading'
import { displayScore } from './scoring'
import type { RecordRow } from './workspace'

function cell(value: string | number): string {
  const text = String(value)
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function gradebookCsv(records: RecordRow[]): string {
  const header = ['student', 'class', 'assessment', 'score', 'possible', 'percent', 'descriptor', 'approved', 'late', 'missed_items', 'upload']
  const rows = records.map((r) => [
    r.student,
    r.classLabel,
    r.assessment,
    displayScore(r.finalScore),
    displayScore(r.possibleScore),
    formatPercent(r.percent),
    descriptor(r.percent).label,
    r.dateISO.slice(0, 10),
    r.late ? 'yes' : 'no',
    r.missed.map((q) => `Q${q}`).join(' '),
    r.sync,
  ])
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n'
}

export function gradebookFileName(classLabel: string | 'all'): string {
  const name = classLabel === 'all' ? 'all-classes' : classLabel
  return `gabai-gradebook-${name}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/-$/, '') + '.csv'
}

export function classAverage(records: RecordRow[]): number | null {
  if (!records.length) return null
  return records.reduce((s, r) => s + r.percent, 0) / records.length
}

/** One row per student: the class summary teachers paste into their own class record. */
export function studentSummaryCsv(
  section: string,
  stats: { name: string; average: number | null; results: unknown[]; late: number; missing: { title: string }[] }[],
): string {
  const header = ['rank', 'student', 'section', 'average', 'descriptor', 'results', 'late', 'not_taken']
  const ranked = [...stats].sort((a, b) => (b.average ?? -1) - (a.average ?? -1))
  const rows = ranked.map((s, i) => [
    s.average === null ? '' : i + 1,
    s.name,
    section,
    s.average === null ? '' : formatPercent(s.average),
    s.average === null ? '' : descriptor(s.average).label,
    s.results.length,
    s.late,
    s.missing.map((m) => m.title).join('; '),
  ])
  return [header, ...rows].map((r) => r.map(cell).join(',')).join('\n') + '\n'
}
