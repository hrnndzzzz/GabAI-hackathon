import {
  ArrowRight,
  Bell,
  BookOpen,
  Camera,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  ClipboardCheck,
  CloudUpload,
  Cpu,
  Download,
  FolderOpen,
  KeyRound,
  LifeBuoy,
  LogOut,
  Plus,
  RefreshCw,
  ScanLine,
  ShieldAlert,
  Sparkles,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { CollapsibleCategory } from '../components/CollapsibleCategory'
import { BrandPill } from '../components/Logo'
import { Badge, BrutalistButton, BrutalistCard, IconButton, IconTile, MonoLabel, TONE_BG, cx, type Tone } from '../components/ui'
import { useBackHandler } from '../lib/back'
import { greeting, initials, relativeTime } from '../lib/format'
import { classAverage, gradebookCsv, gradebookFileName } from '../lib/gradebook'
import { formatPercent } from '../lib/grading'
import { MODES, type Mode } from '../lib/lessons'
import { gradeShort, levelOf } from '../lib/levels'
import { modeLabel } from '../lib/materials'
import { DEMO_TEACHER } from '../lib/mock'
import { shareTextFile } from '../lib/native'
import { classLabels, filesOnDevice, recordRows } from '../lib/records'
import { displayScore } from '../lib/scoring'
import { useNow } from '../lib/useNow'
import type { LocalAssessment, Workspace } from '../lib/workspace'
import { awaitingFor, isConnected, useStore, useWorkspace, type Connection, type HubPanel as Panel } from '../store'

interface Note {
  id: string
  kind: 'urgent' | 'key' | 'ai' | 'sync'
  title: string
  body: string
  time: string
  run?: () => void
}

export function Hub() {
  // Open category and scroll live in the store so they survive opening a feature and coming back.
  const open = useStore((s) => s.hubPanel)
  const setHubPanel = useStore((s) => s.setHubPanel)
  const toggle = (panel: Panel) => setHubPanel(open === panel ? null : panel)
  const mainRef = useRef<HTMLElement>(null)
  useLayoutEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = useStore.getState().hubScroll
  }, [])
  const ws = useWorkspace()
  const demo = useStore((s) => s.session?.mode === 'demo')

  const pending = ws.assessments.filter((a) => awaitingFor(ws, a) > 0)
  const urgentCount = pending.filter((a) => a.urgent).length
  const issues = ws.outbox.filter((o) => o.lastError).length

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      <main
        ref={mainRef}
        onScroll={(e) => useStore.setState({ hubScroll: e.currentTarget.scrollTop })}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pt-1 pb-4 short:space-y-2.5 short:pb-3"
      >
        <ConnectionBanner />
        <GreetingCard />

        <CollapsibleCategory
          title="Quick Assessments & OCR"
          subtitle="Step 01 • Optical grading"
          icon={ScanLine}
          color="yellow"
          open={open === 'ocr'}
          onToggle={() => toggle('ocr')}
          badges={
            demo ? (
              pending.length ? (
                <>
                  {urgentCount > 0 && (
                    <Badge variant="urgent" pulse mono>
                      {urgentCount} Urgent
                    </Badge>
                  )}
                  <Badge>{pending.length} Pending</Badge>
                </>
              ) : (
                <Badge variant="green">All graded</Badge>
              )
            ) : (
              <>
                {issues > 0 && (
                  <Badge variant="urgent" pulse mono>
                    {issues} Sync {issues === 1 ? 'issue' : 'issues'}
                  </Badge>
                )}
                <Badge>
                  {ws.assessments.length} {ws.assessments.length === 1 ? 'Assessment' : 'Assessments'}
                </Badge>
              </>
            )
          }
        >
          <OcrDrawer />
        </CollapsibleCategory>

        <CollapsibleCategory
          title="AI Teaching Modules"
          subtitle="Step 02 • Synthesis"
          icon={Sparkles}
          color="green"
          open={open === 'ai'}
          onToggle={() => toggle('ai')}
          badges={
            <Badge>
              {ws.modules.length} Modules • {demo ? 'Demo' : 'Gemini'}
            </Badge>
          }
        >
          <AiDrawer />
        </CollapsibleCategory>

        <CollapsibleCategory
          title="Class Records & Archive"
          subtitle="Step 03 • Database"
          icon={FolderOpen}
          color="coral"
          open={open === 'archive'}
          onToggle={() => toggle('archive')}
          badges={
            <Badge>
              {filesOnDevice(ws, demo)} Files • {classLabels(ws, demo).length} Classes
            </Badge>
          }
        >
          <ArchiveDrawer />
        </CollapsibleCategory>
      </main>
      <Dock />
    </div>
  )
}

