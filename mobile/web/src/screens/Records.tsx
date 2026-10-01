import { Camera, ChevronDown, ChevronRight, CloudUpload, FileSpreadsheet, FileText, HardDrive, Pencil, Plus, RefreshCw, Search, X, type LucideIcon } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { ClassSheet } from '../components/ClassFields'
import { ScreenHeader } from '../components/FlowHeader'
import { Select } from '../components/Select'
import { Sheet } from '../components/Sheet'
import { Badge, BrutalistButton, BrutalistCard, IconButton, MonoLabel, ProgressBar, Switch, TONE_BG, cx, type Tone } from '../components/ui'
import { classLabel, groupByLevel, levelTone, sortClasses, type TeacherClass } from '../lib/classes'
import { csvFile, draftFile } from '../lib/exports'
import { dayLabel, initials, shortDate } from '../lib/format'
import { classAverage, gradebookCsv, gradebookFileName, studentSummaryCsv } from '../lib/gradebook'
import { descriptor, formatPercent } from '../lib/grading'
import { MODES, TIERS } from '../lib/lessons'
import { LEVELS, LEVEL_ORDER, gradeLabel, gradeShort, levelOf, type Level } from '../lib/levels'
import { modeLabel } from '../lib/materials'
import {
  PAPER_SORTS,
  STUDENT_SORTS,
  classAssessments,
  isCurrent,
  pendingCount,
  recordRows,
  rowKey,
  sectionSummary,
  sortPapers,
  sortStudents,
  studentStats,
  type ClassAssessment,
  type PaperSort,
  type SectionSummary,
  type StudentSort,
  type StudentStat,
} from '../lib/records'
import { displayScore } from '../lib/scoring'
import type { RecordRow, SyncState } from '../lib/workspace'
import { isConnected, useStore, useWorkspace, type PreviewFile, type RecordsTab } from '../store'
import { MODE_ICONS } from './AiParams'
import { BADGE_FOR_TONE } from './ScanMatch'

type Range = 'any' | '7' | '30'
const RANGES: { id: Range; label: string }[] = [
  { id: 'any', label: 'Any date' },
  { id: '7', label: '7 days' },
  { id: '30', label: '30 days' },
]

const SYNC_LABEL: Record<SyncState, string | null> = {
  local: null,
  pending: 'Queued',
  synced: 'Uploaded',
  conflict: 'Conflict',
  failed: 'Upload failed',
}

function matches(r: RecordRow, q: string): boolean {
  const haystack = [r.student, r.assessment, r.classLabel, shortDate(r.dateISO), dayLabel(r.dateISO), r.dateISO.slice(0, 10)]
    .join(' ')
    .toLowerCase()
  return q.split(/\s+/).every((word) => haystack.includes(word))
}

/** Class records: every section the teacher handles, or one section when opened from the Hub. */
export function Records() {
  const ws = useWorkspace()
  const scope = useStore((s) => s.recordsScope)
  const cls = scope ? ws.classes.find((c) => c.id === scope) : undefined
  return cls ? <SectionRecords cls={cls} /> : <AllRecords />
}

function useRows() {
  const ws = useWorkspace()
  const demo = useStore((s) => s.session?.mode === 'demo')
  return useMemo(() => recordRows(ws, demo), [ws, demo])
}

/* ---------- All sections ---------- */

