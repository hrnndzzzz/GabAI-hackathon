import type { TeacherClass } from './classes'
import { DEMO_HISTORY } from './mock'
import { submissionRow, type RecordRow, type Workspace } from './workspace'

/** Every approved result in the workspace, newest first (demo history included in demo mode). */
export function recordRows(ws: Workspace, demo: boolean): RecordRow[] {
  const byId = new Map(ws.assessments.map((a) => [a.id, a]))
  const rows = ws.submissions.map((s) => submissionRow(s, byId.get(s.assessmentId)))
  return (demo ? [...rows, ...DEMO_HISTORY] : rows).sort((a, b) => Date.parse(b.dateISO) - Date.parse(a.dateISO))
}

export function rowKey(r: RecordRow): string {
  return r.assessmentId ?? `title:${r.assessment}`
}

export interface ClassAssessment {
  /** Assessment id, or "title:<name>" for history that predates assessment records. */
  key: string
  title: string
  dueISO: string | null
  results: number
}

/** Everything given to a section: saved assessments (even with no results yet) plus older results. */
export function classAssessments(ws: Workspace, rows: RecordRow[], c: TeacherClass): ClassAssessment[] {
  const list: ClassAssessment[] = ws.assessments
    .filter((a) => a.classId === c.id)
    .map((a) => ({ key: a.id, title: a.title, dueISO: a.dueISO, results: 0 }))
  for (const r of rows.filter((x) => x.classId === c.id)) {
    const key = rowKey(r)
    const existing = list.find((a) => a.key === key)
    if (existing) existing.results++
    else list.push({ key, title: r.assessment, dueISO: null, results: 1 })
  }
  return list
}

export interface StudentStat {
  name: string
  results: RecordRow[]
  average: number | null
  latestISO: string | null
  oldestISO: string | null
  late: number
  /** Assessments of this section the student has no result for. */
  missing: ClassAssessment[]
}

/** One entry per student on the roster, plus anyone with a result who is not on it. */
export function studentStats(c: TeacherClass, rows: RecordRow[], assessments: ClassAssessment[], only?: string): StudentStat[] {
  const classRows = rows.filter((r) => r.classId === c.id)
  const scoped = only ? assessments.filter((a) => a.key === only) : assessments
  const names = [...c.students]
  for (const r of classRows) if (!names.includes(r.student)) names.push(r.student)
  return names.map((name) => {
    const results = classRows.filter((r) => r.student === name && (!only || rowKey(r) === only))
    const dates = results.map((r) => r.dateISO).sort()
    return {
      name,
      results,
      average: results.length ? results.reduce((s, r) => s + r.percent, 0) / results.length : null,
      latestISO: dates[dates.length - 1] ?? null,
      oldestISO: dates[0] ?? null,
      late: results.filter((r) => r.late).length,
      missing: scoped.filter((a) => !results.some((r) => rowKey(r) === a.key)),
    }
  })
}

export type StudentSort = 'score-desc' | 'score-asc' | 'latest' | 'oldest' | 'late' | 'missing' | 'az' | 'za'

export const STUDENT_SORTS: { id: StudentSort; label: string }[] = [
  { id: 'score-desc', label: 'Highest score' },
  { id: 'score-asc', label: 'Lowest score' },
  { id: 'latest', label: 'Latest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'late', label: 'Late only' },
  { id: 'missing', label: "Haven't taken" },
  { id: 'az', label: 'Name A–Z' },
  { id: 'za', label: 'Name Z–A' },
]

/** Sorts students; "late" and "missing" also narrow the list to the students they describe. */
export function sortStudents(stats: StudentStat[], sort: StudentSort): StudentStat[] {
  const byName = (a: StudentStat, b: StudentStat) => a.name.localeCompare(b.name)
  const list = sort === 'late' ? stats.filter((s) => s.late) : sort === 'missing' ? stats.filter((s) => s.missing.length) : [...stats]
  switch (sort) {
    case 'score-desc':
      return list.sort((a, b) => (b.average ?? -1) - (a.average ?? -1) || byName(a, b))
    case 'score-asc':
      // Students with no result yet go last rather than first.
      return list.sort((a, b) => (a.average ?? 1000) - (b.average ?? 1000) || byName(a, b))
    case 'latest':
      return list.sort((a, b) => (b.latestISO ?? '').localeCompare(a.latestISO ?? '') || byName(a, b))
    case 'oldest':
      return list.sort((a, b) => (a.oldestISO ?? '~').localeCompare(b.oldestISO ?? '~') || byName(a, b))
    case 'late':
      return list.sort((a, b) => b.late - a.late || byName(a, b))
    case 'missing':
      return list.sort((a, b) => b.missing.length - a.missing.length || byName(a, b))
    case 'za':
      return list.sort((a, b) => byName(b, a))
    default:
      return list.sort(byName)
  }
}

/** Assessments that exist as records (not just older results), so papers can still come in. */
export function isCurrent(ws: Workspace, key: string): boolean {
  return ws.assessments.some((a) => a.id === key)
}

/** Students on the class list still without a result for one of the section's current assessments. */
export function pendingCount(ws: Workspace, c: TeacherClass, stats: StudentStat[]): number {
  return stats.filter((s) => c.students.includes(s.name)).reduce((n, s) => n + s.missing.filter((m) => isCurrent(ws, m.key)).length, 0)
}

export interface SectionSummary {
  average: number | null
  results: number
  assessments: number
  /** Roster students still without a result, summed over the section's assessments. */
  pending: number
  late: number
}

export function sectionSummary(ws: Workspace, rows: RecordRow[], c: TeacherClass): SectionSummary {
  const list = classAssessments(ws, rows, c)
  const classRows = rows.filter((r) => r.classId === c.id)
  const stats = studentStats(c, rows, list)
  return {
    average: classRows.length ? classRows.reduce((s, r) => s + r.percent, 0) / classRows.length : null,
    results: classRows.length,
    assessments: list.length,
    pending: pendingCount(ws, c, stats),
    late: classRows.filter((r) => r.late).length,
  }
}

export type PaperSort = 'latest' | 'oldest' | 'score-desc' | 'score-asc' | 'az' | 'za' | 'late'

export const PAPER_SORTS: { id: PaperSort; label: string }[] = [
  { id: 'latest', label: 'Latest first' },
  { id: 'oldest', label: 'Oldest first' },
  { id: 'score-desc', label: 'Highest score' },
  { id: 'score-asc', label: 'Lowest score' },
  { id: 'az', label: 'Name A–Z' },
  { id: 'za', label: 'Name Z–A' },
  { id: 'late', label: 'Late only' },
]

export function sortPapers(rows: RecordRow[], sort: PaperSort): RecordRow[] {
  const list = sort === 'late' ? rows.filter((r) => r.late) : [...rows]
  const byDate = (a: RecordRow, b: RecordRow) => Date.parse(b.dateISO) - Date.parse(a.dateISO)
  switch (sort) {
    case 'oldest':
      return list.sort((a, b) => -byDate(a, b))
    case 'score-desc':
      return list.sort((a, b) => b.percent - a.percent || byDate(a, b))
    case 'score-asc':
      return list.sort((a, b) => a.percent - b.percent || byDate(a, b))
    case 'az':
      return list.sort((a, b) => a.student.localeCompare(b.student) || byDate(a, b))
    case 'za':
      return list.sort((a, b) => b.student.localeCompare(a.student) || byDate(a, b))
    default:
      return list.sort(byDate)
  }
}
