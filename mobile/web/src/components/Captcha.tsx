import { useEffect, useRef, useState } from 'react'
import { getCaptchaSiteKey } from '../lib/config'
import { resolvedTheme, useSettings } from '../lib/settings'

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string
      remove: (id: string) => void
    }
  }
}

let loader: Promise<void> | null = null

function loadTurnstile(): Promise<void> {
  loader ??= new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
    script.async = true
    script.onload = () => resolve()
    script.onerror = () => {
      loader = null
      reject(new Error('Could not load the CAPTCHA'))
    }
    document.head.appendChild(script)
  })
  return loader
}

/**
 * Cloudflare Turnstile, which Supabase Auth verifies when CAPTCHA protection is on.
 * Renders nothing when no site key is configured (e.g. local development).
 */
export function Captcha({ onToken }: { onToken: (token: string | null) => void }) {
  const siteKey = getCaptchaSiteKey()
  const theme = useSettings((s) => resolvedTheme(s.theme))
  const box = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!siteKey || !box.current) return
    let widget: string | null = null
    let cancelled = false
    loadTurnstile()
      .then(() => {
        if (cancelled || !box.current || !window.turnstile) return
        widget = window.turnstile.render(box.current, {
          sitekey: siteKey,
          theme,
          callback: (token: string) => onToken(token),
          'expired-callback': () => onToken(null),
          'error-callback': () => onToken(null),
        })
      })
      .catch((e: Error) => setError(e.message))
    return () => {
      cancelled = true
      if (widget) window.turnstile?.remove(widget)
    }
  }, [siteKey, theme, onToken])

  if (!siteKey) return null
  return (
    <div>
      <div ref={box} className="min-h-[65px]" />
      {error && <p className="mt-1 text-xs font-semibold text-alert-ink">{error}. Check your connection.</p>}
    </div>
  )
}
