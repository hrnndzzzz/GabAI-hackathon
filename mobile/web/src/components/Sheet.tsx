import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { useBackHandler } from '../lib/back'
import { BrutalistCard, MonoLabel } from './ui'

/** Bottom sheet inside the app shell. Closes on the backdrop, the X, or the Android back gesture. */
export function Sheet({
  title,
  subtitle,
  onClose,
  children,
  footer,
}: {
  title: string
  subtitle?: string
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
}) {
  useBackHandler(true, onClose)
  return (
    <div className="absolute inset-0 z-50 flex items-end bg-black/50" onClick={onClose}>
      <BrutalistCard
        shadow="lg"
        role="dialog"
        aria-label={title}
        className="m-3 flex max-h-[85%] w-full animate-toast-in flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-start justify-between gap-2 border-b-2 border-ink px-4 py-3">
          <div className="min-w-0">
            <p className="text-[16px] leading-tight font-extrabold">{title}</p>
            {subtitle && <MonoLabel className="mt-0.5 text-subtle">{subtitle}</MonoLabel>}
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="-mr-1 rounded-md p-1">
            <X size={18} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">{children}</div>
        {footer && <div className="shrink-0 border-t-2 border-ink px-4 py-3">{footer}</div>}
      </BrutalistCard>
    </div>
  )
}
