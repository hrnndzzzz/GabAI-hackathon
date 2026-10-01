import { useEffect, type ComponentType } from 'react'
import { MfaPanel } from './components/MfaPanel'
import { ToastHost } from './components/Toast'
import { currentUser } from './lib/auth'
import { runBackHandler } from './lib/back'
import { AiDraft } from './screens/AiDraft'
import { AiFormat } from './screens/AiFormat'
import { AiParams } from './screens/AiParams'
import { Hub } from './screens/Hub'
import { KeyEditor } from './screens/KeyEditor'
import { Login } from './screens/Login'
import { Records } from './screens/Records'
import { ScanCapture } from './screens/ScanCapture'
import { ScanMatch } from './screens/ScanMatch'
import { ScanOcr } from './screens/ScanOcr'
import { ScanReview } from './screens/ScanReview'
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
  const connectedUser = isConnected(session) ? session.userId : null

  let screen: Screen | 'login' = session ? stack[stack.length - 1] : 'login'
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
    window.addEventListener('online', onOnline)
    return () => {
      cancelled = true
      window.removeEventListener('online', onOnline)
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

  const Current = screen === 'login' ? Login : SCREENS[screen]
  return (
    <div className="relative mx-auto flex h-full max-w-[420px] flex-col overflow-hidden bg-canvas min-[440px]:border-x-2 min-[440px]:border-ink">
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
      <ToastHost />
    </div>
  )
}
