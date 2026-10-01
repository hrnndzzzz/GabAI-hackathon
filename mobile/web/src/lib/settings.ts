import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { ExportFormat } from './lessons'

// Per-device preferences (not per teacher account): appearance, scanner defaults,
// dock shortcuts, notification choices and running exam timers.

export type ThemePref = 'light' | 'dark' | 'system'
export type ShortcutId = 'scan' | 'ai' | 'timer' | 'calendar' | 'records' | 'new-key'
export type NotifKind = 'urgent' | 'sync' | 'timer' | 'schedule' | 'tips'
export type PhotoAccess = 'ask' | 'allowed' | 'denied'

export interface ExamTimer {
  id: string
  label: string
  assessmentId: string | null
  classId: string | null
  durationMs: number
  /** Set while running; null while paused. */
  endsAt: number | null
  /** Time left when paused (or the full duration before the first start). */
  remainingMs: number
  /** The "time's up" alert has been shown. */
  alerted: boolean
}

export const MIN_SHORTCUTS = 1
export const MAX_SHORTCUTS = 3

interface SettingsState {
  theme: ThemePref
  reduceMotion: boolean
  paperSize: 'A4' | 'Letter'
  defaultFormat: ExportFormat
  photoAccess: PhotoAccess
  dock: ShortcutId[]
  notify: Record<NotifKind, boolean>
  timers: ExamTimer[]

  update: (patch: Partial<Omit<SettingsState, 'update' | 'notify'>>) => void
  setNotify: (kind: NotifKind, on: boolean) => void
  setDock: (dock: ShortcutId[]) => void
  startTimer: (timer: Omit<ExamTimer, 'id' | 'endsAt' | 'remainingMs' | 'alerted'>) => string
  pauseTimer: (id: string) => void
  resumeTimer: (id: string) => void
  addTime: (id: string, ms: number) => void
  resetTimer: (id: string) => void
  removeTimer: (id: string) => void
  markAlerted: (id: string) => void
}

export const useSettings = create<SettingsState>()(
  persist(
    (set) => {
      const patchTimer = (id: string, fn: (t: ExamTimer, now: number) => ExamTimer) =>
        set((s) => ({ timers: s.timers.map((t) => (t.id === id ? fn(t, Date.now()) : t)) }))
      return {
        theme: 'light',
        reduceMotion: false,
        paperSize: 'A4',
        defaultFormat: 'pdf',
        photoAccess: 'ask',
        dock: ['scan', 'ai'],
        notify: { urgent: true, sync: true, timer: true, schedule: true, tips: true },
        timers: [],

        update: (patch) => set(patch),
        setNotify: (kind, on) => set((s) => ({ notify: { ...s.notify, [kind]: on } })),
        setDock: (dock) => set({ dock: dock.slice(0, MAX_SHORTCUTS) }),
        startTimer: (timer) => {
          const id = crypto.randomUUID()
          set((s) => ({
            timers: [
              ...s.timers,
              { ...timer, id, endsAt: Date.now() + timer.durationMs, remainingMs: timer.durationMs, alerted: false },
            ],
          }))
          return id
        },
        pauseTimer: (id) => patchTimer(id, (t, now) => (t.endsAt ? { ...t, endsAt: null, remainingMs: Math.max(0, t.endsAt - now) } : t)),
        resumeTimer: (id) => patchTimer(id, (t, now) => (t.endsAt || t.remainingMs <= 0 ? t : { ...t, endsAt: now + t.remainingMs })),
        addTime: (id, ms) =>
          patchTimer(id, (t, now) => {
            const left = remaining(t, now) + ms
            return { ...t, durationMs: t.durationMs + ms, alerted: false, ...(t.endsAt ? { endsAt: now + left } : { remainingMs: left }) }
          }),
        resetTimer: (id) => patchTimer(id, (t) => ({ ...t, endsAt: null, remainingMs: t.durationMs, alerted: false })),
        removeTimer: (id) => set((s) => ({ timers: s.timers.filter((t) => t.id !== id) })),
        markAlerted: (id) => patchTimer(id, (t) => ({ ...t, alerted: true })),
      }
    },
    {
      name: 'gabai-settings-v1',
      storage: createJSONStorage(() => {
        try {
          return localStorage
        } catch {
          return sessionStorage
        }
      }),
      partialize: (s) => ({
        theme: s.theme,
        reduceMotion: s.reduceMotion,
        paperSize: s.paperSize,
        defaultFormat: s.defaultFormat,
        photoAccess: s.photoAccess,
        dock: s.dock,
        notify: s.notify,
        timers: s.timers,
      }),
    },
  ),
)

export function remaining(t: ExamTimer, now = Date.now()): number {
  return t.endsAt ? Math.max(0, t.endsAt - now) : t.remainingMs
}

export function isRunning(t: ExamTimer, now = Date.now()): boolean {
  return t.endsAt !== null && t.endsAt > now
}

/** Green above half the time, yellow to a quarter, coral after that; finished is coral too. */
export function timerTone(t: ExamTimer, now = Date.now()): 'green' | 'yellow' | 'coral' {
  const fraction = t.durationMs ? remaining(t, now) / t.durationMs : 0
  if (fraction > 0.5) return 'green'
  if (fraction > 0.25) return 'yellow'
  return 'coral'
}

export function formatClock(ms: number): string {
  const total = Math.ceil(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(h ? 2 : 1, '0')
  return `${h ? `${h}:` : ''}${mm}:${String(s).padStart(2, '0')}`
}

/** The light/dark choice actually in effect right now. */
export function resolvedTheme(pref: ThemePref): 'light' | 'dark' {
  if (pref !== 'system') return pref
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}