function AllRecords() {
  const ws = useWorkspace()
  const rows = useRows()
  const setDraft = useStore((s) => s.setDraft)
  const navigate = useStore((s) => s.navigate)
  const openRecords = useStore((s) => s.openRecords)
  const upsertClass = useStore((s) => s.upsertClass)
  const showToast = useStore((s) => s.showToast)

  const [tab, setTab] = useState<RecordsTab>(() => useStore.getState().recordsTab)
  const [level, setLevel] = useState<Level | 'all'>('all')
  const [grade, setGrade] = useState<number | 'all'>('all')
  const [query, setQuery] = useState('')
  const [range, setRange] = useState<Range>('any')
  const [sort, setSort] = useState<PaperSort>('latest')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sheet, setSheet] = useState<'avg' | 'pending' | 'files' | null>(null)
  const [adding, setAdding] = useState(false)

  const classes = sortClasses(ws.classes.filter((c) => (level === 'all' || c.level === level) && (grade === 'all' || c.grade === grade)))
  const filtering = level !== 'all' || grade !== 'all'
  const ids = new Set(classes.map((c) => c.id))
  const scoped = filtering ? rows.filter((r) => r.classId && ids.has(r.classId)) : rows
  const q = query.trim().toLowerCase()
  const cutoff = range === 'any' ? 0 : Date.now() - Number(range) * 86400000
  const papers = sortPapers(scoped.filter((r) => Date.parse(r.dateISO) >= cutoff && (!q || matches(r, q))), sort)
  const visibleClasses = q ? classes.filter((c) => `${classLabel(c)} ${c.subject} ${c.section}`.toLowerCase().includes(q)) : classes
  const modules = ws.modules.filter(
    (m) =>
      (level === 'all' || levelOf(m.draft) === level) &&
      (grade === 'all' || m.draft.grade === grade) &&
      (!q || `${m.draft.title} ${m.draft.subject} ${gradeLabel(levelOf(m.draft), m.draft.grade)} ${MODES[m.draft.mode].label}`.toLowerCase().includes(q)),
  )
  const summaries = new Map(classes.map((c) => [c.id, sectionSummary(ws, rows, c)]))
  const summary = (c: TeacherClass) => summaries.get(c.id) ?? sectionSummary(ws, rows, c)
  const pending = classes.reduce((n, c) => n + summary(c).pending, 0)
  const avg = classAverage(scoped)
  const withResults = classes.filter((c) => summary(c).results)
  const fileCount = 1 + withResults.length + modules.length

  const levelOptions: { value: Level | 'all'; label: string; hint?: string; tone?: Tone }[] = [
    { value: 'all', label: 'All levels', hint: `${ws.classes.length} sections` },
    ...LEVEL_ORDER.map((l) => {
      const n = ws.classes.filter((c) => c.level === l).length
      return { value: l, label: LEVELS[l].label, hint: n ? `${n} ${n === 1 ? 'section' : 'sections'}` : 'None yet', tone: levelTone(l) }
    }),
  ]
  const gradesInLevel = level === 'all' ? [] : [...new Set(ws.classes.filter((c) => c.level === level).map((c) => c.grade))].sort((a, b) => a - b)
  const scopeName = level === 'all' ? 'All sections' : `${LEVELS[level].label}${grade === 'all' ? '' : ` ${gradeShort(level, grade)}`}`

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader label="Class records" title="Records & Archive" tone="coral" />
      <main className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-4 py-4">
        <div className="grid grid-cols-2 gap-2">
          <Select
            label="Level"
            value={level}
            options={levelOptions}
            tone={level === 'all' ? undefined : levelTone(level)}
            onChange={(v) => {
              setLevel(v)
              setGrade('all')
            }}
          />
          <Select
            label={level === 'college' ? 'Year' : 'Grade'}
            value={String(grade)}
            disabled={level === 'all'}
            tone={level === 'all' || grade === 'all' ? undefined : levelTone(level)}
            options={[
              { value: 'all', label: level === 'college' ? 'All years' : 'All grades' },
              ...(level === 'all' ? [] : gradesInLevel.map((g) => ({ value: String(g), label: gradeLabel(level, g), tone: levelTone(level) }))),
            ]}
            onChange={(v) => setGrade(v === 'all' ? 'all' : Number(v))}
          />
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Metric label="Class avg" value={avg === null ? '—' : formatPercent(avg)} tone={avg === null ? 'white' : descriptor(avg).tone} onClick={() => setSheet('avg')} />
          <Metric label="Pending" value={String(pending)} tone={pending ? 'yellow' : 'white'} onClick={() => setSheet('pending')} />
          <Metric label="Files" value={String(fileCount)} onClick={() => setSheet('files')} />
        </div>

        <SyncCard />

        <div role="tablist" aria-label="Archive" className="grid grid-cols-3 rounded-xl border-2 border-ink bg-surface p-1 shadow-brut-sm">
          {(
            [
              ['sections', `Sections ${classes.length}`],
              ['papers', `Papers ${scoped.length}`],
              ['modules', `Modules ${modules.length}`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cx('h-9 rounded-lg text-[12.5px] font-bold', tab === id ? 'border-2 border-ink bg-coral' : '')}
            >
              {label}
            </button>
          ))}
        </div>

        <SearchBox
          value={query}
          onChange={setQuery}
          placeholder={tab === 'sections' ? 'Search sections or subjects' : tab === 'papers' ? 'Search student, assessment or date' : 'Search modules'}
        />

        {tab === 'sections' && (
          <>
            {visibleClasses.length ? (
              groupByLevel(visibleClasses).map((g) => (
                <section key={g.level}>
                  <div className="mb-1.5 flex items-center gap-2">
                    <span className={cx('rounded-md border-2 border-ink px-1.5 py-px font-mono text-[10px] font-bold uppercase', TONE_BG[levelTone(g.level)])}>
                      {LEVELS[g.level].label}
                    </span>
                    <MonoLabel className="text-subtle">
                      {g.classes.length} {g.classes.length === 1 ? 'section' : 'sections'}
                    </MonoLabel>
                  </div>
                  <ul className="space-y-2">
                    {g.classes.map((c) => (
                      <SectionCard key={c.id} cls={c} summary={summary(c)} onOpen={() => openRecords(c.id)} />
                    ))}
                  </ul>
                </section>
              ))
            ) : (
              <EmptyState title={query ? `No section matches “${query}”` : 'No sections here yet'} hint="Add the sections you teach to keep their records together." />
            )}
            <BrutalistButton size="sm" variant="secondary" icon={Plus} className="w-full" onClick={() => setAdding(true)}>
              Add a section
            </BrutalistButton>
          </>
        )}

        {tab === 'papers' && (
          <>
            <div className="flex items-center gap-2">
              <div className="flex gap-1" role="radiogroup" aria-label="Date filter">
                {RANGES.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    role="radio"
                    aria-checked={range === r.id}
                    onClick={() => setRange(r.id)}
                    className={cx(
                      'h-9 rounded-md border-2 px-1.5 font-mono text-[10px] font-bold whitespace-nowrap uppercase',
                      range === r.id ? 'border-ink bg-coral' : 'border-ink/30 text-subtle',
                    )}
                  >
                    {r.label}
                  </button>
                ))}
              </div>
              <Select label="Sort" value={sort} options={PAPER_SORTS.map((s) => ({ value: s.id, label: s.label }))} onChange={setSort} className="h-9 text-[12px]" />
            </div>
            {papers.length ? (
              <ul className="space-y-2">
                {papers.map((r) => (
                  <RecordItem key={r.id} record={r} open={expanded === r.id} onToggle={() => setExpanded((e) => (e === r.id ? null : r.id))} />
                ))}
              </ul>
            ) : (
              <EmptyState
                title={query ? `Nothing matches “${query}”` : sort === 'late' ? 'No late submissions' : 'No approved results yet'}
                hint={query ? 'Try a student name, an assessment, or a date like “Sep 28”.' : 'Scan and approve a paper to see it here.'}
              />
            )}
          </>
        )}

        {tab === 'modules' &&
          (modules.length ? (
            <ul className="space-y-2">
              {modules.map((m) => {
                const Icon = MODE_ICONS[m.draft.mode]
                return (
                  <li key={m.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(m.draft)
                        navigate('ai-draft')
                      }}
                      className="press flex w-full items-center gap-3 rounded-xl border-2 border-ink bg-surface p-3 text-left shadow-brut-sm"
                    >
                      <span className={cx('flex size-10 shrink-0 items-center justify-center rounded-lg border-2 border-ink', TONE_BG[LEVELS[levelOf(m.draft)].tone])}>
                        <Icon size={19} aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13.5px] font-bold">{m.draft.title}</span>
                        <MonoLabel className="mt-0.5 text-subtle">
                          {m.draft.origin === 'gemini'
                            ? `${modeLabel(m.draft)} • ${m.draft.material?.status === 'reviewed' ? 'Reviewed' : 'Draft'}`
                            : `${gradeShort(levelOf(m.draft), m.draft.grade)} • ${TIERS[m.draft.tier].label}`}{' '}
                          • {dayLabel(m.savedISO)}
                        </MonoLabel>
                      </span>
                      <ChevronRight size={18} aria-hidden />
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <EmptyState title={query ? `No module matches “${query}”` : 'No teaching modules yet'} hint="Generate one with the AI Assistant." />
          ))}
      </main>

      {sheet === 'avg' && (
        <AverageSheet
          title={`${scopeName}: averages`}
          onClose={() => setSheet(null)}
          overall={avg}
          rows={scoped}
          bars={withResults.map((c) => ({ id: c.id, label: classLabel(c), tone: levelTone(c.level), value: summary(c).average, count: summary(c).results, open: () => openRecords(c.id) }))}
        />
      )}
      {sheet === 'pending' && (
        <Sheet title="Pending results" subtitle={`${pending} with no approved result • ${scopeName}`} onClose={() => setSheet(null)}>
          <ul className="space-y-2">
            {classes
              .filter((c) => summary(c).pending)
              .map((c) => (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSheet(null)
                      openRecords(c.id)
                    }}
                    className="press flex w-full items-center gap-3 rounded-lg border-2 border-ink bg-surface px-3 py-2.5 text-left shadow-brut-sm"
                  >
                    <span className={cx('size-3 shrink-0 rounded-full border-2 border-ink', TONE_BG[levelTone(c.level)])} />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-bold">{classLabel(c)}</span>
                    <Badge variant="yellow" mono>
                      {summary(c).pending} left
                    </Badge>
                    <ChevronRight size={16} aria-hidden />
                  </button>
                </li>
              ))}
          </ul>
          {!pending && <p className="py-4 text-center text-[13px] text-subtle">Every student on your class lists has a result.</p>}
        </Sheet>
      )}
      {sheet === 'files' && (
        <FilesSheet
          onClose={() => setSheet(null)}
          files={[
            {
              id: 'all',
              title: `${scopeName}: gradebook`,
              hint: `${scoped.length} results • one row per paper`,
              icon: FileSpreadsheet,
              open: () => csvFile(`${scopeName}: gradebook`, gradebookFileName(filtering ? scopeName : 'all'), gradebookCsv(scoped)),
            },
            ...withResults.map((c) => ({
              id: c.id,
              title: `${classLabel(c)} class record`,
              hint: `${c.students.length} students • ranked`,
              icon: FileSpreadsheet,
              tone: levelTone(c.level),
              open: () =>
                csvFile(`${classLabel(c)} class record`, gradebookFileName(`${classLabel(c)} record`), studentSummaryCsv(classLabel(c), studentStats(c, rows, classAssessments(ws, rows, c)))),
            })),
            ...modules.map((m) => ({
              id: m.id,
              title: m.draft.title,
              hint: `${MODES[m.draft.mode].label} • ${m.draft.format === 'pdf' ? 'PDF handout' : m.draft.format === 'markdown' ? 'Markdown' : 'CSV'}`,
              icon: FileText,
              tone: LEVELS[levelOf(m.draft)].tone,
              open: () => draftFile(m.draft),
            })),
          ]}
        />
      )}
      {adding && (
        <ClassSheet
          defaults={level === 'all' ? undefined : { level, grade: grade === 'all' ? (gradesInLevel[0] ?? LEVELS[level].stops[0].value) : grade }}
          onClose={() => setAdding(false)}
          onSave={(c) => {
            upsertClass(c)
            setAdding(false)
            showToast(`Added ${classLabel(c)}`)
          }}
        />
      )}
    </div>
  )
}

