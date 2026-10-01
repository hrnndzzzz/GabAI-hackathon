import { ChevronDown, type LucideIcon } from 'lucide-react'
import { useEffect, useId, useRef, type ReactNode } from 'react'
import { BrutalistCard, IconTile, MonoLabel, cx, type Tone } from './ui'

export function CollapsibleCategory({
  title,
  subtitle,
  icon,
  color,
  badges,
  open,
  onToggle,
  children,
}: {
  title: string
  subtitle: string
  icon: LucideIcon
  color: Tone
  badges: ReactNode
  open: boolean
  onToggle: () => void
  children: ReactNode
}) {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  // Already open when the Hub comes back from a feature: the restored scroll wins.
  const openedOnMount = useRef(open)

  // Once the drawer has finished opening, bring as much of it into view as fits.
  useEffect(() => {
    if (!open) {
      openedOnMount.current = false
      return
    }
    if (openedOnMount.current) return
    const t = setTimeout(() => {
      const el = ref.current
      const scroller = el?.closest('main')
      if (!el || !scroller) return
      const card = el.getBoundingClientRect()
      const view = scroller.getBoundingClientRect()
      const margin = 12
      let delta = Math.max(0, card.bottom - view.bottom + margin)
      // Taller than the viewport: keep the header visible instead.
      if (card.top - delta < view.top + margin) delta = card.top - view.top - margin
      if (delta) scroller.scrollTo({ top: scroller.scrollTop + delta, behavior: 'smooth' })
    }, 320)
    return () => clearTimeout(t)
  }, [open])

  return (
    <BrutalistCard ref={ref} color={color} className="overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={onToggle}
        className="block w-full p-3 text-left short:py-2.5"
      >
        <span className="flex items-start gap-3">
          <IconTile icon={icon} size={40} />
          <span className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-1.5 pt-0.5">{badges}</span>
          <ChevronDown
            size={20}
            strokeWidth={2.5}
            aria-hidden
            className={cx('mt-2 shrink-0 transition-transform duration-300', open && 'rotate-180')}
          />
        </span>
        <span className="mt-2.5 block text-[17px] leading-tight font-extrabold tracking-tight short:mt-1.5">{title}</span>
        <MonoLabel className="mt-1 text-ink/80">{subtitle}</MonoLabel>
      </button>
      <div
        id={id}
        className={cx(
          'grid transition-[grid-template-rows] duration-300 ease-out',
          open ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="min-h-0 overflow-hidden" inert={!open}>
          <div className="border-t-2 border-ink px-3 pt-3 pb-3">{children}</div>
        </div>
      </div>
    </BrutalistCard>
  )
}
