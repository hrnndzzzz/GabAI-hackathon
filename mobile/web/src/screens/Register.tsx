import { ArrowLeft, ArrowRight, AtSign, Building2, ChevronRight, Eye, EyeOff, KeyRound, MailCheck, Plus, UserRound, WifiOff } from 'lucide-react'
import { useCallback, useState, type ReactNode } from 'react'
import { Avatar } from '../components/Avatar'
import { AvatarEditor } from '../components/AvatarEditor'
import { Captcha } from '../components/Captcha'
import { ClassSheet } from '../components/ClassFields'
import { BrutalistButton, BrutalistCard, IconButton, MonoLabel, TONE_BG, cx } from '../components/ui'
import { signUp } from '../lib/auth'
import { defaultAvatar, type AvatarSpec } from '../lib/avatar'
import { useBackHandler } from '../lib/back'
import { groupByLevel, levelTone, type TeacherClass } from '../lib/classes'
import { getCaptchaSiteKey, getConfig } from '../lib/config'
import { LEVELS, LEVEL_ORDER, defaultGrade, gradeShort, type Level } from '../lib/levels'
import { useStore } from '../store'

const STEPS = ['Account', 'Classes', 'Picture', 'Finish'] as const

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/

/** New-teacher registration: account details, the sections they handle, a picture, then CAPTCHA + create. */
export function Register() {
  const setAuthView = useStore((s) => s.setAuthView)
  const savePendingProfile = useStore((s) => s.savePendingProfile)
  const online = getConfig() !== null
  const needsCaptcha = !!getCaptchaSiteKey()

  const [step, setStep] = useState(0)
  const [reached, setReached] = useState(0)
  const [fullName, setFullName] = useState('')
  const [school, setSchool] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [classes, setClasses] = useState<TeacherClass[]>([])
  const [editing, setEditing] = useState<{ cls?: TeacherClass; defaults?: { level: Level; grade: number } } | null>(null)
  const [avatar, setAvatar] = useState<AvatarSpec | null>(null)
  const [captcha, setCaptcha] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [done, setDone] = useState<'confirm_email' | 'signed_in' | null>(null)
  const onToken = useCallback((t: string | null) => setCaptcha(t), [])

  const picture = avatar ?? defaultAvatar(fullName || 'Teacher')

  function go(next: number) {
    setStep(next)
    setReached((r) => Math.max(r, next))
  }

  function back() {
    if (step === 0) setAuthView('login')
    else setStep(step - 1)
  }
  useBackHandler(!done && !editing, back)

  function validateAccount(): boolean {
    const next: Record<string, string> = {}
    if (fullName.trim().length < 2) next.fullName = 'Enter your name as students know it.'
    if (school.trim().length < 2) next.school = 'Enter the school you teach at.'
    if (online) {
      if (!EMAIL.test(email.trim())) next.email = 'Enter your school email address.'
      if (password.length < 8) next.password = 'Use at least 8 characters.'
    }
    setErrors(next)
    return Object.keys(next).length === 0
  }

  function nextStep() {
    if (step === 0 && !validateAccount()) return
    go(step + 1)
  }

  async function create() {
    const pending = { profile: { fullName: fullName.trim(), school: school.trim(), avatar: picture }, classes }
    if (!online) {
      // No sign-in service in this build: start the offline workspace with these details instead.
      const store = useStore.getState()
      store.enterDemo()
      store.updateProfile(pending.profile)
      for (const c of classes) store.upsertClass(c)
      store.showToast(`Welcome, ${fullName.trim().split(/\s+/)[0]}. This workspace stays on this phone.`)
      return
    }
    setBusy(true)
    setFormError(null)
    try {
      const result = await signUp(email.trim(), password, { fullName: pending.profile.fullName, school: pending.profile.school }, captcha)
      // Kept on this phone and applied to the workspace the first time this account signs in.
      savePendingProfile(email.trim(), pending)
      setDone(result)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Could not create the account.')
      // CAPTCHA tokens are single-use: show a fresh challenge for the next try.
      setCaptcha(null)
      setAttempt((n) => n + 1)
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <div className="flex h-full flex-col px-5 pt-14 pb-[max(20px,env(safe-area-inset-bottom))]">
        <div className="flex flex-col items-center text-center">
          <span className="flex size-20 items-center justify-center rounded-2xl border-2 border-ink bg-mint shadow-brut">
            <MailCheck size={36} aria-hidden />
          </span>
          <h1 className="mt-5 text-[24px] leading-tight font-extrabold">{done === 'confirm_email' ? 'Check your inbox' : 'Account created'}</h1>
          <p className="mt-2 max-w-[300px] text-[14px] leading-snug text-subtle">
            {done === 'confirm_email' ? (
              <>
                We sent a confirmation link to <b className="text-ink">{email.trim()}</b>. Open it on this phone and GabAI will open again,
                ready to sign in. Your classes and picture are saved on this phone and appear after you sign in.
              </>
            ) : (
              'Sign in to finish setting up two-step verification. Your classes and picture are ready.'
            )}
          </p>
        </div>
        <BrutalistButton size="lg" className="mt-8 w-full" iconRight={ArrowRight} onClick={() => setAuthView('login', email.trim())}>
          Go to sign in
        </BrutalistButton>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="shrink-0 border-b-2 border-ink bg-canvas px-4 pt-3 pb-3">
        <div className="flex items-center gap-3">
          <IconButton label={step === 0 ? 'Back to sign in' : 'Previous step'} icon={ArrowLeft} tone="blue" onClick={back} />
          <div className="min-w-0 flex-1">
            <MonoLabel className="truncate text-subtle">
              Step {String(step + 1).padStart(2, '0')} / 04 • Create account
            </MonoLabel>
            <h1 className="truncate text-[17px] leading-tight font-extrabold">
              {['About you', 'Classes you handle', 'Profile picture', 'Review & create'][step]}
            </h1>
          </div>
        </div>
        <nav aria-label="Steps" className="mt-3 flex gap-1.5">
          {STEPS.map((label, i) => (
            <button
              key={label}
              type="button"
              disabled={i > reached || i === step}
              aria-current={i === step ? 'step' : undefined}
              aria-label={`Step ${i + 1}: ${label}`}
              onClick={() => (i > 0 && !validateAccount() ? setStep(0) : setStep(i))}
              className="flex-1 py-1.5 disabled:cursor-default"
            >
              <span className={cx('block h-2 rounded-full border-2 border-ink', i <= step ? 'bg-brand' : 'bg-surface')} />
              <span className={cx('mt-1 block text-center font-mono text-[9.5px] font-bold uppercase', i === step ? 'text-ink' : 'text-subtle')}>{label}</span>
            </button>
          ))}
        </nav>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {step === 0 && (
          <div className="space-y-4">
            {!online && (
              <p className="flex items-start gap-2 rounded-lg border-2 border-ink bg-sun px-3 py-2 text-[12.5px] leading-snug font-semibold">
                <WifiOff size={15} className="mt-px shrink-0" aria-hidden />
                Online sign-in isn't set up in this build, so your workspace will stay on this phone.
              </p>
            )}
            <Field label="Full name" icon={<UserRound size={18} aria-hidden />} error={errors.fullName}>
              <input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" placeholder="e.g. Elena Santos" maxLength={120} className={INPUT} />
            </Field>
            <Field label="School" icon={<Building2 size={18} aria-hidden />} error={errors.school}>
              <input value={school} onChange={(e) => setSchool(e.target.value)} autoComplete="organization" placeholder="e.g. Rizal Integrated School" maxLength={120} className={INPUT} />
            </Field>
            {online && (
              <>
                <Field label="School email" icon={<AtSign size={18} aria-hidden />} error={errors.email}>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    autoComplete="email"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder="you@school.edu.ph"
                    className={INPUT}
                  />
                </Field>
                <Field label="Password" icon={<KeyRound size={18} aria-hidden />} error={errors.password} hint="At least 8 characters. You'll also set up two-step sign-in.">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    placeholder="Create a password"
                    className={INPUT}
                  />
                  <button type="button" onClick={() => setShowPassword((v) => !v)} aria-label={showPassword ? 'Hide password' : 'Show password'} className="-mr-1 rounded-md p-1">
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </Field>
              </>
            )}
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <p className="text-[13.5px] leading-snug text-subtle">
              Add each section you teach. They fill the class lists in Quick Assessments, Records and the schedule, colour-coded by level.
            </p>
            <div className="grid grid-cols-3 gap-2">
              {LEVEL_ORDER.map((l) => (
                <button
                  key={l}
                  type="button"
                  onClick={() => setEditing({ defaults: { level: l, grade: defaultGrade(l) } })}
                  className={cx('press flex flex-col items-start gap-1 rounded-xl border-2 border-ink p-2.5 text-left shadow-brut-sm', TONE_BG[levelTone(l)])}
                >
                  <Plus size={16} aria-hidden />
                  <span className="text-[12.5px] leading-tight font-extrabold">{LEVELS[l].label}</span>
                  <span className="font-mono text-[9.5px] font-bold uppercase opacity-80">{LEVELS[l].range}</span>
                </button>
              ))}
            </div>
            {classes.length === 0 ? (
              <p className="rounded-xl border-2 border-dashed border-ink/40 px-3 py-6 text-center text-[13px] text-subtle">
                No sections yet. Tap a level above to add one, or skip and add them later in Account settings.
              </p>
            ) : (
              groupByLevel(classes).map((g) => (
                <section key={g.level}>
                  <MonoLabel className="mb-1.5 text-subtle">
                    {LEVELS[g.level].label} • {g.classes.length}
                  </MonoLabel>
                  <ul className="space-y-1.5">
                    {g.classes.map((c) => (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => setEditing({ cls: c })}
                          className="press flex w-full items-center gap-3 rounded-lg border-2 border-ink bg-surface px-3 py-2 text-left shadow-brut-sm"
                        >
                          <span className={cx('flex size-8 shrink-0 items-center justify-center rounded-md border-2 border-ink font-mono text-[10px] font-bold', TONE_BG[levelTone(c.level)])}>
                            {gradeShort(c.level, c.grade)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-bold">
                              {c.section} · {c.subject}
                            </span>
                            <MonoLabel className="text-subtle">{c.students.length ? `${c.students.length} students` : 'No students yet'}</MonoLabel>
                          </span>
                          <ChevronRight size={16} aria-hidden />
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>
        )}

        {step === 2 && (
          <BrutalistCard className="p-4">
            <AvatarEditor name={fullName} value={picture} onChange={setAvatar} />
          </BrutalistCard>
        )}

        {step === 3 && (
          <div className="space-y-4">
            <BrutalistCard className="flex items-center gap-3 p-3">
              <Avatar name={fullName} spec={picture} size={56} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[16px] font-extrabold">{fullName.trim()}</p>
                <p className="truncate text-[13px] text-subtle">{school.trim()}</p>
                {online && <MonoLabel className="mt-0.5 truncate text-subtle">{email.trim()}</MonoLabel>}
              </div>
            </BrutalistCard>
            <Summary label="Sections" onEdit={() => setStep(1)}>
              {classes.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {classes.map((c) => (
                    <span key={c.id} className={cx('rounded-md border-2 border-ink px-1.5 py-0.5 text-[11.5px] font-bold', TONE_BG[levelTone(c.level)])}>
                      {gradeShort(c.level, c.grade)} {c.section}
                    </span>
                  ))}
                </div>
              ) : (
                <span className="text-[13px] text-subtle">None yet. You can add them later.</span>
              )}
            </Summary>
            {online && needsCaptcha && (
              <div>
                <p className="mb-1.5 text-[13px] font-bold">Quick check</p>
                <Captcha key={attempt} onToken={onToken} />
              </div>
            )}
            {formError && (
              <p role="alert" className="rounded-lg border-2 border-ink bg-coral/25 px-3 py-2 text-[13px] font-semibold">
                {formError}
              </p>
            )}
          </div>
        )}
      </main>

      <footer className="shrink-0 border-t-2 border-ink bg-canvas px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        {step < 3 ? (
          <div className="grid grid-cols-[auto_1fr] gap-3">
            <BrutalistButton size="lg" variant="secondary" icon={ArrowLeft} aria-label={step === 0 ? 'Back to sign in' : 'Previous step'} onClick={back} className="px-3.5" />
            <BrutalistButton size="lg" iconRight={ArrowRight} onClick={nextStep}>
              {step === 1 && classes.length === 0 ? 'Skip for now' : 'Continue'}
            </BrutalistButton>
          </div>
        ) : (
          <div className="grid grid-cols-[auto_1fr] gap-3">
            <BrutalistButton size="lg" variant="secondary" icon={ArrowLeft} aria-label="Previous step" onClick={back} className="px-3.5" />
            <BrutalistButton size="lg" iconRight={ArrowRight} disabled={busy || (online && needsCaptcha && !captcha)} onClick={() => void create()}>
              {busy ? 'Creating…' : online ? 'Create account' : 'Start on this phone'}
            </BrutalistButton>
          </div>
        )}
      </footer>

      {editing && (
        <ClassSheet
          initial={editing.cls}
          defaults={editing.defaults}
          onClose={() => setEditing(null)}
          onDelete={editing.cls ? () => (setClasses((cs) => cs.filter((c) => c.id !== editing.cls?.id)), setEditing(null)) : undefined}
          onSave={(c) => {
            setClasses((cs) => (cs.some((x) => x.id === c.id) ? cs.map((x) => (x.id === c.id ? c : x)) : [...cs, c]))
            setEditing(null)
          }}
        />
      )}
    </div>
  )
}

const INPUT = 'min-w-0 flex-1 bg-transparent text-[15px] outline-none'

function Field({ label, icon, error, hint, children }: { label: string; icon: ReactNode; error?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-bold">{label}</span>
      <span className={cx('flex h-12 items-center gap-2.5 rounded-lg border-2 border-ink bg-surface px-3 focus-within:shadow-brut', error && 'bg-coral/10')}>
        {icon}
        {children}
      </span>
      {error ? <span className="mt-1 block text-xs font-semibold text-alert-ink">{error}</span> : hint && <span className="mt-1 block text-xs text-subtle">{hint}</span>}
    </label>
  )
}

function Summary({ label, onEdit, children }: { label: string; onEdit: () => void; children: ReactNode }) {
  return (
    <div className="rounded-xl border-2 border-ink bg-surface p-3 shadow-brut-sm">
      <div className="mb-1.5 flex items-center justify-between">
        <MonoLabel className="text-subtle">{label}</MonoLabel>
        <button type="button" onClick={onEdit} className="text-[12px] font-bold underline underline-offset-2">
          Edit
        </button>
      </div>
      {children}
    </div>
  )
}