function useNotes(ws: Workspace, demo: boolean, connection: Connection): Note[] {
  const beginScan = useStore((s) => s.beginScan)
  const navigate = useStore((s) => s.navigate)
  const setMfaPrompt = useStore((s) => s.setMfaPrompt)
  if (demo) {
    const urgent = ws.assessments.find((a) => a.urgent)
    const left = urgent ? awaitingFor(ws, urgent) : 0
    return [
      {
        id: 'n-urgent-bio',
        kind: 'urgent',
        title: `${urgent?.title ?? 'Assessment'} due today`,
        body: left ? `${left} ${left === 1 ? 'paper' : 'papers'} in ${urgent?.classLabel} awaiting review.` : 'All papers are reviewed.',
        time: '8:05 AM',
        run: left && urgent ? () => beginScan(urgent.id) : undefined,
      },
      { id: 'n-key-b', kind: 'key', title: 'Answer key verified', body: 'Bio Midterm for G9 Bio · Narra is ready to scan.', time: 'Yesterday' },
      {
        id: 'n-demo',
        kind: 'ai',
        title: 'Demo workspace',
        body: 'Recognition and lesson drafts here are simulated and never leave this device.',
        time: 'Mon',
      },
    ]
  }
  const notes: Note[] = []
  if (connection === 'mfa_required') {
    notes.push({ id: 'n-mfa', kind: 'sync', title: 'Two-step verification needed', body: 'Verify to upload results and use online AI.', time: 'Now', run: () => setMfaPrompt(true) })
  }
  for (const item of ws.outbox.filter((o) => o.lastError)) {
    const label =
      item.kind === 'assessment' ? item.payload.title : `${item.payload.submission.student_label}'s result`
    notes.push({ id: `n-${item.id}-${item.attempts}`, kind: 'sync', title: 'Upload needs attention', body: `${label}: ${item.lastError}`, time: 'Sync', run: () => navigate('records') })
  }
  const queued = ws.outbox.filter((o) => !o.lastError).length
  if (queued) {
    notes.push({ id: `n-queued-${queued}`, kind: 'key', title: `${queued} ${queued === 1 ? 'upload' : 'uploads'} queued`, body: 'They upload automatically next time you are online.', time: 'Sync' })
  }
  for (const a of ws.assessments.filter((x) => !x.key.verified)) {
    notes.push({ id: `n-unverified-${a.id}`, kind: 'urgent', title: 'Answer key not verified', body: `${a.title} can be scanned, but results cannot be approved until its key is verified.`, time: 'Key' })
  }
  return notes
}