function SectionCard({ cls: c, summary: s, onOpen }: { cls: TeacherClass; summary: SectionSummary; onOpen: () => void }) {
  return (
    <li>
      <button type="button" onClick={onOpen} className="press flex w-full items-stretch overflow-hidden rounded-xl border-2 border-ink bg-surface text-left shadow-brut-sm">
        <span className={cx('flex w-12 shrink-0 items-center justify-center border-r-2 border-ink font-mono text-[12px] font-extrabold', TONE_BG[levelTone(c.level)])}>
          {gradeShort(c.level, c.grade)}
        </span>
        <span className="min-w-0 flex-1 px-3 py-2.5">
          <span className="block truncate text-[14px] font-extrabold">{c.section}</span>
          <span className="block truncate text-[12px] text-subtle">
            {c.subject} • {c.students.length} students • {s.assessments} {s.assessments === 1 ? 'test' : 'tests'}
          </span>
          {(s.pending > 0 || s.late > 0) && (
            <span className="mt-1.5 flex gap-1.5">
              {s.pending > 0 && <Chip tone="yellow">{s.pending} pending</Chip>}
              {s.late > 0 && <Chip tone="coral">{s.late} late</Chip>}
            </span>
          )}
        </span>
        <span className="flex shrink-0 flex-col items-end justify-center gap-0.5 pr-3">
          <span className="font-mono text-[17px] leading-none font-extrabold">{s.average === null ? '—' : formatPercent(s.average)}</span>
          <MonoLabel className="text-subtle">avg</MonoLabel>
        </span>
      </button>
    </li>
  )
}

