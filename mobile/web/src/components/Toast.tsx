import { useEffect } from 'react'
import { useStore } from '../store'

export function ToastHost() {
  const toast = useStore((s) => s.toast)
  const dismiss = useStore((s) => s.dismissToast)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(dismiss, toast.action ? 5000 : 3200)
    return () => clearTimeout(t)
  }, [toast, dismiss])

  return (
    <div aria-live="polite" className="pointer-events-none absolute inset-x-4 top-[max(12px,env(safe-area-inset-top))] z-50 flex justify-center">
      {toast && (
        <div
          key={toast.id}
          className="pointer-events-auto flex w-full max-w-sm animate-toast-in items-center gap-3 rounded-xl border-2 border-white bg-ink px-4 py-3 text-sm font-semibold text-white shadow-brut"
        >
          <span className="min-w-0 flex-1">{toast.message}</span>
          {toast.action && (
            <button
              type="button"
              className="press shrink-0 rounded-lg border-2 border-white bg-sun px-2.5 py-1 text-xs font-bold text-ink"
              onClick={() => {
                toast.action?.()
                dismiss()
              }}
            >
              {toast.actionLabel}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
