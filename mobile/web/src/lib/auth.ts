import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getConfig } from './config'
import { CONFIRM_REDIRECT, isAndroid } from './native'

// Supabase owns passwords, MFA and tokens; the GabAI backend only ever sees the
// resulting access token (docs/frontend-integration.md, "Login and sensitive data").

let client: SupabaseClient | null = null

export function supabase(): SupabaseClient | null {
  const config = getConfig()
  if (!config) return null
  client ??= createClient(config.supabaseUrl, config.supabasePublishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'gabai-auth' },
  })
  return client
}

function requireClient(): SupabaseClient {
  const sb = supabase()
  if (!sb) throw new Error('Online sign-in is not configured in this build.')
  return sb
}

export function friendlyAuthError(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'That email and password do not match a GabAI account.'
  if (/email not confirmed/i.test(message)) return 'Confirm your email address first, then sign in.'
  if (/already registered/i.test(message)) return 'An account with that email already exists. Sign in instead.'
  if (/(invalid|expired).*(code|totp|challenge)|(code|totp|challenge).*(invalid|expired)/i.test(message))
    return 'That code did not work. Check the time on your phone and enter the newest code.'
  if (/fetch|network|load failed/i.test(message)) return 'Could not reach the sign-in service. Check your connection.'
  // Cloudflare rejected a token that did pass on the phone: the Supabase secret doesn't match the site key.
  if (/captcha.*invalid-input-(response|secret)/i.test(message))
    return 'The "I am human" check passed, but the server could not confirm it. The CAPTCHA keys need fixing in Supabase.'
  if (/captcha/i.test(message)) return 'Complete the "I am human" check, then try again.'
  return message
}

export interface SignedInUser {
  id: string
  email: string
}

export async function signIn(email: string, password: string, captchaToken?: string | null): Promise<SignedInUser> {
  const { data, error } = await requireClient().auth.signInWithPassword({
    email,
    password,
    options: captchaToken ? { captchaToken } : undefined,
  })
  if (error) throw new Error(friendlyAuthError(error.message))
  return { id: data.user.id, email: data.user.email ?? email }
}

export async function signUp(
  email: string,
  password: string,
  details: { fullName: string; school: string },
  captchaToken?: string | null,
): Promise<'confirm_email' | 'signed_in'> {
  const { data, error } = await requireClient().auth.signUp({
    email,
    password,
    // Display-only profile hints; identity and ownership always come from the verified token.
    options: {
      data: { full_name: details.fullName, school: details.school },
      ...confirmRedirect(),
      ...(captchaToken ? { captchaToken } : {}),
    },
  })
  if (error) throw new Error(friendlyAuthError(error.message))
  return data.session ? 'signed_in' : 'confirm_email'
}

/** On the phone the confirmation link reopens GabAI; elsewhere Supabase uses the project's Site URL. */
function confirmRedirect(): { emailRedirectTo?: string } {
  return isAndroid() ? { emailRedirectTo: CONFIRM_REDIRECT } : {}
}

/** Sends a fresh confirmation email (the old link expired or was lost). */
export async function resendConfirmation(email: string, captchaToken?: string | null): Promise<void> {
  const { error } = await requireClient().auth.resend({
    type: 'signup',
    email,
    options: { ...confirmRedirect(), ...(captchaToken ? { captchaToken } : {}) },
  })
  if (error) throw new Error(friendlyAuthError(error.message))
}

export async function currentUser(): Promise<SignedInUser | null> {
  const sb = supabase()
  if (!sb) return null
  const { data } = await sb.auth.getSession()
  const user = data.session?.user
  return user ? { id: user.id, email: user.email ?? '' } : null
}

export type MfaState = { kind: 'verified' } | { kind: 'challenge'; factorId: string } | { kind: 'enroll' }

/** Where the signed-in teacher stands with two-step (TOTP) verification. */
export async function mfaState(): Promise<MfaState> {
  const sb = requireClient()
  const { data, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel()
  if (error) throw new Error(friendlyAuthError(error.message))
  if (data.currentLevel === 'aal2') return { kind: 'verified' }
  const factors = await sb.auth.mfa.listFactors()
  const totp = factors.data?.totp[0]
  return totp ? { kind: 'challenge', factorId: totp.id } : { kind: 'enroll' }
}

export interface TotpEnrollment {
  factorId: string
  qrCode: string
  secret: string
  uri: string
}

export async function startTotpEnrollment(): Promise<TotpEnrollment> {
  const sb = requireClient()
  // An abandoned earlier enrollment leaves an unverified factor behind; clear it first.
  const { data: factors } = await sb.auth.mfa.listFactors()
  for (const factor of factors?.all ?? []) {
    if (factor.factor_type === 'totp' && factor.status !== 'verified') {
      await sb.auth.mfa.unenroll({ factorId: factor.id })
    }
  }
  const { data, error } = await sb.auth.mfa.enroll({
    factorType: 'totp',
    issuer: 'GabAI',
    friendlyName: `GabAI ${new Date().toISOString().slice(0, 16)}`,
  })
  if (error) throw new Error(friendlyAuthError(error.message))
  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret, uri: data.totp.uri }
}

export async function verifyTotp(factorId: string, code: string): Promise<void> {
  const { error } = await requireClient().auth.mfa.challengeAndVerify({ factorId, code })
  if (error) throw new Error(friendlyAuthError(error.message))
}

export async function accessToken(): Promise<string | null> {
  const sb = supabase()
  if (!sb) return null
  const { data } = await sb.auth.getSession()
  return data.session?.access_token ?? null
}

export async function refreshAccessToken(): Promise<string | null> {
  const sb = supabase()
  if (!sb) return null
  const { data, error } = await sb.auth.refreshSession()
  return error ? null : (data.session?.access_token ?? null)
}

export async function signOut(): Promise<void> {
  await supabase()?.auth.signOut({ scope: 'local' })
}