/* ---------- One section ---------- */

function SectionRecords({ cls: c }: { cls: TeacherClass }) {
  const ws = useWorkspace()
  const rows = useRows()
  const beginScan = useStore((s) => s.beginScan)
  const upsertClass = useStore((s) => s.upsertClass)
  const removeClass = useStore((s) => s.removeClass)
  const back = useStore((s) => s.back)
  const showToast = useStore((s) => s.showToast)
  const tone = levelTone(c.level)

  const assessments = classAssessments(ws, rows, c)
  const [only, setOnly] = useState<string | null>(null)
  const [tab, setTab] = useState<'students' | 'papers'>('students')
  const [sort, setSort] = useState<StudentSort>('score-desc')
  const [paperSort, setPaperSort] = useState<PaperSort>('latest')
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [sheet, setSheet] = useState<'avg' | 'pending' | 'files' | null>(null)
  const [editing, setEditing] = useState(false)

  const stats = studentStats(c, rows, assessments, only ?? undefined)
  const q = query.trim().toLowerCase()
  const students = sortStudents(stats, sort).filter((s) => !q || s.name.toLowerCase().includes(q))
  const classRows = rows.filter((r) => r.classId === c.id && (!only || rowKey(r) === only))
  const papers = sortPapers(classRows.filter((r) => !q || matches(r, q)), paperSort)
  const avg = classAverage(classRows)
  const rosterStats = stats.filter((s) => c.students.includes(s.name))
  const pending = pendingCount(ws, c, stats)
  const ranked = sort === 'score-desc' || sort === 'score-asc'
  const rankOf = new Map(
    stats
      .filter((s) => s.average !== null)
      .sort((a, b) => (b.average ?? 0) - (a.average ?? 0))
      .map((s, i) => [s.name, i + 1]),
  )
  const scopeTitle = only ? (assessments.find((a) => a.key === only)?.title ?? 'Assessment') : 'All assessments'

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        label={`${LEVELS[c.level].label} • ${gradeLabel(c.level, c.grade)}`}
        title={`${c.section} · ${c.subject}`}
        tone="coral"
        aside={<IconButton label="Edit section" icon={Pencil} tone={tone} onClick={() => setEditing(true)} />}
      />
      <main className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-4 py-4">
        <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="radiogroup" aria-label="Assessment">
          {[{ key: null as string | null, title: 'All assessments', results: rows.filter((r) => r.classId === c.id).length }, ...assessments].map((a) => (
            <button
              key={a.key ?? 'all'}
              type="button"
              role="radio"
              aria-checked={only === a.key}
              onClick={() => setOnly(a.key)}
              className={cx(
                'press h-8 shrink-0 rounded-lg border-2 border-ink px-2.5 text-xs font-bold whitespace-nowrap shadow-brut-sm',
                only === a.key ? 'bg-coral' : 'bg-surface',
              )}
            >
              {a.title}
              <span className="ml-1 font-mono text-[10px] opacity-70">{a.results}</span>
            </button>
          ))}
        </div>

        <div className="grid grid-cols-3 gap-2">
          <Metric label="Class avg" value={avg === null ? '—' : formatPercent(avg)} tone={avg === null ? 'white' : descriptor(avg).tone} onClick={() => setSheet('avg')} />
          <Metric label="Pending" value={String(pending)} tone={pending ? 'yellow' : 'white'} onClick={() => setSheet('pending')} />
          <Metric label="Files" value="2" onClick={() => setSheet('files')} />
        </div>

        <div role="tablist" aria-label="View" className="grid grid-cols-2 rounded-xl border-2 border-ink bg-surface p-1 shadow-brut-sm">
          {(
            [
              ['students', `Students ${stats.length}`],
              ['papers', `Papers ${classRows.length}`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cx('h-9 rounded-lg text-[13px] font-bold', tab === id ? 'border-2 border-ink bg-coral' : '')}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-[1fr_44%] gap-2">
          <SearchBox value={query} onChange={setQuery} placeholder={tab === 'students' ? 'Find a student' : 'Search papers'} />
          {tab === 'students' ? (
            <Select label="Sort students" value={sort} options={STUDENT_SORTS.map((s) => ({ value: s.id, label: s.label }))} onChange={setSort} className="text-[12.5px]" />
          ) : (
            <Select label="Sort papers" value={paperSort} options={PAPER_SORTS.map((s) => ({ value: s.id, label: s.label }))} onChange={setPaperSort} className="text-[12.5px]" />
          )}
        </div>

        {tab === 'students' ? (
          students.length ? (
            <ul className="space-y-2">
              {students.map((s) => (
                <StudentRow
                  key={s.name}
                  stat={s}
                  rank={ranked ? rankOf.get(s.name) : undefined}
                  onRoster={c.students.includes(s.name)}
                  open={expanded === s.name}
                  onToggle={() => setExpanded((e) => (e === s.name ? null : s.name))}
                />
              ))}
            </ul>
          ) : (
            <EmptyState
              title={q ? `No student matches “${query}”` : sort === 'late' ? 'No late submissions' : sort === 'missing' ? 'Everyone has taken it' : 'No students yet'}
              hint={c.students.length ? 'Change the sort or the assessment filter.' : 'Add your class list with the pencil button above.'}
            />
          )
        ) : papers.length ? (
          <ul className="space-y-2">
            {papers.map((r) => (
              <RecordItem key={r.id} record={r} hideClass open={expanded === r.id} onToggle={() => setExpanded((e) => (e === r.id ? null : r.id))} />
            ))}
          </ul>
        ) : (
          <EmptyState title={q ? `Nothing matches “${query}”` : paperSort === 'late' ? 'No late submissions' : 'No approved papers yet'} hint="Scan and approve a paper for this section to see it here." />
        )}
      </main>

      {sheet === 'avg' && (
        <AverageSheet
          title={`${c.section}: averages`}
          onClose={() => setSheet(null)}
          overall={avg}
          rows={classRows}
          bars={assessments
            .map((a) => {
              const rs = rows.filter((r) => r.classId === c.id && rowKey(r) === a.key)
              return { id: a.key, label: a.title, tone, value: classAverage(rs), count: rs.length, open: () => setOnly(a.key) }
            })
            .filter((b) => b.count)}
        />
      )}
      {sheet === 'pending' && (
        <PendingSheet
          cls={c}
          assessments={assessments.filter((a) => isCurrent(ws, a.key) && (!only || a.key === only))}
          stats={rosterStats}
          onScan={(id) => {
            setSheet(null)
            if (!beginScan(id)) showToast('That assessment has no answer key to scan with.')
          }}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === 'files' && (
        <FilesSheet
          onClose={() => setSheet(null)}
          files={[
            {
              id: 'record',
              title: `${classLabel(c)} class record`,
              hint: `${scopeTitle} • ranked, one row per student`,
              icon: FileSpreadsheet,
              tone,
              open: () => csvFile(`${classLabel(c)} class record`, gradebookFileName(`${classLabel(c)} record`), studentSummaryCsv(classLabel(c), stats)),
            },
            {
              id: 'gradebook',
              title: `${classLabel(c)} gradebook`,
              hint: `${classRows.length} results • one row per paper`,
              icon: FileSpreadsheet,
              tone,
              open: () => csvFile(`${classLabel(c)} gradebook`, gradebookFileName(classLabel(c)), gradebookCsv(classRows)),
            },
          ]}
        />
      )}
      {editing && (
        <ClassSheet
          initial={c}
          onClose={() => setEditing(false)}
          onDelete={() => {
            removeClass(c.id)
            setEditing(false)
            back()
            showToast(`Removed ${classLabel(c)}. Its results are kept.`)
          }}
          onSave={(next) => {
            upsertClass(next)
            setEditing(false)
            showToast('Section saved')
          }}
        />
      )}
    </div>
  )
}

function StudentRow({ stat: s, rank, onRoster, open, onToggle }: { stat: StudentStat; rank?: number; onRoster: boolean; open: boolean; onToggle: () => void }) {
  const grade = s.average === null ? null : descriptor(s.average)
  return (
    <li className="overflow-hidden rounded-xl border-2 border-ink bg-surface shadow-brut-sm">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center gap-2.5 p-2.5 text-left">
        {rank !== undefined ? (
          <span className={cx('flex size-8 shrink-0 items-center justify-center rounded-md border-2 border-ink font-mono text-[12px] font-extrabold', rank <= 3 ? 'bg-sun' : 'bg-canvas')}>
            {rank}
          </span>
        ) : (
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-canvas text-[10.5px] font-extrabold">{initials(s.name)}</span>
        )}
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13.5px] font-bold">{s.name}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-1">
            <MonoLabel className="text-subtle">
              {s.results.length} {s.results.length === 1 ? 'result' : 'results'}
              {s.latestISO ? ` • ${dayLabel(s.latestISO)}` : ''}
            </MonoLabel>
            {s.late > 0 && <Chip tone="coral">{s.late} late</Chip>}
            {onRoster && s.missing.length > 0 && <Chip tone="yellow">{s.missing.length} not taken</Chip>}
            {!onRoster && <Chip tone="white">Not on class list</Chip>}
          </span>
        </span>
        {grade && s.average !== null ? (
          <Badge variant={BADGE_FOR_TONE[grade.tone]} mono>
            {formatPercent(s.average)}
          </Badge>
        ) : (
          <Badge variant="muted" mono>
            —
          </Badge>
        )}
        <ChevronDown size={16} className={cx('shrink-0 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="space-y-1.5 border-t-2 border-ink bg-canvas px-3 py-2.5 text-[12.5px]">
          {grade && <p className="font-bold">{grade.label}</p>}
          {s.results.map((r) => (
            <p key={r.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">
                {r.assessment}
                {r.late && <span className="ml-1.5 font-mono text-[10px] font-bold text-alert-ink uppercase">late</span>}
              </span>
              <span className="shrink-0 font-mono font-bold">
                {displayScore(r.finalScore)}/{displayScore(r.possibleScore)} • {dayLabel(r.dateISO)}
              </span>
            </p>
          ))}
          {onRoster && s.missing.length > 0 && <p className="text-subtle">Not taken: {s.missing.map((m) => m.title).join(', ')}</p>}
          {!s.results.length && !s.missing.length && <p className="text-subtle">No assessments for this section yet.</p>}
        </div>
      )}
    </li>
  )
}

/* ---------- Shared pieces ---------- */

function Chip({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <span className={cx('rounded border border-ink px-1 font-mono text-[9px] leading-[13px] font-bold uppercase', tone === 'white' ? 'border-ink/40 text-subtle' : TONE_BG[tone])}>
      {children}
    </span>
  )
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="flex h-11 min-w-0 items-center gap-2 rounded-lg border-2 border-ink bg-surface px-3 shadow-brut-sm focus-within:shadow-brut">
      <Search size={17} aria-hidden className="shrink-0" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="min-w-0 flex-1 bg-transparent text-[14px] outline-none [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button type="button" aria-label="Clear search" onClick={() => onChange('')} className="rounded-md p-0.5">
          <X size={16} />
        </button>
      )}
    </div>
  )
}

