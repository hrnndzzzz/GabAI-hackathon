import { useEffect, type ComponentType } from 'react'
import { FilePreview } from './components/FilePreview'
import { MfaPanel } from './components/MfaPanel'
import { StatusBar } from './components/StatusBar'
import { ToastHost } from './components/Toast'
import { currentUser } from './lib/auth'
import { runBackHandler } from './lib/back'
import { setThemeChrome } from './lib/native'
import { resolvedTheme, useSettings } from './lib/settings'
import { CalendarScreen } from './screens/Calendar'
import { AiDraft } from './screens/AiDraft'
import { AiFormat } from './screens/AiFormat'
import { AiParams } from './screens/AiParams'
import { Hub } from './screens/Hub'
import { KeyEditor } from './screens/KeyEditor'
import { Login } from './screens/Login'
import { Records } from './screens/Records'
import { Register } from './screens/Register'
import { ScanCapture } from './screens/ScanCapture'
import { ScanMatch } from './screens/ScanMatch'
import { ScanOcr } from './screens/ScanOcr'
import { ScanReview } from './screens/ScanReview'
import { About, AccountSettings, Help, NotificationSettings, SystemSettings } from './screens/Settings'
import { TimerScreen } from './screens/Timer'
import { isConnected, useStore, type Screen } from './store'

const SCREENS: Record<Screen, ComponentType> = {
  hub: Hub,
  'scan-capture': ScanCapture,
  'scan-ocr': ScanOcr,
  'scan-match': ScanMatch,
  'scan-review': ScanReview,
  'ai-params': AiParams,
  'ai-format': AiFormat,
  'ai-draft': AiDraft,
  records: Records,
  'key-editor': KeyEditor,
  account: AccountSettings,
  settings: SystemSettings,
  'notif-settings': NotificationSettings,
  help: Help,
  about: About,
  timer: TimerScreen,
  calendar: CalendarScreen,
}

function handleBack(): boolean {
  return runBackHandler() || useStore.getState().back()
}

export default function App() {
  const session = useStore((s) => s.session)
  const stack = useStore((s) => s.stack)
  const scan = useStore((s) => s.scan)
  const draft = useStore((s) => s.draft)
  const mfaPrompt = useStore((s) => s.mfaPrompt)
  const authView = useStore((s) => s.authView)
  const connectedUser = isConnected(session) ? session.userId : null
  useAppearance()
  useTimerAlerts()

  let screen: Screen | 'login' | 'register' = session ? stack[stack.length - 1] : authView === 'register' ? 'register' : 'login'
  // Flow screens need their in-memory session; fall back if it is missing.
  if (screen.startsWith('scan-') && (!scan || (screen !== 'scan-capture' && !scan.image))) screen = 'hub'
  if (screen === 'ai-draft' && !draft) screen = 'ai-params'

  // A remembered account opens straight into its local workspace (offline-first); the
  // Supabase session is checked in the background and only gates online actions.
  useEffect(() => {
    if (!connectedUser) return
    let cancelled = false
    void currentUser().then((user) => {
      if (cancelled) return
      if (!user || user.id !== connectedUser) useStore.setState({ connection: 'signed_out' })
      else void useStore.getState().syncNow({ quiet: true })
    })
    const onOnline = () => void useStore.getState().syncNow({ quiet: true })
    const onOffline = () => useStore.setState({ connection: 'offline' })
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    return () => {
      cancelled = true
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
    }
  }, [connectedUser])

  useEffect(() => {
    // MainActivity calls this on the system back gesture; false lets Android handle it.
    window.gabaiBack = handleBack
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleBack()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      delete window.gabaiBack
      window.removeEventListener('keydown', onKey)
    }
  }, [])

  const Current = screen === 'login' ? Login : screen === 'register' ? Register : SCREENS[screen]
  return (
    <div className="relative mx-auto flex h-full max-w-[420px] flex-col overflow-hidden bg-canvas min-[440px]:border-x-2 min-[440px]:border-ink">
      {/* The scanner is a full-bleed dark camera view; every other screen shows the network strip. */}
      {screen !== 'scan-capture' && <StatusBar />}
      <div key={`${screen}-${stack.length}`} className="flex min-h-0 flex-1 animate-screen-in flex-col">
        <Current />
      </div>
      {mfaPrompt && connectedUser && (
        <div className="absolute inset-0 z-40 overflow-y-auto bg-canvas px-5 pt-10 pb-6">
          <MfaPanel
            onDone={() => {
              useStore.setState({ mfaPrompt: false, connection: 'online' })
              void useStore.getState().syncNow()
            }}
            onCancel={() => void useStore.getState().signOut()}
          />
        </div>
      )}
      <FilePreview />
      <ToastHost />
    </div>
  )
}

/** Applies the theme and motion settings to the document, following the system when asked. */
function useAppearance() {
  const theme = useSettings((s) => s.theme)
  const reduceMotion = useSettings((s) => s.reduceMotion)
  useEffect(() => {
    const apply = () => {
      const dark = resolvedTheme(theme) === 'dark'
      document.documentElement.dataset.theme = dark ? 'dark' : 'light'
      setThemeChrome(dark)
    }
    apply()
    if (theme !== 'system') return
    const query = matchMedia('(prefers-color-scheme: dark)')
    query.addEventListener('change', apply)
    return () => query.removeEventListener('change', apply)
  }, [theme])
  useEffect(() => {
    if (reduceMotion) document.documentElement.dataset.motion = 'reduced'
    else delete document.documentElement.dataset.motion
  }, [reduceMotion])
}

/** Announces finished exam timers once, wherever the teacher is in the app. */
function useTimerAlerts() {
  useEffect(() => {
    const check = () => {
      const { timers, markAlerted, notify } = useSettings.getState()
      const now = Date.now()
      for (const t of timers) {
        if (t.alerted || !t.endsAt || t.endsAt > now) continue
        markAlerted(t.id)
        if (!notify.timer) continue
        navigator.vibrate?.([400, 150, 400, 150, 400])
        beep()
        useStore.getState().showToast(`Time's up: ${t.label}`, { label: 'Open', run: () => useStore.getState().navigate('timer') })
      }
    }
    check()
    const id = setInterval(check, 1000)
    return () => clearInterval(id)
  }, [])
}

let audio: AudioContext | null = null

function beep() {
  try {
    audio ??= new AudioContext()
    const start = audio.currentTime
    for (let i = 0; i < 3; i++) {
      const osc = audio.createOscillator()
      const gain = audio.createGain()
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.25, start + i * 0.35)
      gain.gain.exponentialRampToValueAtTime(0.001, start + i * 0.35 + 0.25)
      osc.connect(gain).connect(audio.destination)
      osc.start(start + i * 0.35)
      osc.stop(start + i * 0.35 + 0.26)
    }
  } catch {
    // Audio can be unavailable (autoplay rules); the toast and vibration still show.
  }
}
