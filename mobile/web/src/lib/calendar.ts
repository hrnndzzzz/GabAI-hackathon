import type { Tone } from '../components/ui'

// Teacher schedule: exams, quizzes, classes, deadlines, meetings and reminders.

export type EventType = 'exam' | 'quiz' | 'class' | 'deadline' | 'meeting' | 'reminder'

export interface CalendarEvent {
  id: string
  title: string
  type: EventType
  /** Local start time, timezone-aware ISO. */
  startISO: string
  durationMin: number
  allDay: boolean
  classId: string | null
  assessmentId: string | null
  notes: string
}

export const EVENT_TYPES: Record<EventType, { label: string; tone: Tone }> = {
  exam: { label: 'Exam', tone: 'coral' },
  quiz: { label: 'Quiz', tone: 'yellow' },
  class: { label: 'Class', tone: 'green' },
  deadline: { label: 'Deadline', tone: 'blue' },
  meeting: { label: 'Meeting', tone: 'ink' },
  reminder: { label: 'Reminder', tone: 'white' },
}

/** YYYY-MM-DD in local time. */
export function dayKey(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** The Sunday-first weeks covering the month (five or six), as calendar apps show it. */
export function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1)
  const start = new Date(year, month, 1 - first.getDay())
  const days = Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
  // Drop a final week that lies entirely in the next month.
  return days[35].getMonth() !== month ? days.slice(0, 35) : days
}

export function eventsOn(events: CalendarEvent[], key: string): CalendarEvent[] {
  return events.filter((e) => dayKey(new Date(e.startISO)) === key).sort((a, b) => Date.parse(a.startISO) - Date.parse(b.startISO))
}

export function upcoming(events: CalendarEvent[], now = Date.now(), limit = 5): CalendarEvent[] {
  return events
    .filter((e) => Date.parse(e.startISO) + e.durationMin * 60000 >= now)
    .sort((a, b) => Date.parse(a.startISO) - Date.parse(b.startISO))
    .slice(0, limit)
}

export function timeLabel(e: CalendarEvent): string {
  if (e.allDay) return 'All day'
  return new Date(e.startISO).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}