function SyncCard() {
  const ws = useWorkspace()
  const session = useStore((s) => s.session)
  const syncing = useStore((s) => s.syncing)
  const syncNow = useStore((s) => s.syncNow)
  if (!isConnected(session)) return null
  const issues = ws.submissions.filter((s) => s.sync === 'conflict' || s.sync === 'failed')
  return (
    <BrutalistCard shadow="sm" color={issues.length ? 'coral' : 'white'} className="flex items-center gap-3 p-3">
      <CloudUpload size={20} aria-hidden className="shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-bold">Server sync</p>
        <p className="text-xs leading-snug">
          {issues.length
            ? `${issues.length} ${issues.length === 1 ? 'result needs' : 'results need'} attention. Find it under Papers.`
            : ws.outbox.length
              ? `${ws.outbox.length} waiting to upload`
              : 'Every approved result is on the server'}
        </p>
      </div>
      <BrutalistButton size="sm" variant="secondary" icon={RefreshCw} disabled={syncing} onClick={() => void syncNow()}>
        {syncing ? 'Syncing' : 'Sync'}
      </BrutalistButton>
    </BrutalistCard>
  )
}

function Metric({ label, value, tone = 'white', onClick }: { label: string; value: string; tone?: Tone; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={cx('press rounded-xl border-2 border-ink p-2.5 text-left shadow-brut-sm', TONE_BG[tone])}>
      <span className="flex items-center justify-between gap-1">
        <MonoLabel className="truncate text-ink/75">{label}</MonoLabel>
        <ChevronRight size={13} aria-hidden className="shrink-0 opacity-60" />
      </span>
      <span className="mt-1 block font-mono text-[19px] leading-none font-extrabold">{value}</span>
    </button>
  )
}

