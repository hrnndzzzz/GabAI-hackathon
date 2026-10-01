import { ArrowLeft, ChevronDown, ChevronRight, CloudUpload, Download, HardDrive, RefreshCw, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge, BrutalistButton, BrutalistCard, IconButton, MonoLabel, Switch, TONE_BG, cx } from '../components/ui'
import { dayLabel, initials, shortDate } from '../lib/format'
import { classAverage, gradebookCsv, gradebookFileName } from '../lib/gradebook'
import { descriptor, formatPercent } from '../lib/grading'
import { MODES, TIERS } from '../lib/lessons'
import { LEVELS, gradeLabel, gradeShort, levelOf } from '../lib/levels'
import { modeLabel } from '../lib/materials'
import { shareTextFile } from '../lib/native'
import { classLabels, filesOnDevice, recordRows } from '../lib/records'
import { displayScore } from '../lib/scoring'
import type { RecordRow, SyncState } from '../lib/workspace'
import { awaitingFor, isConnected, useStore, useWorkspace } from '../store'
import { MODE_ICONS } from './AiParams'
import { BADGE_FOR_TONE } from './ScanMatch'

type Range = 'any' | '7' | '30'
const RANGES: { id: Range; label: string }[] = [
  { id: 'any', label: 'Any date' },
  { id: '7', label: 'Last 7 days' },
  { id: '30', label: 'Last 30 days' },
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

export function Records() {
  const ws = useWorkspace()
  const session = useStore((s) => s.session)
  const syncing = useStore((s) => s.syncing)
  const syncNow = useStore((s) => s.syncNow)
  const setLocalSync = useStore((s) => s.setLocalSync)
  const setDraft = useStore((s) => s.setDraft)
  const navigate = useStore((s) => s.navigate)
  const back = useStore((s) => s.back)
  const showToast = useStore((s) => s.showToast)
  const demo = session?.mode === 'demo'
  const connected = isConnected(session)

  const [tab, setTab] = useState<'papers' | 'modules'>('papers')
  const [query, setQuery] = useState('')
  const [classFilter, setClassFilter] = useState<string | 'all'>('all')
  const [range, setRange] = useState<Range>('any')
  const [expanded, setExpanded] = useState<string | null>(null)

  const all = useMemo(() => recordRows(ws, demo), [ws, demo])
  const labels = classLabels(ws, demo)
  const q = query.trim().toLowerCase()
  const inClass = all.filter((r) => classFilter === 'all' || r.classLabel === classFilter)
  const cutoff = range === 'any' ? 0 : Date.now() - Number(range) * 86400000
  const filtered = inClass.filter((r) => Date.parse(r.dateISO) >= cutoff && (!q || matches(r, q)))
  const visibleModules = ws.modules.filter(
    (m) =>
      !q ||
      `${m.draft.title} ${m.draft.subject} ${gradeLabel(levelOf(m.draft), m.draft.grade)} ${LEVELS[levelOf(m.draft)].label} ${MODES[m.draft.mode].label}`
        .toLowerCase()
        .includes(q),
  )

  const avg = classAverage(inClass)
  const pending = demo
    ? ws.assessments.filter((a) => classFilter === 'all' || a.classLabel === classFilter).reduce((s, a) => s + awaitingFor(ws, a), 0)
    : ws.outbox.filter((o) => classFilter === 'all' || ws.submissions.find((s) => s.id === o.refId)?.classLabel === classFilter).length
  const issues = ws.submissions.filter((s) => s.sync === 'conflict' || s.sync === 'failed')

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b-2 border-ink bg-canvas px-4 pt-3 pb-3">
        <div className="flex items-center gap-3">
          <IconButton label="Back" icon={ArrowLeft} onClick={() => back()} />
          <div className="min-w-0 flex-1">
            <MonoLabel className="text-subtle">Step 03 • Database</MonoLabel>
            <h1 className="truncate text-[17px] leading-tight font-extrabold">Records & Archive</h1>
          </div>
          <span className="h-10 w-2.5 rounded-full border-2 border-ink bg-coral" aria-hidden />
        </div>
        <div className="mt-3 flex h-11 items-center gap-2 rounded-lg border-2 border-ink bg-white px-3 shadow-brut-sm focus-within:shadow-brut">
          <Search size={18} aria-hidden className="shrink-0" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={tab === 'papers' ? 'Search class, date, or student name' : 'Search modules'}
            aria-label="Search records"
            className="min-w-0 flex-1 bg-transparent text-[14px] outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {query && (
            <button type="button" aria-label="Clear search" onClick={() => setQuery('')} className="rounded-md p-0.5">
              <X size={17} />
            </button>
          )}
        </div>
      </header>

      <main className="min-h-0 flex-1 space-y-3.5 overflow-y-auto px-4 py-4">
        <div role="tablist" aria-label="Archive" className="grid grid-cols-2 rounded-xl border-2 border-ink bg-white p-1 shadow-brut-sm">
          {(
            [
              ['papers', `Graded papers · ${all.length}`],
              ['modules', `Teaching modules · ${ws.modules.length}`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cx('h-9 rounded-lg text-[13px] font-bold', tab === id ? 'border-2 border-ink bg-coral' : 'text-ink')}
            >
              {label}
            </button>
          ))}
        </div>

        {tab === 'papers' ? (
          <>
            <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 pb-1" role="radiogroup" aria-label="Class filter">
              {['all', ...labels].map((label) => (
                <button
                  key={label}
                  type="button"
                  role="radio"
                  aria-checked={classFilter === label}
                  onClick={() => setClassFilter(label)}
                  className={cx(
                    'press h-8 shrink-0 rounded-lg border-2 border-ink px-2.5 text-xs font-bold whitespace-nowrap shadow-brut-sm',
                    classFilter === label ? 'bg-coral' : 'bg-white',
                  )}
                >
                  {label === 'all' ? 'All classes' : label}
                </button>
              ))}
            </div>
            <div className="flex gap-1.5" role="radiogroup" aria-label="Date filter">
              {RANGES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  role="radio"
                  aria-checked={range === r.id}
                  onClick={() => setRange(r.id)}
                  className={cx(
                    'h-7 rounded-md border-2 px-2 font-mono text-[10.5px] font-bold uppercase',
                    range === r.id ? 'border-ink bg-coral text-ink' : 'border-ink/30 bg-transparent text-subtle',
                  )}
                >
                  {r.label}
                </button>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2">
              <Metric label="Class avg" value={avg === null ? '—' : formatPercent(avg)} />
              <Metric label={demo ? 'Pending' : 'To upload'} value={String(pending)} tone={pending ? 'yellow' : 'white'} />
              <Metric label="Files" value={String(filesOnDevice(ws, demo))} />
            </div>

            <BrutalistCard shadow="sm" className="flex items-center gap-3 p-3">
              <HardDrive size={20} aria-hidden className="shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-bold">Local Storage Sync</p>
                <p className="text-xs leading-snug text-subtle">
                  {ws.localSync ? 'All files cached on device' : 'Paused. New results stay in memory until you turn this back on.'}
                </p>
              </div>
              <Switch
                checked={ws.localSync}
                label="Local Storage Sync"
                onChange={(on) => {
                  setLocalSync(on)
                  showToast(on ? 'Local Storage Sync on. Everything is cached on this device.' : 'Local Storage Sync paused')
                }}
              />
            </BrutalistCard>

            {connected && (
              <BrutalistCard shadow="sm" className="flex items-center gap-3 p-3">
                <CloudUpload size={20} aria-hidden className="shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-bold">Server sync</p>
                  <p className="text-xs leading-snug text-subtle">
                    {issues.length
                      ? `${issues.length} ${issues.length === 1 ? 'result needs' : 'results need'} attention: ${issues[0].syncError ?? 'upload failed'}`
                      : ws.outbox.length
                        ? `${ws.outbox.length} waiting to upload`
                        : 'Every approved result is on the server'}
                  </p>
                </div>
                <BrutalistButton size="sm" variant="secondary" icon={RefreshCw} disabled={syncing} onClick={() => void syncNow()}>
                  {syncing ? 'Syncing' : 'Sync'}
                </BrutalistButton>
              </BrutalistCard>
            )}

            <div className="flex items-center justify-between gap-2 pt-1">
              <p className="text-[13px] font-bold">
                {filtered.length} {filtered.length === 1 ? 'record' : 'records'}
              </p>
              <BrutalistButton
                size="sm"
                variant="secondary"
                icon={Download}
                disabled={!filtered.length}
                onClick={() => {
                  shareTextFile(gradebookFileName(classFilter), 'text/csv', gradebookCsv(filtered))
                  showToast(`Exported ${filtered.length} records to CSV`)
                }}
              >
                Gradebook CSV
              </BrutalistButton>
            </div>

            {filtered.length ? (
              <ul className="space-y-2">
                {filtered.map((r) => (
                  <RecordItem key={r.id} record={r} open={expanded === r.id} onToggle={() => setExpanded((e) => (e === r.id ? null : r.id))} />
                ))}
              </ul>
            ) : (
              <EmptyState query={query} />
            )}
          </>
        ) : visibleModules.length ? (
          <ul className="space-y-2">
            {visibleModules.map((m) => {
              const Icon = MODE_ICONS[m.draft.mode]
              return (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setDraft(m.draft)
                      navigate('ai-draft')
                    }}
                    className="press flex w-full items-center gap-3 rounded-xl border-2 border-ink bg-white p-3 text-left shadow-brut-sm"
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
          <EmptyState query={query} modules />
        )}
      </main>
    </div>
  )
}

function Metric({ label, value, tone = 'white' }: { label: string; value: string; tone?: 'white' | 'yellow' }) {
  return (
    <div className={cx('rounded-xl border-2 border-ink p-2.5 shadow-brut-sm', tone === 'yellow' ? 'bg-sun' : 'bg-white')}>
      <MonoLabel className="text-ink/75">{label}</MonoLabel>
      <p className="mt-1 font-mono text-[19px] leading-none font-extrabold">{value}</p>
    </div>
  )
}

function RecordItem({ record: r, open, onToggle }: { record: RecordRow; open: boolean; onToggle: () => void }) {
  const grade = descriptor(r.percent)
  const sync = SYNC_LABEL[r.sync]
  return (
    <li className="overflow-hidden rounded-xl border-2 border-ink bg-white shadow-brut-sm">
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center gap-3 p-2.5 text-left">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-canvas text-xs font-extrabold">
          {initials(r.student)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-[13.5px] font-bold">{r.student}</span>
            {sync && (
              <span
                className={cx(
                  'shrink-0 rounded border px-1 font-mono text-[9px] font-bold uppercase',
                  r.sync === 'synced' ? 'border-ink/30 text-subtle' : r.sync === 'pending' ? 'border-ink bg-sun' : 'border-ink bg-coral',
                )}
              >
                {sync}
              </span>
            )}
          </span>
          <span className="block truncate text-[11.5px] text-subtle">
            {r.assessment} · {r.classLabel} · {dayLabel(r.dateISO)}
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

function EmptyState({ query, modules }: { query: string; modules?: boolean }) {
  return (
    <div className="rounded-xl border-2 border-dashed border-ink/40 p-6 text-center">
      <p className="text-sm font-bold">{query ? `Nothing matches “${query}”` : modules ? 'No teaching modules yet' : 'No approved results yet'}</p>
      <p className="mt-1 text-xs text-subtle">
        {query ? 'Try a student name, a class, or a date like “Sep 28”.' : modules ? 'Generate one with the AI Assistant.' : 'Scan and approve a paper to see it here.'}
      </p>
    </div>
  )
}
