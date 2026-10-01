import { useStore, type Screen } from '../store'
import type { StepLink } from './FlowHeader'

// Step bars in flow headers jump between steps. Jumping rebuilds the end of the screen
// stack so Back still walks through the steps in order.

const SCAN: Screen[] = ['scan-capture', 'scan-ocr', 'scan-match', 'scan-review']
const AI: Screen[] = ['ai-params', 'ai-format', 'ai-draft']

function jumper(flow: Screen[]) {
  return (index: number) => {
    const { stack, resetTo } = useStore.getState()
    const start = stack.findIndex((s) => flow.includes(s))
    resetTo([...(start === -1 ? stack : stack.slice(0, start)), ...flow.slice(0, index + 1)])
  }
}

export function useScanSteps(): StepLink[] {
  const scan = useStore((s) => s.scan)
  const go = jumper(SCAN)
  const captured = !!scan?.image
  const read = captured && scan?.ocr.status === 'done'
  return [
    { label: 'Capture', go: () => go(0) },
    { label: 'Check answers', go: captured ? () => go(1) : undefined },
    { label: 'Match key', go: read ? () => go(2) : undefined },
    { label: 'Approve', go: read ? () => go(3) : undefined },
  ]
}

export function useAiSteps(): StepLink[] {
  const params = useStore((s) => s.aiParams)
  const draft = useStore((s) => s.draft)
  const go = jumper(AI)
  const ready = !!params.topic.trim() && !!params.subject.trim()
  return [
    { label: 'Parameters', go: () => go(0) },
    { label: 'Format', go: ready ? () => go(1) : undefined },
    { label: 'Draft', go: draft ? () => go(2) : undefined },
  ]
}
