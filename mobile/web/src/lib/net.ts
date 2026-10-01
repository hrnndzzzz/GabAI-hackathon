import { create } from 'zustand'
import { relativeTime } from './format'
import { getConfig } from './config'
import { isConnected, useStore, useWorkspace } from '../store'
import { useNow } from './useNow'

// Online status, Discord-style: green online, yellow idle, red offline, blinking red reconnecting.

/** No taps or keys for this long (or the app in the background) counts as idle. */
const IDLE_MS = 5 * 60 * 1000

interface NetState {
  deviceOnline: boolean
  idle: boolean
}

export const useNet = create<NetState>(() => ({
  deviceOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
  idle: false,
}))

let installed = false

/** Network and activity listeners, installed once for the whole app. */
export function installNetListeners(): () => void {
  if (installed) return () => undefined
  installed = true
  let timer: number | undefined
  const active = () => {
    if (useNet.getState().idle) useNet.setState({ idle: false })
    window.clearTimeout(timer)
    timer = window.setTimeout(() => useNet.setState({ idle: true }), IDLE_MS)
  }
  const visibility = () => (document.hidden ? useNet.setState({ idle: true }) : active())
  const online = () => useNet.setState({ deviceOnline: true })
  const offline = () => useNet.setState({ deviceOnline: false })
  window.addEventListener('pointerdown', active, { passive: true })
  window.addEventListener('keydown', active)
  document.addEventListener('visibilitychange', visibility)
  window.addEventListener('online', online)
  window.addEventListener('offline', offline)
  active()
  return () => {
    installed = false
    window.clearTimeout(timer)
    window.removeEventListener('pointerdown', active)
    window.removeEventListener('keydown', active)
    document.removeEventListener('visibilitychange', visibility)
    window.removeEventListener('online', online)
    window.removeEventListener('offline', offline)
  }
}

export type NetLevel = 'online' | 'idle' | 'offline' | 'reconnecting'

export interface NetStatus {
  level: NetLevel
  label: string
  detail: string
}

export const NET_LEVELS: Record<NetLevel, { label: string; dot: string; hex: string; blink?: boolean }> = {
  online: { label: 'Online', dot: 'bg-leaf', hex: '#6BCB77' },
  idle: { label: 'Idle', dot: 'bg-sun', hex: '#FFD93D' },
  offline: { label: 'Offline', dot: 'bg-coral', hex: '#FF5964' },
  reconnecting: { label: 'Reconnecting', dot: 'bg-coral', hex: '#FF5964', blink: true },
}

/** What the dot, the account menu and the status island show right now. */
export function useNetStatus(): NetStatus {
  const { deviceOnline, idle } = useNet()
  const session = useStore((s) => s.session)
  const connection = useStore((s) => s.connection)
  const syncing = useStore((s) => s.syncing)
  const ws = useWorkspace()
  const now = useNow(30000)
  const queued = ws.outbox.filter((o) => !o.lastError).length
  const issues = ws.outbox.length - queued
  const waiting = queued ? ` • ${queued} waiting to upload` : ''
  const connected = isConnected(session)

  if (!deviceOnline) {
    return { level: 'offline', label: 'Offline', detail: connected ? `Saved on this phone${waiting}` : 'Everything still works on this phone' }
  }
  if (connected && connection === 'offline') {
    return syncing
      ? { level: 'reconnecting', label: 'Reconnecting', detail: `Trying to reach GabAI…${waiting}` }
      : { level: 'offline', label: 'Offline', detail: `Can't reach GabAI • retrying${waiting}` }
  }
  const level: NetLevel = idle ? 'idle' : 'online'
  const label = NET_LEVELS[level].label
  if (!session) return { level, label, detail: getConfig() ? 'Ready to sign in' : 'This build runs the offline demo' }
  if (!connected) return { level, label, detail: 'Demo workspace • nothing is uploaded' }
  if (syncing) return { level, label, detail: 'Syncing…' }
  if (connection === 'mfa_required') return { level, label, detail: 'Verify two-step sign-in to sync' }
  if (connection === 'signed_out') return { level, label, detail: 'Session ended • sign in again to sync' }
  if (issues) return { level, label, detail: `${issues} upload ${issues === 1 ? 'issue' : 'issues'} • see Records` }
  return { level, label, detail: `Synced ${relativeTime(ws.lastSyncedISO, now)}${waiting}` }
}
