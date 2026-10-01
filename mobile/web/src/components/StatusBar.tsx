import { useEffect, useState } from 'react'
import { getConfig } from '../lib/config'
import { relativeTime } from '../lib/format'
import { useNow } from '../lib/useNow'
import { isConnected, useStore, useWorkspace } from '../store'
import { cx } from './ui'

/** The device's own network state (airplane mode, no signal), kept live. */
export function useDeviceOnline(): boolean {
  const [online, setOnline] = useState(() => (typeof navigator === 'undefined' ? true : navigator.onLine))
  useEffect(() => {
    const on = () => setOnline(true)
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    return () => {
      window.removeEventListener('online', on)
      window.removeEventListener('offline', off)
    }
  }, [])
  return online
}

type State = { tone: 'green' | 'yellow' | 'coral' | 'muted'; label: string; detail: string; pulse?: boolean; action?: () => void }

/** Always-visible strip at the top of the app: online or offline, and what that means right now. */
export function StatusBar() {
  const online = useDeviceOnline()
  const session = useStore((s) => s.session)
  const connection = useStore((s) => s.connection)
  const syncing = useStore((s) => s.syncing)
  const syncNow = useStore((s) => s.syncNow)
  const setMfaPrompt = useStore((s) => s.setMfaPrompt)
  const ws = useWorkspace()
  const now = useNow(30000)
  const queued = ws.outbox.filter((o) => !o.lastError).length
  const issues = ws.outbox.length - queued
  const waiting = queued ? ` • ${queued} waiting to upload` : ''

  let state: State
  if (!online) {
    state = {
      tone: 'coral',
      label: 'Offline',
      detail: isConnected(session) ? `Saved on this phone${waiting}` : session ? 'Everything still works on this phone' : 'You can still use the demo',
    }
  } else if (!session) {
    state = { tone: 'green', label: 'Online', detail: getConfig() ? 'Ready to sign in' : 'This build runs the offline demo' }
  } else if (!isConnected(session)) {
    state = { tone: 'yellow', label: 'Online', detail: 'Demo workspace • nothing is uploaded' }
  } else if (syncing) {
    state = { tone: 'green', label: 'Online', detail: 'Syncing…', pulse: true }
  } else if (connection === 'offline') {
    state = { tone: 'coral', label: 'No server', detail: `Can't reach GabAI • tap to retry${waiting}`, action: () => void syncNow() }
  } else if (connection === 'mfa_required') {
    state = { tone: 'yellow', label: 'Online', detail: 'Verify two-step sign-in to sync', action: () => setMfaPrompt(true) }
  } else if (connection === 'signed_out') {
    state = { tone: 'yellow', label: 'Online', detail: 'Session ended • sign in again to sync' }
  } else {
    state = {
      tone: issues ? 'yellow' : 'green',
      label: 'Online',
      detail: issues ? `${issues} upload ${issues === 1 ? 'issue' : 'issues'} • see Records` : `Synced ${relativeTime(ws.lastSyncedISO, now)}${waiting}`,
      action: () => void syncNow(),
    }
  }

  const dot = { green: 'bg-leaf', yellow: 'bg-sun', coral: 'bg-coral', muted: 'bg-line' }[state.tone]
  const Tag = state.action ? 'button' : 'div'
  return (
    <Tag
      {...(state.action ? { type: 'button' as const, onClick: state.action } : {})}
      role="status"
      aria-live="polite"
      className={cx(
        'flex h-6 w-full shrink-0 items-center gap-1.5 border-b-2 border-ink px-4 text-left font-mono text-[10px] leading-none font-bold tracking-wide uppercase',
        state.tone === 'coral' ? 'bg-coral' : 'bg-canvas',
      )}
    >
      <span className="relative inline-flex size-2 shrink-0">
        {(state.pulse || state.tone === 'coral') && <span className={cx('absolute inset-0 animate-ping rounded-full opacity-70', state.tone === 'coral' ? 'bg-white' : dot)} />}
        <span className={cx('relative inline-flex size-2 rounded-full border border-ink', state.tone === 'coral' ? 'bg-white' : dot)} />
      </span>
      <span className="shrink-0">{state.label}</span>
      <span className="min-w-0 truncate font-semibold normal-case opacity-80">· {state.detail}</span>
    </Tag>
  )
}
