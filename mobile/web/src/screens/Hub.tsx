import {
  ArrowRight,
  Bell,
  BellRing,
  BookOpen,
  CalendarDays,
  ChevronRight,
  CircleCheck,
  CircleHelp,
  ClipboardCheck,
  CloudUpload,
  FolderOpen,
  Info,
  KeyRound,
  LifeBuoy,
  Lightbulb,
  LogOut,
  Minus,
  Plus,
  RefreshCw,
  ScanLine,
  Settings2,
  ShieldAlert,
  Sparkles,
  Timer,
  TriangleAlert,
  UserRound,
  type LucideIcon,
} from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { Avatar } from '../components/Avatar'
import { ClassSheet } from '../components/ClassFields'
import { CollapsibleCategory } from '../components/CollapsibleCategory'
import { Peek, PeekRow, PeekTotal } from '../components/Peek'
import { BrandPill } from '../components/Logo'
import { Sheet } from '../components/Sheet'
import { SwipeRow } from '../components/SwipeRow'
import { Badge, BrutalistButton, BrutalistCard, IconButton, IconTile, MonoLabel, TONE_BG, cx, type Tone } from '../components/ui'
import { useBackHandler } from '../lib/back'
import { EVENT_TYPES, dayKey, eventsOn, timeLabel } from '../lib/calendar'
import { classLabel, groupByLevel, levelTone } from '../lib/classes'
import { dueLabel, greeting, relativeTime } from '../lib/format'
import { classAverage } from '../lib/gradebook'
import { formatPercent } from '../lib/grading'
import { MODES, type Mode } from '../lib/lessons'
import { LEVELS, gradeShort, levelOf } from '../lib/levels'
import { modeLabel } from '../lib/materials'
import { DEMO_TEACHER } from '../lib/mock'
import { recordRows } from '../lib/records'
import { MAX_SHORTCUTS, MIN_SHORTCUTS, formatClock, isRunning, remaining, timerTone, useSettings, type NotifKind, type ShortcutId } from '../lib/settings'
import { SHORTCUTS, SHORTCUT_ORDER } from '../lib/shortcuts'
import { useNow } from '../lib/useNow'
import type { LocalAssessment, Workspace } from '../lib/workspace'
import { awaitingFor, expectedPapers, isConnected, isUrgent, useStore, useWorkspace, type Connection, type HubPanel as Panel } from '../store'

interface Note {
  id: string
  kind: NotifKind
  icon: LucideIcon
  tone: Tone
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
  const urgent = pending.filter((a) => isUrgent(ws, a))
  const issues = ws.outbox.filter((o) => o.lastError)
  const results = recordRows(ws, demo)

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
            <>
              {issues.length > 0 && (
                <Peek title={`${issues.length} ${issues.length === 1 ? 'upload needs' : 'uploads need'} attention`} content={(close) => <IssuesPeek close={close} />}>
                  <Badge variant="urgent" pulse mono>
                    {issues.length} Sync {issues.length === 1 ? 'issue' : 'issues'}
                  </Badge>
                </Peek>
              )}
              {urgent.length > 0 && (
                <Peek title={`${urgent.length} due within a day`} content={(close) => <AssessmentPeek list={urgent} close={close} note="Due today, overdue, or flagged urgent. Tap one to start scanning." />}>
                  <Badge variant="urgent" pulse mono>
                    {urgent.length} Urgent
                  </Badge>
                </Peek>
              )}
              <Peek
                title={pending.length ? `${pending.length} ${pending.length === 1 ? 'assessment' : 'assessments'} with papers waiting` : `${ws.assessments.length} assessments`}
                content={(close) => <AssessmentPeek list={pending.length ? pending : ws.assessments} close={close} />}
              >
                <Badge>{pending.length ? `${pending.length} Pending` : ws.assessments.length ? `${ws.assessments.length} All graded` : 'No assessments'}</Badge>
              </Peek>
            </>
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
            <Peek title={`${ws.modules.length} saved ${ws.modules.length === 1 ? 'module' : 'modules'}`} content={(close) => <ModulesPeek close={close} />}>
              <Badge>
                {ws.modules.length} Modules • {demo ? 'Demo' : 'Gemini'}
              </Badge>
            </Peek>
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
            <Peek title={`${results.length} results in ${ws.classes.length} ${ws.classes.length === 1 ? 'section' : 'sections'}`} content={(close) => <RecordsPeek close={close} />}>
              <Badge>
                {ws.classes.length} {ws.classes.length === 1 ? 'Section' : 'Sections'} • {results.length} Results
              </Badge>
            </Peek>
          }
        >
          <ArchiveDrawer />
        </CollapsibleCategory>
      </main>
      <Dock />
    </div>
  )
}

