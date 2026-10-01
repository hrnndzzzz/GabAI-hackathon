import { ChevronDown, ChevronRight, ExternalLink, LoaderCircle, MessageSquareText, Plus, RotateCcw, Server, ShieldCheck } from 'lucide-react'
import { useEffect, useState, type ReactNode } from 'react'
import { AvatarEditor } from '../components/AvatarEditor'
import { ClassSheet } from '../components/ClassFields'
import { ScreenHeader } from '../components/FlowHeader'
import { LogoMark } from '../components/Logo'
import { Sheet } from '../components/Sheet'
import { BrutalistButton, BrutalistCard, MonoLabel, SectionTitle, Switch, TONE_BG, cx } from '../components/ui'
import { api, describeError, serverHealth } from '../lib/api'
import { defaultAvatar } from '../lib/avatar'
import { classLabel, groupByLevel, levelTone, type TeacherClass } from '../lib/classes'
import { getConfig } from '../lib/config'
import { FORMATS, type ExportFormat } from '../lib/lessons'
import { LEVELS, gradeShort } from '../lib/levels'
import { DEMO_TEACHER } from '../lib/mock'
import { shareTextFile } from '../lib/native'
import { useSettings, type NotifKind, type PhotoAccess, type ThemePref } from '../lib/settings'
import { SHORTCUTS } from '../lib/shortcuts'
import { isConnected, useStore, useWorkspace } from '../store'

export const APP_VERSION = '1.2.0'

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid rounded-lg border-2 border-ink bg-surface p-1" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx('h-8 rounded-md text-[12.5px] font-bold', value === o.value ? 'bg-ink text-surface' : '')}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Row({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] leading-tight font-bold">{title}</p>
        {hint && <p className="mt-0.5 text-xs leading-snug text-subtle">{hint}</p>}
      </div>
      {children}
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section>
      <SectionTitle>{title}</SectionTitle>
      <BrutalistCard shadow="sm" className="divide-y-2 divide-ink/10">
        {children}
      </BrutalistCard>
    </section>
  )
}

/* ---------- A1. Account settings ---------- */

