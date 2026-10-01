export function greeting(date = new Date()): string {
  const h = date.getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export function relativeTime(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never'
  const mins = Math.round((now - Date.parse(iso)) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.round(hours / 24)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diff = Math.round((startOf(now) - startOf(d)) / 86400000)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Yesterday'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0].toUpperCase())
    .join('')
}

export function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/** "Due today, 5:00 PM", "Due Friday", "Due Oct 14", or "Overdue since …". */
export function dueLabel(iso: string | null, now = new Date()): string | null {
  if (!iso) return null
  const due = new Date(iso)
  const time = due.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
  if (due.getTime() < now.getTime()) return `Overdue since ${dayLabel(iso, now)}`
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((startOf(due) - startOf(now)) / 86400000)
  if (days === 0) return `Due today, ${time}`
  if (days === 1) return `Due tomorrow, ${time}`
  if (days < 7) return `Due ${due.toLocaleDateString('en-US', { weekday: 'long' })}`
  return `Due ${due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
}