const toneFor = (ws: Workspace, classId: string | null): Tone => levelTone(ws.classes.find((c) => c.id === classId)?.level ?? 'highschool')

function sectionName(ws: Workspace, a: LocalAssessment): string {
  const c = ws.classes.find((x) => x.id === a.classId)
  return c ? classLabel(c) : a.classLabel
}

function AssessmentPeek({ list, close, note }: { list: LocalAssessment[]; close: () => void; note?: string }) {
  const ws = useWorkspace()
  const beginScan = useStore((s) => s.beginScan)
  const papers = list.reduce((n, a) => n + awaitingFor(ws, a), 0)
  return (
    <>
      {list.map((a) => {
        const left = awaitingFor(ws, a)
        const graded = ws.submissions.filter((s) => s.assessmentId === a.id).length
        return (
          <PeekRow
            key={a.id}
            tone={toneFor(ws, a.classId)}
            title={a.title}
            detail={`${sectionName(ws, a)} • ${dueLabel(a.dueISO) ?? 'No due date'}`}
            count={left ? `${left} left` : `${graded} done`}
            onClick={
              a.key.questions.length
                ? () => {
                    close()
                    beginScan(a.id)
                  }
                : undefined
            }
          />
        )
      })}
      {!list.length && <p className="px-2 py-3 text-center text-[13px] text-subtle">No assessments yet.</p>}
      <PeekTotal>{note ?? (papers ? `${papers} ${papers === 1 ? 'paper' : 'papers'} still to grade. Tap one to start scanning.` : 'Every expected paper has a result.')}</PeekTotal>
    </>
  )
}

function IssuesPeek({ close }: { close: () => void }) {
  const ws = useWorkspace()
  const openRecords = useStore((s) => s.openRecords)
  const items = ws.outbox.filter((o) => o.lastError)
  return (
    <>
      {items.map((o) => (
        <PeekRow
          key={o.id}
          tone="coral"
          title={o.kind === 'assessment' ? o.payload.title : `${o.payload.submission.student_label}'s result`}
          detail={o.lastError}
          onClick={() => {
            close()
            openRecords(null, 'papers')
          }}
        />
      ))}
      <PeekTotal>Never retried automatically. Open one to retry, keep it as a new record, or stop uploading it.</PeekTotal>
    </>
  )
}

function ModulesPeek({ close }: { close: () => void }) {
  const ws = useWorkspace()
  const setDraft = useStore((s) => s.setDraft)
  const navigate = useStore((s) => s.navigate)
  const now = useNow()
  return (
    <>
      {ws.modules.map((m) => (
        <PeekRow
          key={m.id}
          tone={LEVELS[levelOf(m.draft)].tone}
          title={m.draft.title}
          detail={`${gradeShort(levelOf(m.draft), m.draft.grade)} • ${m.draft.origin === 'gemini' ? modeLabel(m.draft) : MODES[m.draft.mode].label} • ${relativeTime(m.savedISO, now)}`}
          onClick={() => {
            close()
            setDraft(m.draft)
            navigate('ai-draft')
          }}
        />
      ))}
      {!ws.modules.length && <p className="px-2 py-3 text-center text-[13px] text-subtle">No saved modules yet.</p>}
      <PeekTotal>
        {ws.modules.length > RECENT_MODULES ? `The menu shows the ${RECENT_MODULES} newest; all ${ws.modules.length} are in Records.` : 'Saved drafts and reviewed modules.'}
      </PeekTotal>
    </>
  )
}

function RecordsPeek({ close }: { close: () => void }) {
  const ws = useWorkspace()
  const demo = useStore((s) => s.session?.mode === 'demo')
  const openRecords = useStore((s) => s.openRecords)
  const rows = recordRows(ws, demo)
  const unassigned = rows.filter((r) => !r.classId || !ws.classes.some((c) => c.id === r.classId)).length
  return (
    <>
      {groupByLevel(ws.classes).flatMap((g) =>
        g.classes.map((c) => {
          const mine = rows.filter((r) => r.classId === c.id)
          const avg = classAverage(mine)
          return (
            <PeekRow
              key={c.id}
              tone={levelTone(c.level)}
              title={`${gradeShort(c.level, c.grade)} ${c.section} · ${c.subject}`}
              detail={`${c.students.length} students • avg ${avg === null ? '—' : formatPercent(avg)}`}
              count={String(mine.length)}
              onClick={() => {
                close()
                openRecords(c.id)
              }}
            />
          )
        }),
      )}
      {unassigned > 0 && <PeekRow tone="white" title="Not in a section" detail="Results whose section was removed or never set" count={String(unassigned)} />}
      <PeekTotal>
        {rows.length} {rows.length === 1 ? 'result' : 'results'} in total. The number on each row is that section's results.
      </PeekTotal>
    </>
  )
}