export function AccountSettings() {
  const ws = useWorkspace()
  const session = useStore((s) => s.session)
  const updateProfile = useStore((s) => s.updateProfile)
  const upsertClass = useStore((s) => s.upsertClass)
  const removeClass = useStore((s) => s.removeClass)
  const showToast = useStore((s) => s.showToast)
  const demo = session?.mode === 'demo'
  const start = ws.profile ?? { fullName: demo ? `${DEMO_TEACHER.firstName} ${DEMO_TEACHER.lastName}` : ws.displayName, school: '', avatar: defaultAvatar(ws.displayName) }
  const [fullName, setFullName] = useState(start.fullName)
  const [school, setSchool] = useState(start.school)
  const [avatar, setAvatar] = useState(start.avatar)
  const [editingClass, setEditingClass] = useState<TeacherClass | 'new' | null>(null)
  const [saving, setSaving] = useState(false)
  const dirty = fullName !== start.fullName || school !== start.school || JSON.stringify(avatar) !== JSON.stringify(start.avatar)

  async function save() {
    setSaving(true)
    updateProfile({ fullName: fullName.trim(), school: school.trim(), avatar })
    // The backend profile currently stores only the display name (PUT /v1/me).
    if (isConnected(session)) {
      try {
        await api.updateMe(fullName.trim())
      } catch (error) {
        showToast(`Saved on this phone. Server: ${describeError(error)}`)
        setSaving(false)
        return
      }
    }
    setSaving(false)
    showToast('Profile saved')
  }

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader label="Account" title="Account settings" tone="blue" />
      <main className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <BrutalistCard className="p-4">
          <AvatarEditor name={fullName} value={avatar} onChange={setAvatar} />
        </BrutalistCard>

        <Group title="Profile">
          <div className="space-y-3 p-3">
            <TextField label="Full name" value={fullName} onChange={setFullName} placeholder="e.g. Elena Santos" />
            <TextField label="School" value={school} onChange={setSchool} placeholder="e.g. Rizal Integrated School" />
            <div>
              <span className="mb-1 block text-[13px] font-bold">Email</span>
              <p className="flex h-11 items-center rounded-lg border-2 border-dashed border-ink/40 px-3 text-[14px] text-subtle">
                {isConnected(session) ? session.email : DEMO_TEACHER.email}
              </p>
            </div>
          </div>
        </Group>

        <section>
          <SectionTitle aside={<MonoLabel className="text-subtle">{ws.classes.length} sections</MonoLabel>}>Classes I handle</SectionTitle>
          <div className="space-y-3">
            {groupByLevel(ws.classes).map((g) => (
              <div key={g.level}>
                <span className={cx('mb-1.5 inline-block rounded-md border-2 border-ink px-1.5 py-px font-mono text-[10px] font-bold uppercase', TONE_BG[levelTone(g.level)])}>
                  {LEVELS[g.level].label}
                </span>
                <ul className="space-y-1.5">
                  {g.classes.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        onClick={() => setEditingClass(c)}
                        className="press flex w-full items-center gap-3 rounded-lg border-2 border-ink bg-surface px-3 py-2 text-left shadow-brut-sm"
                      >
                        <span className={cx('flex size-8 shrink-0 items-center justify-center rounded-md border-2 border-ink font-mono text-[10px] font-bold', TONE_BG[levelTone(c.level)])}>
                          {gradeShort(c.level, c.grade)}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-bold">
                            {c.section} · {c.subject}
                          </span>
                          <MonoLabel className="text-subtle">{c.students.length} students</MonoLabel>
                        </span>
                        <ChevronRight size={16} aria-hidden />
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <BrutalistButton variant="secondary" size="sm" icon={Plus} className="w-full" onClick={() => setEditingClass('new')}>
              Add a section
            </BrutalistButton>
          </div>
        </section>
      </main>
      <footer className="shrink-0 border-t-2 border-ink bg-canvas px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <BrutalistButton size="lg" variant="primary" className="w-full" disabled={!dirty || !fullName.trim() || saving} onClick={() => void save()}>
          {saving ? 'Saving…' : dirty ? 'Save profile' : 'Saved'}
        </BrutalistButton>
      </footer>
      {editingClass && (
        <ClassSheet
          initial={editingClass === 'new' ? undefined : editingClass}
          onClose={() => setEditingClass(null)}
          onDelete={
            editingClass === 'new'
              ? undefined
              : () => {
                  removeClass(editingClass.id)
                  setEditingClass(null)
                  showToast(`Removed ${classLabel(editingClass)}. Its results are kept.`)
                }
          }
          onSave={(c) => {
            upsertClass(c)
            setEditingClass(null)
            showToast(`Saved ${classLabel(c)}`)
          }}
        />
      )}
    </div>
  )
}

function TextField({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-bold">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={120}
        className="h-11 w-full rounded-lg border-2 border-ink bg-surface px-3 text-[15px] font-semibold outline-none focus:shadow-brut"
      />
    </label>
  )
}

/* ---------- A2. System settings ---------- */

export function SystemSettings() {
  const settings = useSettings()
  const ws = useWorkspace()
  const demo = useStore((s) => s.session?.mode === 'demo')
  const setLocalSync = useStore((s) => s.setLocalSync)
  const resetDemo = useStore((s) => s.resetDemo)
  const showToast = useStore((s) => s.showToast)
  const [confirmReset, setConfirmReset] = useState(false)

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader label="Settings" title="System settings" tone="blue" />
      <main className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <Group title="Appearance">
          <div className="space-y-2 p-3">
            <p className="text-[13.5px] font-bold">Theme</p>
            <Segmented<ThemePref>
              label="Theme"
              value={settings.theme}
              onChange={(theme) => settings.update({ theme })}
              options={[
                { value: 'light', label: 'Light' },
                { value: 'dark', label: 'Dark' },
                { value: 'system', label: 'System' },
              ]}
            />
          </div>
          <Row title="Reduce motion" hint="Turn off sliding, pulsing and scanning animations.">
            <Switch checked={settings.reduceMotion} label="Reduce motion" onChange={(on) => settings.update({ reduceMotion: on })} />
          </Row>
        </Group>

        <Group title="Scanner">
          <div className="space-y-2 p-3">
            <p className="text-[13.5px] font-bold">Default paper size</p>
            <Segmented label="Default paper size" value={settings.paperSize} onChange={(paperSize) => settings.update({ paperSize })} options={[{ value: 'A4', label: 'A4' }, { value: 'Letter', label: 'Letter' }]} />
          </div>
          <div className="space-y-2 p-3">
            <p className="text-[13.5px] font-bold">Photo gallery access</p>
            <Segmented<PhotoAccess>
              label="Photo gallery access"
              value={settings.photoAccess === 'allowed' ? 'allowed' : 'ask'}
              onChange={(photoAccess) => settings.update({ photoAccess })}
              options={[
                { value: 'ask', label: 'Ask first' },
                { value: 'allowed', label: 'Allowed' },
              ]}
            />
            <p className="text-xs text-subtle">GabAI only receives the one photo you pick. "Ask first" shows a permission prompt before the gallery opens.</p>
          </div>
        </Group>

        <Group title="AI drafts">
          <div className="space-y-2 p-3">
            <p className="text-[13.5px] font-bold">Default export</p>
            <Segmented<ExportFormat>
              label="Default export"
              value={settings.defaultFormat}
              onChange={(defaultFormat) => {
                settings.update({ defaultFormat })
                useStore.getState().setAiParams({ format: defaultFormat })
              }}
              options={(Object.keys(FORMATS) as ExportFormat[]).map((f) => ({ value: f, label: f === 'pdf' ? 'PDF' : f === 'markdown' ? 'Markdown' : 'CSV' }))}
            />
          </div>
        </Group>

        <Group title="Hub shortcuts">
          <Row title={settings.dock.map((id) => SHORTCUTS[id].title).join(' • ')} hint="Press and hold the buttons at the bottom of the Hub to add, swap or remove them (1–3).">
            <span />
          </Row>
        </Group>

        <Group title="Storage">
          <Row title="Local Storage Sync" hint={ws.localSync ? 'Everything is cached on this phone.' : 'Paused: new results stay in memory until you turn this back on.'}>
            <Switch checked={ws.localSync} label="Local Storage Sync" onChange={setLocalSync} />
          </Row>
          {demo && (
            <Row title="Reset demo data" hint="Put the sample classes, results and schedule back to the start.">
              <BrutalistButton size="sm" variant="secondary" icon={RotateCcw} onClick={() => setConfirmReset(true)}>
                Reset
              </BrutalistButton>
            </Row>
          )}
        </Group>
      </main>
      {confirmReset && (
        <Sheet
          title="Reset the demo?"
          onClose={() => setConfirmReset(false)}
          footer={
            <div className="grid grid-cols-2 gap-2.5">
              <BrutalistButton variant="secondary" onClick={() => setConfirmReset(false)}>
                Keep
              </BrutalistButton>
              <BrutalistButton
                variant="alert"
                onClick={() => {
                  resetDemo()
                  showToast('Demo data reset')
                }}
              >
                Reset demo
              </BrutalistButton>
            </div>
          }
        >
          <p className="text-[13.5px] leading-snug">Papers you graded in the demo and any demo edits will be cleared. Your own account is not affected.</p>
        </Sheet>
      )}
    </div>
  )
}

/* ---------- A3. Notification preferences ---------- */

const NOTIFY: { kind: NotifKind; title: string; hint: string }[] = [
  { kind: 'urgent', title: 'Due dates and answer keys', hint: 'Assessments due within a day, and keys that still need verifying.' },
  { kind: 'timer', title: 'Exam timers', hint: "Tell me when a timer runs out." },
  { kind: 'schedule', title: "Today's schedule", hint: 'Exams, classes and meetings coming up today.' },
  { kind: 'sync', title: 'Uploads and sign-in', hint: 'Queued uploads, upload problems and two-step verification.' },
  { kind: 'tips', title: 'Tips', hint: 'Short hints about features you have not used yet.' },
]

export function NotificationSettings() {
  const notify = useSettings((s) => s.notify)
  const setNotify = useSettings((s) => s.setNotify)
  return (
    <div className="flex h-full flex-col">
      <ScreenHeader label="Settings" title="Notification preferences" tone="blue" />
      <main className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <Group title="Show in the bell">
          {NOTIFY.map((n) => (
            <Row key={n.kind} title={n.title} hint={n.hint}>
              <Switch checked={notify[n.kind]} label={n.title} onChange={(on) => setNotify(n.kind, on)} />
            </Row>
          ))}
        </Group>
        <p className="text-xs leading-snug text-subtle">
          These are in-app notifications on the Hub's bell. Alerts while the app is closed need push notifications, which the server
          does not send yet.
        </p>
      </main>
    </div>
  )
}

/* ---------- A4. Help & support ---------- */

const FAQ: { q: string; a: string }[] = [
  { q: 'How do I grade a stack of papers?', a: 'Open Quick Assessments, pick the assessment (or tap Scan Assessment), capture each paper, confirm the answers, then Approve & Next. Each approved paper moves you to the next student.' },
  { q: 'Why do I have to confirm answers?', a: 'Recognition can misread marks, so a score only counts once you have confirmed each answer. Clear marks can be confirmed in one tap; yellow boxes need a look.' },
  { q: 'Does it work without internet?', a: 'Yes. Scanning by typing answers, scoring, approving and records all work offline. Online OCR, AI drafts and uploads wait until you are back online.' },
  { q: 'What do the colours mean?', a: 'Each area has one colour: yellow for scanning, the school level for AI (yellow Elementary, green High School, blue College), coral for records. Green means correct or confirmed, coral wrong or a problem, yellow needs review.' },
  { q: 'How do exam timers work?', a: 'Start one from Exam Timer or from an exam on your schedule. It stays green until half the time is left, turns yellow at a quarter, then coral. The clock on the GabAI badge shows the timer that ends soonest.' },
  { q: 'Can I change the bottom buttons?', a: 'Press and hold them. You can keep one to three shortcuts: scan, AI, timer, schedule, records or a new assessment.' },
  { q: 'What is behind the numbers on the Hub?', a: 'Press and hold any badge, like "3 Pending" or "5 Modules", to peek at exactly what it counts. Tap a row in the preview to open it, or tap outside to close.' },
  { q: 'What does the strip at the top mean?', a: 'Green: online and synced. Yellow: online but something needs you (demo mode, a sign-in check, an upload issue). Coral: offline or the server can not be reached. Your work is always saved on the phone first.' },
  { q: 'Where are my exported files?', a: 'Every export opens in a preview first. From there, Share sends it to an app (Drive, Gmail, Files) and Save as PDF prints a handout.' },
]

export function Help() {
  const [open, setOpen] = useState<number | null>(0)
  const [feedback, setFeedback] = useState(false)
  const [text, setText] = useState('')
  const showToast = useStore((s) => s.showToast)
  const mode = useStore((s) => s.session?.mode ?? 'signed out')
  return (
    <div className="flex h-full flex-col">
      <ScreenHeader label="Support" title="Help & support" tone="blue" />
      <main className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <section>
          <SectionTitle>Common questions</SectionTitle>
          <ul className="space-y-2">
            {FAQ.map((f, i) => (
              <li key={f.q} className="overflow-hidden rounded-xl border-2 border-ink bg-surface shadow-brut-sm">
                <button type="button" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)} className="flex w-full items-center gap-2 p-3 text-left">
                  <span className="min-w-0 flex-1 text-[13.5px] font-bold">{f.q}</span>
                  <ChevronDown size={16} className={cx('shrink-0 transition-transform', open === i && 'rotate-180')} aria-hidden />
                </button>
                {open === i && <p className="border-t-2 border-ink px-3 py-2.5 text-[13px] leading-relaxed">{f.a}</p>}
              </li>
            ))}
          </ul>
        </section>
        <BrutalistCard shadow="sm" className="p-3">
          <p className="text-[13.5px] font-bold">Something not working?</p>
          <p className="mt-0.5 text-xs leading-snug text-subtle">Write what happened and share it with your school's GabAI contact by email or chat.</p>
          <BrutalistButton size="sm" variant="primary" icon={MessageSquareText} className="mt-2.5 w-full" onClick={() => setFeedback(true)}>
            Send feedback
          </BrutalistButton>
        </BrutalistCard>
      </main>
      {feedback && (
        <Sheet
          title="Send feedback"
          onClose={() => setFeedback(false)}
          footer={
            <BrutalistButton
              variant="primary"
              className="w-full"
              disabled={text.trim().length < 5}
              onClick={() => {
                shareTextFile(
                  'gabai-feedback.txt',
                  'text/plain',
                  `${text.trim()}\n\n---\nGabAI ${APP_VERSION} • ${mode} mode • ${navigator.userAgent}\n`,
                )
                setFeedback(false)
                setText('')
                showToast('Choose an app to send your feedback')
              }}
            >
              Share feedback
            </BrutalistButton>
          }
        >
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            rows={6}
            autoFocus
            placeholder="What were you trying to do, and what happened instead?"
            className="w-full resize-none rounded-lg border-2 border-ink bg-surface p-3 text-[13.5px] leading-relaxed outline-none focus:shadow-brut"
          />
          <p className="mt-2 text-xs text-subtle">Don't include student names or grades. The app version and device type are added for you.</p>
        </Sheet>
      )}
    </div>
  )
}

