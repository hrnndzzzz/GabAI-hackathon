import { ArrowRight, AtSign, Eye, EyeOff, KeyRound, UserPlus, WifiOff } from 'lucide-react'
import { useCallback, useState, type FormEvent, type ReactNode } from 'react'
import { Captcha } from '../components/Captcha'
import { LogoMark } from '../components/Logo'
import { MfaPanel } from '../components/MfaPanel'
import { BrutalistButton, BrutalistCard, MonoLabel, cx } from '../components/ui'
import { ApiError, api, describeError } from '../lib/api'
import { mfaState, signIn, signOut, type SignedInUser } from '../lib/auth'
import { getCaptchaSiteKey, getConfig } from '../lib/config'
import { DEMO_TEACHER } from '../lib/mock'
import { APP_VERSION } from './Settings'
import { useStore } from '../store'

type Phase = 'form' | 'mfa' | 'busy'

export function Login() {
  const enterDemo = useStore((s) => s.enterDemo)
  const enterConnected = useStore((s) => s.enterConnected)
  const setAuthView = useStore((s) => s.setAuthView)
  const online = getConfig() !== null
  const needsCaptcha = !!getCaptchaSiteKey()
  const [phase, setPhase] = useState<Phase>('form')
  const [user, setUser] = useState<SignedInUser | null>(null)
  const [email, setEmail] = useState(() => useStore.getState().authEmail)
  const [captcha, setCaptcha] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const onToken = useCallback((t: string | null) => setCaptcha(t), [])
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState<{ email?: string; password?: string; form?: string }>({})
  const [notice, setNotice] = useState<string | null>(() => (useStore.getState().authEmail ? 'Your account is ready. Sign in to continue.' : null))

  async function complete(signedIn: SignedInUser) {
    // display_name defaults to "Teacher" until the profile is edited.
    const profile = await api.me().catch(() => null)
    const name = profile && profile.display_name !== 'Teacher' ? profile.display_name : signedIn.email.split('@')[0]
    enterConnected(signedIn, name)
  }

  async function afterPassword(signedIn: SignedInUser) {
    const state = await mfaState()
    if (state.kind === 'verified') return complete(signedIn)
    if (state.kind === 'challenge') {
      setUser(signedIn)
      setPhase('mfa')
      return
    }
    // No authenticator yet: enroll only if this server actually requires MFA.
    try {
      await api.me()
      await complete(signedIn)
    } catch (error) {
      if (error instanceof ApiError && error.code === 'mfa_required') {
        setUser(signedIn)
        setPhase('mfa')
      } else {
        throw error
      }
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    const next: typeof errors = {}
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())) next.email = 'Enter your school email address.'
    if (!password) next.password = 'Enter your password.'
    if (needsCaptcha && !captcha) next.form = 'Complete the "I am human" check first.'
    setErrors(next)
    setNotice(null)
    if (Object.keys(next).length) return
    setPhase('busy')
    try {
      await afterPassword(await signIn(email.trim(), password, captcha))
    } catch (error) {
      setErrors({ form: describeError(error) })
      setPhase('form')
      // Each CAPTCHA token works once; a failed sign-in needs a fresh check.
      setCaptcha(null)
      setAttempt((n) => n + 1)
    }
  }

  if (phase === 'mfa' && user) {
    return (
      <Shell>
        <MfaPanel
          onDone={() => void complete(user)}
          onCancel={() => {
            void signOut()
            setUser(null)
            setPhase('form')
          }}
        />
      </Shell>
    )
  }

  return (
    <Shell>
      {online ? (
        <BrutalistCard className="p-4">
          <form onSubmit={submit} noValidate className="space-y-4">
            <Field
              label="School email"
              icon={<AtSign size={18} aria-hidden />}
              error={errors.email}
              htmlFor="login-email"
              input={
                <input
                  id="login-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="username"
                  autoCapitalize="none"
                  spellCheck={false}
                  placeholder="you@school.edu.ph"
                  aria-invalid={!!errors.email}
                  className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
                />
              }
            />
            <Field
              label="Password"
              icon={<KeyRound size={18} aria-hidden />}
              error={errors.password}
              htmlFor="login-password"
              input={
                <>
                  <input
                    id="login-password"
                    type={showPassword ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="current-password"
                    placeholder="Password"
                    aria-invalid={!!errors.password}
                    className="min-w-0 flex-1 bg-transparent text-[15px] outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                    className="-mr-1 rounded-md p-1"
                  >
                    {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </>
              }
            />
            {needsCaptcha && <Captcha key={attempt} onToken={onToken} />}
            {errors.form && (
              <p role="alert" className="rounded-lg border-2 border-ink bg-coral/25 px-3 py-2 text-[13px] font-semibold">
                {errors.form}
              </p>
            )}
            {notice && (
              <p role="status" className="rounded-lg border-2 border-ink bg-mint/30 px-3 py-2 text-[13px] font-semibold">
                {notice}
              </p>
            )}
            <BrutalistButton type="submit" size="lg" className="w-full" iconRight={ArrowRight} disabled={phase === 'busy'}>
              {phase === 'busy' ? 'Signing in…' : 'Sign in'}
            </BrutalistButton>
          </form>
        </BrutalistCard>
      ) : (
        <BrutalistCard shadow="sm" className="p-4 text-[13px] leading-snug">
          <p className="font-bold">Online sign-in isn't set up in this build.</p>
          <p className="mt-1 text-subtle">You can still try every screen in the offline demo below.</p>
        </BrutalistCard>
      )}

      <button
        type="button"
        onClick={() => setAuthView('register')}
        className="press mt-3 flex w-full items-center gap-3 rounded-xl border-2 border-ink bg-surface p-3 text-left shadow-brut-sm"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-brand">
          <UserPlus size={20} aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold">New teacher? Create an account</span>
          <span className="block text-xs text-subtle">Your school, sections and profile picture</span>
        </span>
        <ArrowRight size={20} aria-hidden />
      </button>

      <div className="my-5 flex items-center gap-3" aria-hidden>
        <span className="h-0.5 flex-1 bg-ink/15" />
        <MonoLabel className="text-subtle">or</MonoLabel>
        <span className="h-0.5 flex-1 bg-ink/15" />
      </div>

      <button
        type="button"
        onClick={enterDemo}
        className="press flex w-full items-center gap-3 rounded-xl border-2 border-ink bg-sun p-3 text-left shadow-brut"
      >
        <span className="flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-surface text-sm font-extrabold">
          {DEMO_TEACHER.initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-bold">Continue as {DEMO_TEACHER.display}</span>
          <MonoLabel className="mt-0.5 flex items-center gap-1 text-ink/75">
            <WifiOff size={11} aria-hidden /> Demo • offline sample data
          </MonoLabel>
        </span>
        <ArrowRight size={20} aria-hidden />
      </button>
    </Shell>
  )
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full flex-col overflow-y-auto px-5 pt-10 pb-[max(20px,env(safe-area-inset-bottom))]">
      <div className="flex flex-col items-center text-center">
        <LogoMark size={72} />
        <span className="mt-4 text-[30px] leading-none font-extrabold tracking-tight">GabAI</span>
        <p className="mt-3 max-w-[280px] text-sm leading-snug text-subtle">
          Instant paper grading and AI lesson design for teachers.
        </p>
      </div>
      <div className="mt-8">{children}</div>
      <MonoLabel className="mt-auto pt-8 text-center text-subtle">v{APP_VERSION} • scoring-v1</MonoLabel>
    </div>
  )
}

function Field({
  label,
  icon,
  input,
  error,
  htmlFor,
}: {
  label: string
  icon: ReactNode
  input: ReactNode
  error?: string
  htmlFor: string
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="mb-1.5 block text-[13px] font-bold">
        {label}
      </label>
      <div
        className={cx(
          'flex h-12 items-center gap-2.5 rounded-lg border-2 border-ink bg-surface px-3 focus-within:shadow-brut',
          error && 'bg-coral/10',
        )}
      >
        {icon}
        {input}
      </div>
      {error && <p className="mt-1 text-xs font-semibold text-alert-ink">{error}</p>}
    </div>
  )
}