function useNotes(ws: Workspace, demo: boolean, connection: Connection): Note[] {
  const beginScan = useStore((s) => s.beginScan)
  const navigate = useStore((s) => s.navigate)
  const setMfaPrompt = useStore((s) => s.setMfaPrompt)
  const timers = useSettings((s) => s.timers)
  const prefs = useSettings((s) => s.notify)
  const now = useNow(15000)
  const notes: Note[] = []

  for (const t of timers.filter((x) => x.endsAt && x.endsAt <= now)) {
    notes.push({ id: `timer-${t.id}`, kind: 'timer', icon: Timer, tone: 'coral', title: `Time's up: ${t.label}`, body: 'The exam timer has finished.', time: 'Timer', run: () => navigate('timer') })
  }
  for (const a of ws.assessments) {
    if (!a.dueISO) continue
    const due = Date.parse(a.dueISO)
    const left = awaitingFor(ws, a)
    const graded = ws.submissions.filter((s) => s.assessmentId === a.id).length
    const expected = expectedPapers(ws, a)
    if (due - now > 86400000 || (expected && !left)) continue
    notes.push({
      id: `due-${a.id}`,
      kind: 'urgent',
      icon: TriangleAlert,
      tone: 'coral',
      title: `${a.title} ${(dueLabel(a.dueISO, new Date(now)) ?? '').replace(/^Due /, 'due ').toLowerCase()}`,
      body: expected ? `${left} ${left === 1 ? 'paper' : 'papers'} in ${a.classLabel} still to grade.` : `${graded} results so far for ${a.classLabel}.`,
      time: new Date(a.dueISO).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
      run: () => beginScan(a.id),
    })
  }
  for (const e of eventsOn(ws.events, dayKey(new Date(now))).filter((x) => Date.parse(x.startISO) + x.durationMin * 60000 > now)) {
    const cls = ws.classes.find((c) => c.id === e.classId)
    notes.push({
      id: `event-${e.id}`,
      kind: 'schedule',
      icon: CalendarDays,
      tone: EVENT_TYPES[e.type].tone,
      title: `${EVENT_TYPES[e.type].label}: ${e.title}`,
      body: `${timeLabel(e)}${cls ? ` • ${classLabel(cls)}` : ''}`,
      time: 'Today',
      run: () => navigate('calendar'),
    })
  }
  if (!demo) {
    if (connection === 'mfa_required') {
      notes.push({ id: 'mfa', kind: 'sync', icon: ShieldAlert, tone: 'yellow', title: 'Two-step verification needed', body: 'Verify to upload results and use online AI.', time: 'Now', run: () => setMfaPrompt(true) })
    }
    for (const item of ws.outbox.filter((o) => o.lastError)) {
      const label = item.kind === 'assessment' ? item.payload.title : `${item.payload.submission.student_label}'s result`
      notes.push({ id: `sync-${item.id}-${item.attempts}`, kind: 'sync', icon: CloudUpload, tone: 'coral', title: 'Upload needs attention', body: `${label}: ${item.lastError}`, time: 'Sync', run: () => useStore.getState().openRecords(null) })
    }
    const queued = ws.outbox.filter((o) => !o.lastError).length
    if (queued) {
      notes.push({ id: `queued-${queued}`, kind: 'sync', icon: CloudUpload, tone: 'yellow', title: `${queued} ${queued === 1 ? 'upload' : 'uploads'} queued`, body: 'They upload automatically next time you are online.', time: 'Sync' })
    }
  }
  for (const a of ws.assessments.filter((x) => !x.key.verified)) {
    notes.push({ id: `unverified-${a.id}`, kind: 'urgent', icon: KeyRound, tone: 'yellow', title: 'Answer key not verified', body: `${a.title}: results cannot be approved until its key is verified.`, time: 'Key' })
  }
  notes.push({ id: 'tip-peek', kind: 'tips', icon: Lightbulb, tone: 'yellow', title: 'Peek behind the numbers', body: 'Press and hold a badge like "3 Pending" to see what it counts.', time: 'Tip' })
  notes.push({ id: 'tip-dock', kind: 'tips', icon: Lightbulb, tone: 'green', title: 'Make the bottom buttons yours', body: 'Press and hold them to add, swap or remove shortcuts (1 to 3).', time: 'Tip' })
  if (demo) {
    notes.push({ id: 'n-demo', kind: 'tips', icon: Info, tone: 'blue', title: 'Demo workspace', body: 'Recognition and lesson drafts here are simulated and never leave this device.', time: 'Demo' })
  }
  return notes.filter((n) => prefs[n.kind] && !ws.dismissedNotifications.includes(n.id))
}

