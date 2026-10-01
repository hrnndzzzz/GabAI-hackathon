import { Copy, ExternalLink, LoaderCircle, ShieldCheck } from 'lucide-react'
import { useEffect, useState, type FormEvent } from 'react'
import { mfaState, startTotpEnrollment, verifyTotp, type TotpEnrollment } from '../lib/auth'
import { BrutalistButton, BrutalistCard, MonoLabel } from './ui'

type Step = { kind: 'loading' } | { kind: 'challenge'; factorId: string } | { kind: 'enroll'; enrollment: TotpEnrollment } | { kind: 'error'; message: string }

/**
 * Supabase TOTP: enroll an authenticator the first time, then enter its code at each
 * sign-in. The backend accepts only the resulting aal2 token (403 mfa_required otherwise).
 */
export function MfaPanel({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [step, setStep] = useState<Step>({ kind: 'loading' })
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const state = await mfaState()
        if (cancelled) return
        if (state.kind === 'verified') onDone()
        else if (state.kind === 'challenge') setStep({ kind: 'challenge', factorId: state.factorId })
        else setStep({ kind: 'enroll', enrollment: await startTotpEnrollment() })
      } catch (e) {
        if (!cancelled) setStep({ kind: 'error', message: e instanceof Error ? e.message : 'Two-step setup failed.' })
      }
    })()
    return () => {
      cancelled = true
    }
    // Runs once per mount: re-entering the panel starts a fresh challenge or enrollment.
  }, [])

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (step.kind !== 'challenge' && step.kind !== 'enroll') return
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await verifyTotp(step.kind === 'challenge' ? step.factorId : step.enrollment.factorId, code)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code did not work.')
      setCode('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <BrutalistCard className="p-4">
      <div className="flex items-center gap-3">
        <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border-2 border-ink bg-mint">
          <ShieldCheck size={22} aria-hidden />
        </span>
        <div>
          <h1 className="text-[17px] leading-tight font-extrabold">
            {step.kind === 'enroll' ? 'Set up two-step sign-in' : 'Two-step verification'}
          </h1>
          <MonoLabel className="mt-0.5 text-subtle">Required to protect student records</MonoLabel>
        </div>
      </div>

      {step.kind === 'loading' && (
        <p className="mt-4 flex items-center gap-2 text-sm text-subtle" role="status">
          <LoaderCircle size={16} className="animate-spin" aria-hidden /> Checking your account…
        </p>
      )}

      {step.kind === 'error' && (
        <p role="alert" className="mt-4 rounded-lg border-2 border-ink bg-coral/25 px-3 py-2 text-[13px] font-semibold">
          {step.message}
        </p>
      )}

      {step.kind === 'enroll' && (
        <div className="mt-4 space-y-3 text-[13px] leading-snug">
          <p>Add GabAI to an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…).</p>
          <a
            href={step.enrollment.uri}
            className="press flex h-11 items-center justify-center gap-2 rounded-lg border-2 border-ink bg-sun font-bold shadow-brut"
          >
            <ExternalLink size={17} aria-hidden /> Open authenticator on this phone
          </a>
          <div className="flex items-start gap-3 rounded-xl border-2 border-dashed border-ink/40 p-3">
            <img src={step.enrollment.qrCode} alt="QR code for your authenticator app" className="size-28 shrink-0 rounded-md border-2 border-ink bg-white p-1" />
            <div className="min-w-0">
              <p className="text-xs text-subtle">Or scan this from another device, or type the key:</p>
              <p className="mt-1 font-mono text-[12px] font-bold break-all">{step.enrollment.secret}</p>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard?.writeText(step.enrollment.secret).then(() => setCopied(true))
                }}
                className="mt-1.5 inline-flex items-center gap-1 text-xs font-bold underline underline-offset-2"
              >
                <Copy size={13} aria-hidden /> {copied ? 'Copied' : 'Copy key'}
              </button>
            </div>
          </div>
        </div>
      )}

      {(step.kind === 'challenge' || step.kind === 'enroll') && (
        <form onSubmit={submit} className="mt-4" noValidate>
          <label htmlFor="mfa-code" className="mb-1.5 block text-[13px] font-bold">
            {step.kind === 'enroll' ? 'Enter the code it shows' : 'Enter the code from your authenticator'}
          </label>
          <input
            id="mfa-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            placeholder="000000"
            className="h-12 w-full rounded-lg border-2 border-ink bg-white px-3 text-center font-mono text-[22px] font-bold tracking-[0.4em] outline-none focus:shadow-brut"
          />
          {error && <p className="mt-1.5 text-xs font-semibold text-alert-ink">{error}</p>}
          <BrutalistButton type="submit" size="lg" variant="green" className="mt-3 w-full" disabled={busy}>
            {busy ? 'Verifying…' : 'Verify'}
          </BrutalistButton>
        </form>
      )}

      <button type="button" onClick={onCancel} className="mt-3 w-full py-2 text-center text-[13px] font-bold underline underline-offset-2">
        Use a different account
      </button>
    </BrutalistCard>
  )
}