/* ---------- A5. About ---------- */

const CREDITS = ['React', 'Tailwind CSS', 'Zustand', 'Lucide icons', 'Supabase JS', 'Vite', 'Plus Jakarta Sans', 'JetBrains Mono']

export function About() {
  const config = getConfig()
  const mode = useStore((s) => s.session?.mode)
  const [health, setHealth] = useState<'checking' | 'ok' | 'down' | 'none'>(config ? 'checking' : 'none')
  const [version, setVersion] = useState<string | null>(null)

  useEffect(() => {
    if (!config) return
    let cancelled = false
    void serverHealth().then((h) => {
      if (cancelled) return
      setHealth(h ? 'ok' : 'down')
      setVersion(h?.version ?? null)
    })
    return () => {
      cancelled = true
    }
  }, [config])

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader label="About" title="About GabAI" tone="blue" />
      <main className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <BrutalistCard className="flex flex-col items-center p-5 text-center">
          <LogoMark size={64} />
          <p className="mt-3 text-[22px] font-extrabold">GabAI</p>
          <p className="text-[13px] text-subtle">Instant paper grading and AI lesson design for teachers.</p>
          <MonoLabel className="mt-2">
            Version {APP_VERSION} • scoring-v1 • {mode === 'demo' ? 'Demo workspace' : mode === 'connected' ? 'Connected account' : 'Signed out'}
          </MonoLabel>
        </BrutalistCard>

        <Group title="Server">
          <Row title={config ? config.apiBaseUrl.replace(/^https?:\/\//, '') : 'Not configured'} hint={config ? 'GabAI backend for this build' : 'This build runs the offline demo only.'}>
            <span
              className={cx(
                'inline-flex items-center gap-1 rounded-md border-2 border-ink px-1.5 py-0.5 font-mono text-[10px] font-bold uppercase',
                health === 'ok' ? 'bg-mint' : health === 'down' ? 'bg-coral' : 'bg-surface',
              )}
            >
              {health === 'checking' ? <LoaderCircle size={11} className="animate-spin" aria-hidden /> : <Server size={11} aria-hidden />}
              {health === 'ok' ? `Online${version ? ` v${version}` : ''}` : health === 'down' ? 'Unreachable' : health === 'checking' ? 'Checking' : 'Demo'}
            </span>
          </Row>
          <Row title="Sign-in" hint="Supabase Auth with two-step verification; the backend never sees your password.">
            <ShieldCheck size={18} aria-hidden />
          </Row>
        </Group>

        <Group title="Privacy">
          <p className="p-3 text-[13px] leading-relaxed">
            Grades and rosters are stored on this phone and, for accounts, on your school's GabAI server. Photos sent for online OCR
            are discarded after reading. AI lesson drafts never include student names.
          </p>
        </Group>

        <Group title="Built with">
          <div className="flex flex-wrap gap-1.5 p-3">
            {CREDITS.map((c) => (
              <span key={c} className="rounded-md border-2 border-ink bg-surface px-2 py-0.5 text-xs font-bold">
                {c}
              </span>
            ))}
          </div>
          <a href="https://github.com/hrnndzzzz/GabAI-hackathon" className="flex items-center gap-2 px-3 py-3 text-[13px] font-bold underline underline-offset-2">
            <ExternalLink size={14} aria-hidden /> Project repository
          </a>
        </Group>
      </main>
    </div>
  )
}