function ClockChip() {
  const timers = useSettings((s) => s.timers)
  const navigate = useStore((s) => s.navigate)
  const now = useNow(1000)
  const running = timers.filter((t) => isRunning(t, now)).sort((a, b) => remaining(a, now) - remaining(b, now))[0]
  const tone = running ? timerTone(running, now) : null
  const urgent = running && remaining(running, now) < 60000
  return (
    <button
      type="button"
      onClick={() => navigate('timer')}
      aria-label={running ? `${running.label}: ${formatClock(remaining(running, now))} left. Open exam timers` : 'Current time. Open exam timers'}
      className={cx(
        'press flex h-6 items-center gap-1 rounded-full border-2 border-ink px-1.5 font-mono text-[10.5px] leading-none font-bold',
        tone ? TONE_BG[tone] : 'bg-surface',
        urgent && 'animate-pulse',
      )}
    >
      {running && <Timer size={11} strokeWidth={3} aria-hidden />}
      {running ? formatClock(remaining(running, now)) : new Date(now).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
    </button>
  )
}

const MENU: { screen: 'account' | 'settings' | 'notif-settings' | 'help' | 'about'; label: string; hint: string; icon: LucideIcon }[] = [
  { screen: 'account', label: 'Account settings', hint: 'Profile, school and classes', icon: UserRound },
  { screen: 'settings', label: 'System settings', hint: 'Theme, scanner, storage', icon: Settings2 },
  { screen: 'notif-settings', label: 'Notification preferences', hint: 'What shows in the bell', icon: BellRing },
  { screen: 'help', label: 'Help & support', hint: 'Guides and feedback', icon: LifeBuoy },
  { screen: 'about', label: 'About GabAI', hint: 'Version and server', icon: Info },
]

function TopBar() {
  const [menu, setMenu] = useState<'notifications' | 'profile' | null>(null)
  useBackHandler(menu !== null, () => setMenu(null))
  const ws = useWorkspace()
  const session = useStore((s) => s.session)
  const connection = useStore((s) => s.connection)
  const markRead = useStore((s) => s.markNotificationsRead)
  const dismiss = useStore((s) => s.dismissNotifications)
  const navigate = useStore((s) => s.navigate)
  const signOut = useStore((s) => s.signOut)
  const demo = session?.mode === 'demo'
  const notes = useNotes(ws, demo, connection)
  const unread = notes.filter((n) => !ws.readNotifications.includes(n.id)).length
  const name = ws.profile?.fullName || (demo ? DEMO_TEACHER.display : ws.displayName)
  const email = isConnected(session) ? session.email : DEMO_TEACHER.email

  return (
    <header className="relative z-30 flex shrink-0 items-center justify-between px-4 pt-3 pb-3 short:pb-2">
      <BrandPill>
        <ClockChip />
      </BrandPill>
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
          className="press rounded-full shadow-brut-sm"
        >
          <Avatar name={name} spec={ws.profile?.avatar} size={40} />
        </button>
      </div>

      {menu && (
        <>
          <button type="button" aria-label="Close menu" className="fixed inset-0 z-10 cursor-default bg-black/10" onClick={() => setMenu(null)} />
          <BrutalistCard shadow="lg" className="absolute top-[58px] right-4 z-20 w-[min(330px,calc(100%-32px))] animate-toast-in p-3">
            {menu === 'notifications' ? (
              <>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <h2 className="text-[15px] font-bold">Notifications</h2>
                  <div className="flex gap-1">
                    <button
                      type="button"
                      disabled={!unread}
                      onClick={() => markRead(notes.map((n) => n.id))}
                      className="rounded-md px-1.5 py-1 text-xs font-bold underline underline-offset-2 disabled:no-underline disabled:opacity-40"
                    >
                      Mark read
                    </button>
                    <button
                      type="button"
                      disabled={!notes.length}
                      onClick={() => dismiss(notes.map((n) => n.id))}
                      className="rounded-md border-2 border-ink bg-coral px-2 py-0.5 text-xs font-bold disabled:opacity-40"
                    >
                      Clear all
                    </button>
                  </div>
                </div>
                {notes.length ? (
                  <>
                    <ul className="max-h-[56vh] space-y-2 overflow-x-hidden overflow-y-auto">
                      {notes.map((n) => {
                        const isUnread = !ws.readNotifications.includes(n.id)
                        return (
                          <li key={n.id}>
                            <SwipeRow label={`${n.title}. Swipe to dismiss`} onDismiss={() => dismiss([n.id])}>
                              <button
                                type="button"
                                onClick={() => {
                                  markRead([n.id])
                                  if (n.run) {
                                    setMenu(null)
                                    n.run()
                                  }
                                }}
                                className={cx('flex w-full items-start gap-2.5 rounded-lg border-2 border-ink p-2.5 text-left', isUnread ? 'bg-canvas' : 'bg-surface')}
                              >
                                <IconTile icon={n.icon} tone={n.tone} size={32} />
                                <span className="min-w-0 flex-1">
                                  <span className="flex items-center gap-1.5 text-[13px] font-bold">
                                    <span className="truncate">{n.title}</span>
                                    {isUnread && <span className="size-2 shrink-0 rounded-full bg-coral ring-1 ring-ink" aria-label="unread" />}
                                  </span>
                                  <span className="block text-xs leading-snug text-subtle">{n.body}</span>
                                </span>
                                <span className="shrink-0 font-mono text-[10px] text-subtle">{n.time}</span>
                              </button>
                            </SwipeRow>
                          </li>
                        )
                      })}
                    </ul>
                    <MonoLabel className="mt-2 text-center text-subtle">Swipe a notification sideways to remove it</MonoLabel>
                  </>
                ) : (
                  <p className="rounded-lg border-2 border-dashed border-ink/30 p-4 text-center text-[13px] text-subtle">You're all caught up.</p>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center gap-3">
                  <Avatar name={name} spec={ws.profile?.avatar} size={48} />
                  <div className="min-w-0">
                    <p className="truncate font-bold">{name}</p>
                    {ws.profile?.school && <p className="truncate text-xs font-semibold">{ws.profile.school}</p>}
                    <p className="truncate text-xs text-subtle">{email}</p>
                  </div>
                </div>
                <ul className="mt-3 space-y-1.5">
                  {MENU.map((item) => (
                    <li key={item.screen}>
                      <button
                        type="button"
                        onClick={() => {
                          setMenu(null)
                          navigate(item.screen)
                        }}
                        className="press flex w-full items-center gap-2.5 rounded-lg border-2 border-ink bg-surface px-2.5 py-2 text-left shadow-brut-sm"
                      >
                        <item.icon size={18} aria-hidden className="shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-[13px] leading-tight font-bold">{item.label}</span>
                          <span className="block text-[11px] text-subtle">{item.hint}</span>
                        </span>
                        <ChevronRight size={16} aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
                <BrutalistButton size="sm" variant="alert" icon={LogOut} className="mt-2.5 w-full" onClick={() => void signOut()}>
                  {demo ? 'Exit demo' : 'Log out'}
                </BrutalistButton>
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
  const navigate = useStore((s) => s.navigate)
  const showToast = useStore((s) => s.showToast)
  const [demoSyncing, setDemoSyncing] = useState(false)
  const now = useNow()
  const today = new Date(now)
  const papers = ws.assessments.reduce((s, a) => s + awaitingFor(ws, a), 0)
  const queued = ws.outbox.filter((o) => !o.lastError).length
  const stuck = ws.outbox.length - queued
  const busy = syncing || demoSyncing
  const first = (ws.profile?.fullName || ws.displayName).split(/\s+/)[0]
  const name = first ? `Teacher ${first}` : demo ? DEMO_TEACHER.display : 'Teacher'
  const todays = eventsOn(ws.events, dayKey(today))
  const next = todays.find((e) => Date.parse(e.startISO) + e.durationMin * 60000 > now)

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

  return (
    <BrutalistCard className="p-4 short:p-3">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => navigate('calendar')}
          aria-label="Open schedule"
          className="press inline-flex min-w-0 items-center gap-1.5 rounded-lg border-2 border-ink bg-surface px-2 py-[3px] text-[11px] leading-none font-bold shadow-brut-sm"
        >
          <CalendarDays size={12} strokeWidth={2.5} aria-hidden className="shrink-0" />
          <span className="truncate">
            {next ? `${timeLabel(next)} • ${next.title}` : todays.length ? 'Done for today' : 'Nothing scheduled today'}
          </span>
          {todays.length > 0 && <span className="shrink-0 rounded-full bg-coral px-1.5 py-px text-[10px]">{todays.length}</span>}
        </button>
        <span className="shrink-0 font-mono text-[11px] font-bold tracking-wide">
          {today.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()}
        </span>
      </div>
      <h1 className="mt-3 text-[22px] leading-[1.15] font-extrabold tracking-tight max-[380px]:text-[19px] short:mt-2 short:text-[20px]">
        {greeting(today)}, {name}
      </h1>
      <div className="mt-2.5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[13px] leading-snug">
            {demo ? (
              <>
                <span className="font-bold">
                  {papers} {papers === 1 ? 'paper' : 'papers'}
                </span>{' '}
                still to grade
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
            ) : papers ? (
              <>
                <span className="font-bold">
                  {papers} {papers === 1 ? 'paper' : 'papers'}
                </span>{' '}
                still to grade
              </>
            ) : ws.assessments.length ? (
              <>All results are uploaded</>
            ) : (
              <>Create an assessment to start grading</>
            )}
          </p>
          <MonoLabel className="mt-1 text-subtle">
            {busy ? 'Syncing…' : demo ? `Saved ${relativeTime(ws.lastSyncedISO, now)}` : `${connection === 'offline' ? 'Offline • ' : ''}Synced ${relativeTime(ws.lastSyncedISO, now)}`}
          </MonoLabel>
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
  const urgent = ws.assessments.find((a) => isUrgent(ws, a))
  const others = ws.assessments.filter((a) => a !== urgent).reverse()
  const waiting = others.filter((a) => awaitingFor(ws, a) > 0)
  const finished = others.filter((a) => !awaitingFor(ws, a))

  return (
    <div>
      {urgent && (
        <div className="mb-3 rounded-xl border-2 border-ink bg-surface p-3 shadow-brut-sm">
          <Badge variant="urgent" mono>
            {dueLabel(urgent.dueISO) ?? 'Due soon'}
          </Badge>
          <p className="mt-2 text-[15px] leading-tight font-bold">
            {urgent.title} - {awaitingFor(ws, urgent)} still to grade
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
      {waiting.length > 0 && (
        <MonoLabel className="mb-1.5">
          {urgent ? 'Also waiting' : 'Waiting to grade'} • {waiting.length}
        </MonoLabel>
      )}
      <AssessmentList list={waiting} />
      {finished.length > 0 && (
        <MonoLabel className={cx('mb-1.5', waiting.length > 0 && 'mt-3')}>
          {ws.classes.length ? 'All graded' : 'Assessments'} • {finished.length}
        </MonoLabel>
      )}
      <AssessmentList list={finished} />
      {!ws.assessments.length && (
        <div className="flex items-center gap-2.5 rounded-xl border-2 border-ink bg-surface p-3 shadow-brut-sm">
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

function AssessmentList({ list }: { list: LocalAssessment[] }) {
  const ws = useWorkspace()
  const beginScan = useStore((s) => s.beginScan)
  if (!list.length) return null
  return (
    <ul className="space-y-2">
      {list.map((a) => {
        const left = awaitingFor(ws, a)
        const graded = ws.submissions.filter((s) => s.assessmentId === a.id).length
        return (
          <li key={a.id}>
            <button
              type="button"
              onClick={() => beginScan(a.id)}
              className="press flex w-full items-center gap-3 rounded-lg border-2 border-ink bg-surface px-3 py-2 text-left shadow-brut-sm"
            >
              <span className={cx('h-8 w-1.5 shrink-0 rounded-full border border-ink', TONE_BG[toneFor(ws, a.classId)])} aria-hidden />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold">
                  {a.title} · {sectionName(ws, a)}
                </span>
                <MonoLabel className="mt-0.5 truncate text-subtle">
                  {left ? `${left} still to grade${a.dueISO ? ` • ${dueLabel(a.dueISO)}` : ''}` : `${graded} graded • ${keyStatus(a)}`}
                </MonoLabel>
              </span>
              <ChevronRight size={18} aria-hidden />
            </button>
          </li>
        )
      })}
    </ul>
  )
}

/** How many saved modules the AI menu lists before pointing to Records. */
const RECENT_MODULES = 3

const QUICK: { mode: Mode; label: string; icon: LucideIcon }[] = [
  { mode: 'lesson', label: 'Lesson Plan', icon: BookOpen },
  { mode: 'rubric', label: 'Quiz Rubric', icon: ClipboardCheck },
  { mode: 'remedial', label: 'Remedial Worksheet', icon: LifeBuoy },
  { mode: 'quiz', label: 'Quiz Generator', icon: CircleHelp },
]

function AiDrawer() {
  const ws = useWorkspace()
  const openRecords = useStore((s) => s.openRecords)
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
            className="press flex items-center gap-2 rounded-lg border-2 border-ink bg-surface p-2.5 text-left shadow-brut-sm"
          >
            <Icon size={18} aria-hidden className="shrink-0" />
            <span className="text-[13px] leading-tight font-bold">{label}</span>
          </button>
        ))}
      </div>
      {ws.modules.length > 0 && (
        <MonoLabel className="mt-3 mb-1.5">
          {ws.modules.length > RECENT_MODULES ? `Newest ${RECENT_MODULES} of ${ws.modules.length} modules` : `Saved modules • ${ws.modules.length}`}
        </MonoLabel>
      )}
      <ul className="space-y-2">
        {ws.modules.slice(0, RECENT_MODULES).map((m) => (
          <li key={m.id}>
            <button
              type="button"
              onClick={() => {
                setDraft(m.draft)
                navigate('ai-draft')
              }}
              className="press flex w-full items-center gap-3 rounded-lg border-2 border-ink bg-surface px-3 py-2 text-left shadow-brut-sm"
            >
              <span className={cx('h-8 w-1.5 shrink-0 rounded-full border border-ink', TONE_BG[LEVELS[levelOf(m.draft)].tone])} aria-hidden />
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
      {ws.modules.length > RECENT_MODULES && (
        <BrutalistButton variant="secondary" size="sm" className="mt-2 w-full" iconRight={ArrowRight} onClick={() => openRecords(null, 'modules')}>
          See all {ws.modules.length} modules
        </BrutalistButton>
      )}
    </div>
  )
}

function ArchiveDrawer() {
  const ws = useWorkspace()
  const demo = useStore((s) => s.session?.mode === 'demo')
  const openRecords = useStore((s) => s.openRecords)
  const upsertClass = useStore((s) => s.upsertClass)
  const showToast = useStore((s) => s.showToast)
  const [adding, setAdding] = useState(false)
  const rows = recordRows(ws, demo)
  const groups = groupByLevel(ws.classes)

  return (
    <div>
      {groups.length ? (
        <div className="space-y-3">
          {groups.map((g) => (
            <section key={g.level} aria-label={LEVELS[g.level].label}>
              <div className="mb-1.5 flex items-center gap-2">
                <span className={cx('rounded-md border-2 border-ink px-1.5 py-px font-mono text-[10px] font-bold uppercase', TONE_BG[levelTone(g.level)])}>
                  {LEVELS[g.level].label}
                </span>
                <MonoLabel className="text-ink/80">
                  {g.classes.length} {g.classes.length === 1 ? 'section' : 'sections'}
                </MonoLabel>
              </div>
              <ul className="space-y-1.5">
                {g.classes.map((c) => {
                  const mine = rows.filter((r) => r.classId === c.id)
                  const avg = classAverage(mine)
                  return (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => openRecords(c.id)}
                        className="press flex w-full items-center gap-3 rounded-lg border-2 border-ink bg-surface px-3 py-2 text-left shadow-brut-sm"
                      >
                        <span className={cx('flex size-8 shrink-0 items-center justify-center rounded-md border-2 border-ink font-mono text-[10px] font-bold', TONE_BG[levelTone(c.level)])}>
                          {gradeShort(c.level, c.grade)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-bold">
                            {c.section} · {c.subject}
                          </span>
                          <MonoLabel className="mt-0.5 text-subtle">
                            {c.students.length} students • avg {avg === null ? '—' : formatPercent(avg)} • {mine.length} results
                          </MonoLabel>
                        </span>
                        <ChevronRight size={18} aria-hidden />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      ) : (
        <p className="rounded-lg border-2 border-dashed border-ink/40 p-3 text-[13px] text-ink/80">
          Add the sections you handle to see their records here.
        </p>
      )}
      <div className="mt-3 grid grid-cols-[auto_1fr] gap-2">
        <BrutalistButton variant="secondary" icon={Plus} aria-label="Add a section" onClick={() => setAdding(true)} />
        <BrutalistButton variant="dark" iconRight={ArrowRight} onClick={() => openRecords(null)}>
          Open Records & Archive
        </BrutalistButton>
      </div>
      {adding && (
        <ClassSheet
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

/** Bottom shortcuts: 1–3 buttons, press and hold to edit. */
function Dock() {
  const dock = useSettings((s) => s.dock)
  const setDock = useSettings((s) => s.setDock)
  const ws = useWorkspace()
  const beginScan = useStore((s) => s.beginScan)
  const navigate = useStore((s) => s.navigate)
  const openRecords = useStore((s) => s.openRecords)
  const showToast = useStore((s) => s.showToast)
  const [editing, setEditing] = useState(false)
  const [picking, setPicking] = useState(false)
  const hold = useRef<number | null>(null)
  useBackHandler(editing && !picking, () => setEditing(false))

  function run(id: ShortcutId) {
    if (id === 'scan') {
      if (beginScan()) return
      navigate('key-editor')
      if (!ws.assessments.length) showToast('Add an assessment and its answer key first')
    } else if (id === 'ai') navigate('ai-params')
    else if (id === 'timer') navigate('timer')
    else if (id === 'calendar') navigate('calendar')
    else if (id === 'records') openRecords(null)
    else navigate('key-editor')
  }

  const startHold = () => {
    hold.current = window.setTimeout(() => {
      hold.current = null
      setEditing(true)
      navigator.vibrate?.(30)
    }, 450)
  }
  const endHold = () => {
    if (hold.current) clearTimeout(hold.current)
    hold.current = null
  }

  const cols = dock.length + (editing && dock.length < MAX_SHORTCUTS ? 1 : 0) >= 3 ? 3 : dock.length === 1 && !editing ? 1 : 2
  return (
    <div
      role="group"
      aria-label="Quick actions. Press and hold to customise."
      className="relative shrink-0 border-t-2 border-ink bg-canvas px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))] short:pt-2.5"
      onPointerDown={editing ? undefined : startHold}
      onPointerUp={endHold}
      onPointerLeave={endHold}
      onPointerCancel={endHold}
      onContextMenu={(e) => e.preventDefault()}
    >
      {editing && (
        <div className="mb-2 flex items-center justify-between gap-2">
          <MonoLabel className="text-subtle">
            Edit shortcuts • {dock.length}/{MAX_SHORTCUTS}
          </MonoLabel>
          <BrutalistButton size="sm" variant="dark" onClick={() => setEditing(false)}>
            Done
          </BrutalistButton>
        </div>
      )}
      <div className={cx('grid gap-3', cols === 3 ? 'grid-cols-3' : cols === 1 ? 'grid-cols-1' : 'grid-cols-2')}>
        {dock.map((id) => {
          const s = SHORTCUTS[id]
          return (
            <div key={id} className="relative">
              <button
                type="button"
                onClick={() => (editing ? undefined : run(id))}
                className={cx(
                  'press flex w-full flex-col items-start rounded-xl border-2 border-ink p-2.5 text-left shadow-brut',
                  TONE_BG[s.tone],
                  editing && 'animate-pulse',
                )}
              >
                <span className="flex w-full items-start justify-between">
                  <IconTile icon={s.icon} size={34} />
                  {cols < 3 && <ArrowRight size={18} strokeWidth={2.5} aria-hidden className="mt-1" />}
                </span>
                <span className={cx('mt-2 block max-w-full leading-tight font-extrabold short:mt-1.5', cols >= 3 ? 'text-[13px]' : 'text-[15px]')}>{s.title}</span>
                <MonoLabel className="mt-0.5 max-w-full truncate opacity-80">{s.sub}</MonoLabel>
              </button>
              {editing && (
                <button
                  type="button"
                  aria-label={`Remove ${s.title}`}
                  disabled={dock.length <= MIN_SHORTCUTS}
                  onClick={() => setDock(dock.filter((x) => x !== id))}
                  className="absolute -top-2 -right-2 flex size-7 items-center justify-center rounded-full border-2 border-ink bg-coral shadow-brut-sm disabled:opacity-40"
                >
                  <Minus size={14} strokeWidth={3} />
                </button>
              )}
            </div>
          )
        })}
        {editing && dock.length < MAX_SHORTCUTS && (
          <button
            type="button"
            onClick={() => setPicking(true)}
            className="flex min-h-[92px] flex-col items-center justify-center gap-1 rounded-xl border-2 border-dashed border-ink bg-surface text-[13px] font-bold"
          >
            <Plus size={20} aria-hidden /> Add
          </button>
        )}
      </div>
      {picking && (
        <Sheet title="Add a shortcut" subtitle={`Up to ${MAX_SHORTCUTS} on the Hub`} onClose={() => setPicking(false)}>
          <ul className="space-y-2">
            {SHORTCUT_ORDER.filter((id) => !dock.includes(id)).map((id) => {
              const s = SHORTCUTS[id]
              return (
                <li key={id}>
                  <button
                    type="button"
                    onClick={() => {
                      setDock([...dock, id])
                      setPicking(false)
                    }}
                    className="press flex w-full items-center gap-3 rounded-lg border-2 border-ink bg-surface px-3 py-2.5 text-left shadow-brut-sm"
                  >
                    <IconTile icon={s.icon} tone={s.tone} size={36} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14px] font-bold">{s.title}</span>
                      <span className="block text-xs text-subtle">{s.sub}</span>
                    </span>
                    <Plus size={18} aria-hidden />
                  </button>
                </li>
              )
            })}
          </ul>
        </Sheet>
      )}
    </div>
  )
}