const BANDS = [
  { label: 'Outstanding', min: 90, tone: 'green' },
  { label: 'Very Satisfactory', min: 85, tone: 'green' },
  { label: 'Satisfactory', min: 80, tone: 'blue' },
  { label: 'Fairly Satisfactory', min: 75, tone: 'yellow' },
  { label: 'Did Not Meet', min: 0, tone: 'coral' },
] as const

interface Bar {
  id: string
  label: string
  tone: Tone
  value: number | null
  count: number
  open: () => void
}

function AverageSheet({ title, overall, rows, bars, onClose }: { title: string; overall: number | null; rows: RecordRow[]; bars: Bar[]; onClose: () => void }) {
  const counts = BANDS.map((b, i) => rows.filter((r) => r.percent >= b.min && (i === 0 || r.percent < BANDS[i - 1].min)).length)
  return (
    <Sheet title={title} subtitle={overall === null ? 'No results yet' : `${formatPercent(overall)} over ${rows.length} papers`} onClose={onClose}>
      <MonoLabel className="mb-1.5 text-subtle">Proficiency level</MonoLabel>
      <ul className="mb-4 space-y-1.5">
        {BANDS.map((b, i) => (
          <li key={b.label} className="grid grid-cols-[118px_1fr_26px] items-center gap-2 text-[12px]">
            <span className="truncate font-bold">{b.label}</span>
            <ProgressBar value={rows.length ? (counts[i] / rows.length) * 100 : 0} tone={b.tone} />
            <span className="text-right font-mono font-bold">{counts[i]}</span>
          </li>
        ))}
      </ul>
      {bars.length > 0 && (
        <>
          <MonoLabel className="mb-1.5 text-subtle">Breakdown • tap one to open it</MonoLabel>
          <ul className="space-y-1.5">
            {bars.map((b) => (
              <li key={b.id}>
                <button
                  type="button"
                  onClick={() => {
                    onClose()
                    b.open()
                  }}
                  className="press w-full rounded-lg border-2 border-ink bg-surface px-3 py-2 text-left shadow-brut-sm"
                >
                  <span className="mb-1 flex items-center justify-between gap-2 text-[12.5px]">
                    <span className="flex min-w-0 items-center gap-1.5 font-bold">
                      <span className={cx('size-2.5 shrink-0 rounded-full border border-ink', TONE_BG[b.tone])} />
                      <span className="truncate">{b.label}</span>
                    </span>
                    <span className="shrink-0 font-mono font-bold">
                      {b.value === null ? '—' : formatPercent(b.value)} <span className="text-subtle">• {b.count}</span>
                    </span>
                  </span>
                  <ProgressBar value={b.value ?? 0} tone={b.value === null ? 'white' : descriptor(b.value).tone} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </Sheet>
  )
}

function PendingSheet({
  cls,
  assessments,
  stats,
  onScan,
  onClose,
}: {
  cls: TeacherClass
  assessments: ClassAssessment[]
  stats: StudentStat[]
  onScan: (assessmentId: string) => void
  onClose: () => void
}) {
  const ws = useWorkspace()
  const groups = assessments
    .map((a) => ({ a, names: stats.filter((s) => s.missing.some((m) => m.key === a.key)).map((s) => s.name) }))
    .filter((g) => g.names.length)
  return (
    <Sheet title="Pending results" subtitle={`${classLabel(cls)} • no approved result yet`} onClose={onClose}>
      {groups.length ? (
        <ul className="space-y-3">
          {groups.map(({ a, names }) => {
            const scannable = ws.assessments.some((x) => x.id === a.key && x.key.questions.length)
            return (
              <li key={a.key} className="rounded-xl border-2 border-ink bg-surface p-3 shadow-brut-sm">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13.5px] font-bold">{a.title}</p>
                    <MonoLabel className="text-subtle">
                      {names.length} of {cls.students.length}
                      {a.dueISO ? ` • due ${shortDate(a.dueISO)}` : ''}
                    </MonoLabel>
                  </div>
                  {scannable && (
                    <BrutalistButton size="sm" variant="yellow" icon={Camera} onClick={() => onScan(a.key)}>
                      Scan
                    </BrutalistButton>
                  )}
                </div>
                <p className="mt-2 text-[12.5px] leading-relaxed">{names.join(', ')}</p>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="py-4 text-center text-[13px] text-subtle">
          {cls.students.length ? 'Every student on the class list has a result.' : 'Add a class list to see who has not taken an assessment.'}
        </p>
      )}
    </Sheet>
  )
}

interface FileEntry {
  id: string
  title: string
  hint: string
  icon: LucideIcon
  tone?: Tone
  open: () => PreviewFile
}

function FilesSheet({ files, onClose }: { files: FileEntry[]; onClose: () => void }) {
  const ws = useWorkspace()
  const openPreview = useStore((s) => s.openPreview)
  const setLocalSync = useStore((s) => s.setLocalSync)
  return (
    <Sheet title="Files" subtitle="Tap one to preview it, then share or save" onClose={onClose}>
      <ul className="space-y-2">
        {files.map((f) => (
          <li key={f.id}>
            <button
              type="button"
              onClick={() => {
                onClose()
                openPreview(f.open())
              }}
              className="press flex w-full items-center gap-3 rounded-lg border-2 border-ink bg-surface px-3 py-2.5 text-left shadow-brut-sm"
            >
              <span className={cx('flex size-9 shrink-0 items-center justify-center rounded-lg border-2 border-ink', TONE_BG[f.tone ?? 'white'])}>
                <f.icon size={17} aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold">{f.title}</span>
                <MonoLabel className="truncate text-subtle">{f.hint}</MonoLabel>
              </span>
              <ChevronRight size={16} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex items-center gap-3 rounded-lg border-2 border-dashed border-ink/50 px-3 py-2.5">
        <HardDrive size={18} aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-bold">Local Storage Sync</p>
          <p className="text-xs text-subtle">{ws.localSync ? 'Everything is cached on this phone' : 'Paused: new results stay in memory'}</p>
        </div>
        <Switch checked={ws.localSync} label="Local Storage Sync" onChange={setLocalSync} />
      </div>
    </Sheet>
  )
}

function RecordItem({ record: r, open, onToggle, hideClass }: { record: RecordRow; open: boolean; onToggle: () => void; hideClass?: boolean }) {
  const grade = descriptor(r.percent)
  const sync = SYNC_LABEL[r.sync]
  return (
    <li className="overflow-hidden rounded-xl border-2 border-ink bg-surface shadow-brut-sm">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center gap-3 p-2.5 text-left">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-canvas text-xs font-extrabold">
          {initials(r.student)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[13.5px] font-bold">{r.student}</span>
            {r.late && <Chip tone="coral">Late</Chip>}
            {sync && <Chip tone={r.sync === 'synced' ? 'white' : r.sync === 'pending' ? 'yellow' : 'coral'}>{sync}</Chip>}
          </span>
          <span className="block truncate text-[11.5px] text-subtle">
            {r.assessment}
            {hideClass ? '' : ` · ${r.classLabel}`} · {dayLabel(r.dateISO)}
          </span>
        </span>
        <Badge variant={BADGE_FOR_TONE[grade.tone]} mono>
          {displayScore(r.finalScore)}/{displayScore(r.possibleScore)}
        </Badge>
        <ChevronDown size={16} className={cx('shrink-0 transition-transform', open && 'rotate-180')} aria-hidden />
      </button>
      {open && (
        <div className="space-y-1.5 border-t-2 border-ink bg-canvas px-3 py-2.5 text-[12.5px]">
          <p>
            <span className="font-bold">{formatPercent(r.percent)}</span> · {grade.label} · {shortDate(r.dateISO)}
            {r.late ? ' · submitted late' : ''}
          </p>
          <p className="text-subtle">{r.missed.length ? `Missed: ${r.missed.map((q) => `Q${q}`).join(', ')}` : 'No missed items'}</p>
          {r.feedback && <p className="leading-relaxed whitespace-pre-line">{r.feedback}</p>}
          {(r.sync === 'conflict' || r.sync === 'failed') && <UploadIssue record={r} />}
        </div>
      )}
    </li>
  )
}

function UploadIssue({ record }: { record: RecordRow }) {
  const ws = useWorkspace()
  const retryUpload = useStore((s) => s.retryUpload)
  const uploadAsNewRecord = useStore((s) => s.uploadAsNewRecord)
  const dropUpload = useStore((s) => s.dropUpload)
  const error = ws.submissions.find((s) => s.id === record.id)?.syncError
  const conflict = record.sync === 'conflict'
  return (
    <div className="mt-2 rounded-lg border-2 border-ink bg-coral/20 p-2.5">
      <p className="font-semibold">{conflict ? 'The server already has a different result with this ID.' : `Upload failed: ${error ?? 'unknown error'}`}</p>
      <p className="mt-0.5 text-subtle">
        {conflict
          ? 'Your copy is kept here. Upload it as a separate record, or stop uploading it.'
          : 'Fix the cause if you can, then retry. It is never retried automatically.'}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <BrutalistButton size="sm" variant="secondary" onClick={() => dropUpload(record.id)}>
          Stop uploading
        </BrutalistButton>
        <BrutalistButton size="sm" onClick={() => (conflict ? uploadAsNewRecord(record.id) : retryUpload(record.id))}>
          {conflict ? 'Upload as new' : 'Retry'}
        </BrutalistButton>
      </div>
    </div>
  )
}

function EmptyState({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-ink/40 p-6 text-center">
      <p className="text-sm font-bold">{title}</p>
      <p className="mt-1 text-xs text-subtle">{hint}</p>
    </div>
  )
}
