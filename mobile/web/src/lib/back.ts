import { useEffect, useRef } from 'react'

// Overlays (menus, sheets) register here so the Android back button closes
// them before it pops a screen.
const handlers: (() => void)[] = []

export function runBackHandler(): boolean {
  const top = handlers[handlers.length - 1]
  if (!top) return false
  top()
  return true
}

export function useBackHandler(active: boolean, onBack: () => void): void {
  const ref = useRef(onBack)
  ref.current = onBack
  useEffect(() => {
    if (!active) return
    const handler = () => ref.current()
    handlers.push(handler)
    return () => {
      const i = handlers.lastIndexOf(handler)
      if (i >= 0) handlers.splice(i, 1)
    }
  }, [active])
}
