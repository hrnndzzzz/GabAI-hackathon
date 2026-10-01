import { CalendarDays, Camera, FolderOpen, KeyRound, Sparkles, Timer, type LucideIcon } from 'lucide-react'
import type { Tone } from '../components/ui'
import type { ShortcutId } from './settings'

/** What can sit in the Hub's bottom dock (1–3 at a time, chosen by the teacher). */
export const SHORTCUTS: Record<ShortcutId, { title: string; sub: string; icon: LucideIcon; tone: Tone }> = {
  scan: { title: 'Scan Assessment', sub: 'Instant OCR', icon: Camera, tone: 'yellow' },
  ai: { title: 'AI Assistant', sub: 'Lesson & Rubric', icon: Sparkles, tone: 'green' },
  timer: { title: 'Exam Timer', sub: 'Countdown', icon: Timer, tone: 'ink' },
  calendar: { title: 'Schedule', sub: 'Calendar', icon: CalendarDays, tone: 'blue' },
  records: { title: 'Records', sub: 'All classes', icon: FolderOpen, tone: 'coral' },
  'new-key': { title: 'New Assessment', sub: 'Answer key', icon: KeyRound, tone: 'yellow' },
}

export const SHORTCUT_ORDER: ShortcutId[] = ['scan', 'ai', 'timer', 'calendar', 'records', 'new-key']