function TopBar() {
  const [menu, setMenu] = useState<'notifications' | 'profile' | null>(null)
  useBackHandler(menu !== null, () => setMenu(null))
  const ws = useWorkspace()
  const session = useStore((s) => s.session)
  const connection = useStore((s) => s.connection)
  const markRead = useStore((s) => s.markNotificationsRead)
  const navigate = useStore((s) => s.navigate)
  const signOut = useStore((s) => s.signOut)
  const demo = session?.mode === 'demo'
  const notes = useNotes(ws, demo, connection)
  const unread = notes.filter((n) => !ws.readNotifications.includes(n.id)).length
  const name = demo ? DEMO_TEACHER.display : ws.displayName
  const email = isConnected(session) ? session.email : DEMO_TEACHER.email

  const icons: Record<Note['kind'], [LucideIcon, Tone]> = {
    urgent: [TriangleAlert, 'coral'],
    key: [KeyRound, 'green'],
    ai: [Cpu, 'blue'],
    sync: [CloudUpload, 'yellow'],
  }

  return (
    <header className="relative z-30 flex shrink-0 items-center justify-between px-4 pt-3 pb-3 short:pb-2">
      <BrandPill />
      <div className="flex items-center gap-2">
        <IconButton
          label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
          icon={Bell}
          aria-expanded={menu === 'notifications'}
          onClick={() => setMenu((m) => (m === 'notifications' ? null : 'notifications'))}
        >
          {unread > 0 && <span className="absolute -top-1.5 -right-1.5 size-3.5 rounded-full border-2 border-ink bg-coral" aria-hidden />}
        </IconButton>
        <button
          type="button"
          aria-label={`Account: ${name}`}
          aria-expanded={menu === 'profile'}
          onClick={() => setMenu((m) => (m === 'profile' ? null : 'profile'))}
          className="press flex size-10 items-center justify-center rounded-full border-2 border-ink bg-sun text-[13px] font-extrabold shadow-brut-sm"
        >
          {demo ? DEMO_TEACHER.initials : initials(name) || 'T'}
        </button>
      </div>

      {menu && (
        <>
          <button type="button" aria-label="Close menu" className="fixed inset-0 z-10 cursor-default bg-ink/10" onClick={() => setMenu(null)} />
          <BrutalistCard shadow="lg" className="absolute top-[58px] right-4 z-20 w-[min(330px,calc(100%-32px))] animate-toast-in p-3">
            {menu === 'notifications' ? (
              <>
                <div className="mb-2 flex items-center justify-between">
                  <h2 className="text-[15px] font-bold">Notifications</h2>
                  <button
                    type="button"
                    disabled={!unread}
                    onClick={() => markRead(notes.map((n) => n.id))}
                    className="rounded-md px-1.5 py-1 text-xs font-bold underline underline-offset-2 disabled:no-underline disabled:opacity-40"
                  >
                    Mark all read
                  </button>
                </div>
                {notes.length ? (
                  <ul className="max-h-[60vh] space-y-2 overflow-y-auto">
                    {notes.map((n) => {
                      const [Icon, tone] = icons[n.kind]
                      const isUnread = !ws.readNotifications.includes(n.id)
                      return (
                        <li key={n.id}>
                          <button
                            type="button"
                            disabled={!n.run}
                            onClick={() => {
                              setMenu(null)
                              markRead([n.id])
                              n.run?.()
                            }}
                            className={cx(
                              'flex w-full items-start gap-2.5 rounded-lg border-2 border-ink p-2.5 text-left disabled:cursor-default',
                              isUnread ? 'bg-canvas' : 'bg-white',
                            )}
                          >
                            <IconTile icon={Icon} tone={tone} size={32} />
                            <span className="min-w-0 flex-1">
                              <span className="flex items-center gap-1.5 text-[13px] font-bold">
                                {n.title}
                                {isUnread && <span className="size-2 rounded-full bg-coral ring-1 ring-ink" aria-label="unread" />}
                              </span>
                              <span className="block text-xs leading-snug text-subtle">{n.body}</span>
                            </span>
                            <span className="shrink-0 font-mono text-[10px] text-subtle">{n.time}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                ) : (
                  <p className="rounded-lg border-2 border-dashed border-ink/30 p-4 text-center text-[13px] text-subtle">You're all caught up.</p>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <span className="flex size-12 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-sun font-extrabold">
                    {demo ? DEMO_TEACHER.initials : initials(name) || 'T'}
                  </span>
                  <div className="min-w-0">
                    <p className="truncate font-bold">{demo ? `${DEMO_TEACHER.firstName} ${DEMO_TEACHER.lastName}` : name}</p>
                    <p className="truncate text-xs text-subtle">{email}</p>
                    <MonoLabel className="mt-0.5">{demo ? 'Demo workspace' : 'GabAI account'}</MonoLabel>
                  </div>
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <BrutalistButton
                    size="sm"
                    variant="secondary"
                    icon={FolderOpen}
                    onClick={() => {
                      setMenu(null)
                      navigate('records')
                    }}
                  >
                    Records
                  </BrutalistButton>
                  <BrutalistButton size="sm" variant="alert" icon={LogOut} onClick={() => void signOut()}>
                    {demo ? 'Exit demo' : 'Sign out'}
                  </BrutalistButton>
                </div>
                {!demo && (
                  <p className="mt-2.5 text-[11.5px] leading-snug text-subtle">
                    Results stay on this phone after you sign out so you can keep working offline.
                  </p>
                )}
              </>
            )}
          </BrutalistCard>
        </>
      )}
    </header>
  )
}

function ConnectionBanner() {
  const connection = useStore((s) => s.connection)
  const connected = useStore((s) => isConnected(s.session))
  const setMfaPrompt = useStore((s) => s.setMfaPrompt)
  const signOut = useStore((s) => s.signOut)
  if (!connected || (connection !== 'mfa_required' && connection !== 'signed_out')) return null
  const mfa = connection === 'mfa_required'
  return (
    <div role="alert" className="flex items-center gap-3 rounded-xl border-2 border-ink bg-sun p-3 shadow-brut-sm">
      <ShieldAlert size={20} aria-hidden className="shrink-0" />
      <p className="min-w-0 flex-1 text-[13px] leading-snug font-semibold">
        {mfa ? 'Verify two-step sign-in to upload results.' : 'Your session ended. Sign in again to upload.'}
      </p>
      <BrutalistButton size="sm" variant="dark" onClick={() => (mfa ? setMfaPrompt(true) : void signOut())}>
        {mfa ? 'Verify' : 'Sign in'}
      </BrutalistButton>
    </div>
  )
}

function GreetingCard() {
  const ws = useWorkspace()
  const demo = useStore((s) => s.session?.mode === 'demo')
  const connection = useStore((s) => s.connection)
  const syncing = useStore((s) => s.syncing)
  const syncNow = useStore((s) => s.syncNow)
  const showToast = useStore((s) => s.showToast)
  const [demoSyncing, setDemoSyncing] = useState(false)
  const now = useNow()
  const papers = ws.assessments.reduce((s, a) => s + awaitingFor(ws, a), 0)
  const queued = ws.outbox.filter((o) => !o.lastError).length
  const stuck = ws.outbox.length - queued
  const busy = syncing || demoSyncing
  const name = demo ? DEMO_TEACHER.display : ws.displayName

  function sync() {
    if (busy) return
    if (!demo) {
      void syncNow()
      return
    }
    setDemoSyncing(true)
    setTimeout(() => {
      setDemoSyncing(false)
      void syncNow({ quiet: true })
      showToast('Demo workspace saved on this device')
    }, 900)
  }

  const chip = demo
    ? `${DEMO_TEACHER.term} • Active Session`
    : connection === 'offline'
      ? 'Offline • working on device'
      : connection === 'online'
        ? 'Online • GabAI server'
        : 'Connecting…'

  return (
    <BrutalistCard className="p-4 short:p-3">
      <div className="flex items-center justify-between gap-2">
        <Badge dot variant={!demo && connection === 'offline' ? 'muted' : 'neutral'}>
          {chip}
        </Badge>
        <span className="font-mono text-[11px] font-bold tracking-wide">
          {demo ? DEMO_TEACHER.ay : new Date(now).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()}
        </span>
      </div>
      <h1 className="mt-3 text-[22px] leading-[1.15] font-extrabold tracking-tight max-[380px]:text-[19px] short:mt-2 short:text-[20px]">
        {greeting(new Date(now))}, {name}
      </h1>
      <div className="mt-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] leading-snug">
            {demo ? (
              <>
                <span className="font-bold">
                  {papers} {papers === 1 ? 'paper' : 'papers'}
                </span>{' '}
                pending rubric evaluation
              </>
            ) : stuck ? (
              <>
                <span className="font-bold">
                  {stuck} {stuck === 1 ? 'upload needs' : 'uploads need'}
                </span>{' '}
                your attention in Records
              </>
            ) : queued ? (
              <>
                <span className="font-bold">
                  {queued} {queued === 1 ? 'upload' : 'uploads'}
                </span>{' '}
                waiting to sync
              </>
            ) : ws.assessments.length ? (
              <>All results are uploaded</>
            ) : (
              <>Create an assessment to start grading</>
            )}
          </p>
          <MonoLabel className="mt-1 text-subtle">{busy ? 'Syncing…' : `Synced ${relativeTime(ws.lastSyncedISO, now)}`}</MonoLabel>
        </div>
        <button
          type="button"
          onClick={sync}
          aria-busy={busy}
          className="press inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border-2 border-ink bg-brand px-3 text-[13px] font-bold shadow-brut-sm"
        >
          <RefreshCw size={15} strokeWidth={2.5} className={cx(busy && 'animate-spin')} aria-hidden />
          Sync
        </button>
      </div>
    </BrutalistCard>
  )
}

function keyStatus(a: LocalAssessment): string {
  if (!a.key.verified) return 'Key not verified'
  if (a.sync === 'pending') return 'Key verified • uploading'
  if (a.sync === 'conflict' || a.sync === 'failed') return 'Key verified • upload issue'
  return a.key.version ? `Key v${a.key.version} verified` : 'Key verified'
}

function OcrDrawer() {
  const ws = useWorkspace()
  const beginScan = useStore((s) => s.beginScan)
  const navigate = useStore((s) => s.navigate)
  const urgent = ws.assessments.find((a) => a.urgent && awaitingFor(ws, a) > 0)
  const others = ws.assessments.filter((a) => a !== urgent).reverse()

  return (
    <div>
      {urgent && (
        <div className="mb-3 rounded-xl border-2 border-ink bg-white p-3 shadow-brut-sm">
          <Badge variant="urgent" mono>
            {urgent.due ?? 'Due today'}
          </Badge>
          <p className="mt-2 text-[15px] leading-tight font-bold">
            {urgent.title} - {awaitingFor(ws, urgent)} awaiting review
          </p>
          <p className="mt-0.5 text-xs text-subtle">
            {urgent.classLabel} • {urgent.key.questions.length} items
          </p>
          <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border-2 border-dashed border-ink/40 px-2.5 py-2">
            <span className="flex min-w-0 items-center gap-2 text-xs font-semibold">
              <KeyRound size={15} aria-hidden className="shrink-0" />
              <span className="truncate">{keyStatus(urgent)}</span>
            </span>
            <Badge variant="green" mono>
              Key ready
            </Badge>
          </div>
          <BrutalistButton variant="dark" className="mt-3 w-full" iconRight={ArrowRight} onClick={() => beginScan(urgent.id)}>
            Grade Now
          </BrutalistButton>
        </div>
      )}
      {others.length > 0 && <MonoLabel className="mb-1.5">{urgent ? 'Also in the queue' : 'Assessments'}</MonoLabel>}
      <ul className="space-y-2">
        {others.map((a) => {
          const left = awaitingFor(ws, a)
          const graded = ws.submissions.filter((s) => s.assessmentId === a.id).length
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => beginScan(a.id)}
                className="press flex w-full items-center gap-3 rounded-lg border-2 border-ink bg-white px-3 py-2 text-left shadow-brut-sm"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold">
                    {a.title} · {a.classLabel}
                  </span>
                  <MonoLabel className="mt-0.5 truncate text-subtle">
                    {a.roster.length ? (left ? `${left} awaiting • ${a.due ?? ''}` : 'All graded') : `${graded} graded • ${keyStatus(a)}`}
                  </MonoLabel>
                </span>
                <ChevronRight size={18} aria-hidden />
              </button>
            </li>
          )
        })}
      </ul>
      {!ws.assessments.length && (
        <div className="flex items-center gap-2.5 rounded-xl border-2 border-ink bg-white p-3 shadow-brut-sm">
          <CircleCheck size={20} aria-hidden className="shrink-0" />
          <p className="text-[13px] leading-snug font-semibold">No assessments yet. Add one with its answer key, then scan papers.</p>
        </div>
      )}
      <BrutalistButton variant="secondary" size="sm" className="mt-3 w-full" icon={Plus} onClick={() => navigate('key-editor')}>
        New assessment & answer key
      </BrutalistButton>
    </div>
  )
}

const QUICK: { mode: Mode; label: string; icon: LucideIcon }[] = [
  { mode: 'lesson', label: 'Lesson Plan', icon: BookOpen },
  { mode: 'rubric', label: 'Quiz Rubric', icon: ClipboardCheck },
  { mode: 'remedial', label: 'Remedial Worksheet', icon: LifeBuoy },
  { mode: 'quiz', label: 'Quiz Generator', icon: CircleHelp },
]

function AiDrawer() {
  const ws = useWorkspace()
  const setAiParams = useStore((s) => s.setAiParams)
  const setDraft = useStore((s) => s.setDraft)
  const navigate = useStore((s) => s.navigate)
  const now = useNow()

  return (
    <div>
      <MonoLabel className="mb-1.5">Quick start</MonoLabel>
      <div className="grid grid-cols-2 gap-2">
        {QUICK.map(({ mode, label, icon: Icon }) => (
          <button
            key={mode}
            type="button"
            onClick={() => {
              setAiParams({ mode })
              navigate('ai-params')
            }}
            className="press flex items-center gap-2 rounded-lg border-2 border-ink bg-white p-2.5 text-left shadow-brut-sm"
          >
            <Icon size={18} aria-hidden className="shrink-0" />
            <span className="text-[13px] leading-tight font-bold">{label}</span>
          </button>
        ))}
      </div>
      {ws.modules.length > 0 && <MonoLabel className="mt-3 mb-1.5">Recent modules</MonoLabel>}
      <ul className="space-y-2">
        {ws.modules.slice(0, 3).map((m) => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => {
                setDraft(m.draft)
                navigate('ai-draft')
              }}
              className="press flex w-full items-center gap-3 rounded-lg border-2 border-ink bg-white px-3 py-2 text-left shadow-brut-sm"
            >
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold">{m.draft.title}</span>
                <MonoLabel className="mt-0.5 text-subtle">
                  {gradeShort(levelOf(m.draft), m.draft.grade)} • {m.draft.origin === 'gemini' ? modeLabel(m.draft) : MODES[m.draft.mode].label} •{' '}
                  {relativeTime(m.savedISO, now)}
                </MonoLabel>
              </span>
              <ChevronRight size={18} aria-hidden />
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}

function ArchiveDrawer() {
  const ws = useWorkspace()
  const demo = useStore((s) => s.session?.mode === 'demo')
  const navigate = useStore((s) => s.navigate)
  const showToast = useStore((s) => s.showToast)
  const rows = recordRows(ws, demo)
  const labels = classLabels(ws, demo)

  return (
    <div>
      {labels.length ? (
        <ul className="space-y-2">
          {labels.map((label) => {
            const mine = rows.filter((r) => r.classLabel === label)
            const avg = classAverage(mine)
            return (
              <li key={label} className="flex items-center gap-3 rounded-lg border-2 border-ink bg-white px-3 py-2 shadow-brut-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold">{label}</span>
                  <MonoLabel className="mt-0.5 text-subtle">
                    {mine.length} {mine.length === 1 ? 'result' : 'results'} • avg {avg === null ? '—' : formatPercent(avg)}
                  </MonoLabel>
                </span>
                <BrutalistButton
                  size="sm"
                  variant="secondary"
                  icon={Download}
                  disabled={!mine.length}
                  aria-label={`Export ${label} gradebook as CSV`}
                  onClick={() => {
                    shareTextFile(gradebookFileName(label), 'text/csv', gradebookCsv(mine))
                    showToast(`Exported ${mine.length} grades • ${label}`)
                  }}
                >
                  CSV
                </BrutalistButton>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="rounded-lg border-2 border-dashed border-ink/40 p-3 text-[13px] text-ink/80">
          Approved results appear here, grouped by class.
        </p>
      )}
      {rows[0] && (
        <p className="mt-2 text-[12px] text-ink/80">
          Latest: <span className="font-bold">{rows[0].student}</span> • {displayScore(rows[0].finalScore)}/{displayScore(rows[0].possibleScore)}
        </p>
      )}
      <BrutalistButton variant="dark" className="mt-3 w-full" iconRight={ArrowRight} onClick={() => navigate('records')}>
        Open Records & Archive
      </BrutalistButton>
    </div>
  )
}

function Dock() {
  const ws = useWorkspace()
  const beginScan = useStore((s) => s.beginScan)
  const navigate = useStore((s) => s.navigate)
  const showToast = useStore((s) => s.showToast)
  return (
    <div
      role="group"
      aria-label="Quick actions"
      className="grid shrink-0 grid-cols-2 gap-3 border-t-2 border-ink bg-canvas px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] short:pt-2.5"
    >
      <DockButton
        tone="yellow"
        icon={Camera}
        title="Scan Assessment"
        sub="Instant OCR"
        onClick={() => {
          if (beginScan()) return
          navigate('key-editor')
          if (!ws.assessments.length) showToast('Add an assessment and its answer key first')
        }}
      />
      <DockButton tone="green" icon={Sparkles} title="AI Assistant" sub="Lesson & Rubric" onClick={() => navigate('ai-params')} />
    </div>
  )
}

function DockButton({ tone, icon, title, sub, onClick }: { tone: Tone; icon: LucideIcon; title: string; sub: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx('press flex flex-col items-start rounded-xl border-2 border-ink p-2.5 text-left shadow-brut', TONE_BG[tone])}
    >
      <span className="flex w-full items-start justify-between">
        <IconTile icon={icon} size={34} />
        <ArrowRight size={18} strokeWidth={2.5} aria-hidden className="mt-1" />
      </span>
      <span className="mt-2 block text-[15px] leading-tight font-extrabold short:mt-1.5">{title}</span>
      <MonoLabel className="mt-0.5 text-ink/80">{sub}</MonoLabel>
    </button>
  )
}
