import { Camera, ChevronLeft, ChevronRight, Clock, Plus, Timer, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { ScreenHeader } from '../components/FlowHeader'
import { Select } from '../components/Select'
import { Sheet } from '../components/Sheet'
import { BrutalistButton, IconButton, MonoLabel, SectionTitle, Switch, TONE_BG, cx } from '../components/ui'
import { EVENT_TYPES, dayKey, eventsOn, monthGrid, timeLabel, upcoming, type CalendarEvent, type EventType } from '../lib/calendar'
import { classLabel, levelTone, sortClasses } from '../lib/classes'
import { useSettings } from '../lib/settings'
import { useNow } from '../lib/useNow'
import { localIsoWithOffset, newId } from '../lib/workspace'
import { useStore, useWorkspace } from '../store'

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S']
const DURATIONS = [15, 30, 40, 45, 60, 90, 120, 180]

/** One row in the day agenda: a scheduled event, or an assessment's due date. */
type Item = { kind: 'event'; event: CalendarEvent } | { kind: 'due'; id: string; title: string; iso: string; classId: string | null }

export function CalendarScreen() {
  const ws = useWorkspace()
  const now = useNow(60000)
  const today = new Date(now)
  const [month, setMonth] = useState(() => new Date(today.getFullYear(), today.getMonth(), 1))
  const [selected, setSelected] = useState(() => dayKey(today))
  const [editing, setEditing] = useState<CalendarEvent | null>(null)

  const due = useMemo(
    () =>
      ws.assessments
        .filter((a) => a.dueISO)
        .map((a) => ({ kind: 'due' as const, id: `due-${a.id}`, title: a.title, iso: a.dueISO!, classId: a.classId })),
    [ws.assessments],
  )

  function itemsOn(key: string): Item[] {
    const events: Item[] = eventsOn(ws.events, key).map((event) => ({ kind: 'event', event }))
    const dues: Item[] = due.filter((d) => dayKey(new Date(d.iso)) === key)
    return [...dues, ...events]
  }

  const grid = monthGrid(month.getFullYear(), month.getMonth())
  const todayKey = dayKey(today)
  const dayItems = itemsOn(selected)
  const selectedDate = new Date(`${selected}T00:00:00`)
  const next = upcoming(ws.events, now, 3)

  function shiftMonth(by: number) {
    setMonth((m) => new Date(m.getFullYear(), m.getMonth() + by, 1))
  }

  function newEvent(): CalendarEvent {
    const base = new Date(`${selected}T00:00:00`)
    // Today: the next full hour. Other days: 8:00 AM.
    const hour = selected === todayKey ? Math.min(23, today.getHours() + 1) : 8
    base.setHours(hour, 0, 0, 0)
    return { id: newId(), title: '', type: 'exam', startISO: localIsoWithOffset(base), durationMin: 60, allDay: false, classId: null, assessmentId: null, notes: '' }
  }

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader
        label="Schedule"
        title={month.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}
        tone="blue"
        aside={
          <div className="flex gap-1.5">
            <IconButton label="Previous month" icon={ChevronLeft} className="size-9" onClick={() => shiftMonth(-1)} />
            <IconButton label="Next month" icon={ChevronRight} className="size-9" onClick={() => shiftMonth(1)} />
          </div>
        }
      />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="border-b-2 border-ink bg-surface px-3 pt-2 pb-3">
          <div className="grid grid-cols-7 text-center" aria-hidden>
            {WEEKDAYS.map((d, i) => (
              <MonoLabel key={i} className="py-1 text-subtle">
                {d}
              </MonoLabel>
            ))}
          </div>
          <div role="grid" aria-label="Month" className="grid grid-cols-7 gap-1">
            {grid.map((d) => {
              const key = dayKey(d)
              const items = itemsOn(key)
              const inMonth = d.getMonth() === month.getMonth()
              const isToday = key === todayKey
              const isSelected = key === selected
              const tones = [...new Set(items.map((it) => (it.kind === 'due' ? 'coral' : EVENT_TYPES[it.event.type].tone)))].slice(0, 3)
              return (
                <button
                  key={key}
                  type="button"
                  role="gridcell"
                  aria-selected={isSelected}
                  aria-label={`${d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}${items.length ? `, ${items.length} scheduled` : ''}`}
                  onClick={() => {
                    setSelected(key)
                    if (!inMonth) setMonth(new Date(d.getFullYear(), d.getMonth(), 1))
                  }}
                  className={cx(
                    'flex h-11 flex-col items-center justify-start rounded-lg border-2 pt-1',
                    isSelected ? 'border-ink bg-brand shadow-brut-sm' : isToday ? 'border-ink bg-sun/50' : 'border-transparent',
                    !inMonth && !isSelected && 'opacity-35',
                  )}
                >
                  <span className={cx('text-[13px] leading-none', isToday || isSelected ? 'font-extrabold' : 'font-semibold')}>{d.getDate()}</span>
                  <span className="mt-1 flex gap-0.5">
                    {tones.map((t) => (
                      <span key={t} className={cx('size-1.5 rounded-full border border-ink', TONE_BG[t])} />
                    ))}
                  </span>
                </button>
              )
            })}
          </div>
          <div className="mt-2.5 flex flex-wrap gap-x-3 gap-y-1">
            {(Object.keys(EVENT_TYPES) as EventType[]).map((t) => (
              <span key={t} className="flex items-center gap-1 text-[11px] font-semibold text-subtle">
                <span className={cx('size-2.5 rounded-full border border-ink', TONE_BG[EVENT_TYPES[t].tone])} />
                {EVENT_TYPES[t].label}
              </span>
            ))}
          </div>
        </div>

        <section className="px-4 py-4">
          <SectionTitle
            aside={
              selected !== todayKey && (
                <button
                  type="button"
                  onClick={() => {
                    setSelected(todayKey)
                    setMonth(new Date(today.getFullYear(), today.getMonth(), 1))
                  }}
                  className="text-[12px] font-bold underline underline-offset-2"
                >
                  Back to today
                </button>
              )
            }
          >
            {selected === todayKey ? 'Today' : selectedDate.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}
          </SectionTitle>
          {dayItems.length ? (
            <ul className="space-y-2">
              {dayItems.map((it) => (it.kind === 'event' ? <EventRow key={it.event.id} event={it.event} now={now} onEdit={() => setEditing(it.event)} /> : <DueRow key={it.id} item={it} />))}
            </ul>
          ) : (
            <div className="rounded-xl border-2 border-dashed border-ink/40 px-3 py-5 text-center text-[13px] text-subtle">Nothing scheduled.</div>
          )}
          {next.length > 0 && selected === todayKey && dayItems.length === 0 && (
            <div className="mt-4">
              <MonoLabel className="mb-1.5 text-subtle">Coming up</MonoLabel>
              <ul className="space-y-2">
                {next.map((e) => (
                  <EventRow key={e.id} event={e} now={now} showDate onEdit={() => setEditing(e)} />
                ))}
              </ul>
            </div>
          )}
        </section>
      </main>
      <footer className="shrink-0 border-t-2 border-ink bg-canvas px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <BrutalistButton size="lg" variant="primary" icon={Plus} className="w-full" onClick={() => setEditing(newEvent())}>
          Add to {selected === todayKey ? 'today' : selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
        </BrutalistButton>
      </footer>
      {editing && <EventSheet initial={editing} isNew={!ws.events.some((e) => e.id === editing.id)} onClose={() => setEditing(null)} />}
    </div>
  )
}

function EventRow({ event: e, now, showDate, onEdit }: { event: CalendarEvent; now: number; showDate?: boolean; onEdit: () => void }) {
  const ws = useWorkspace()
  const beginScan = useStore((s) => s.beginScan)
  const navigate = useStore((s) => s.navigate)
  const showToast = useStore((s) => s.showToast)
  const startTimer = useSettings((s) => s.startTimer)
  const cls = ws.classes.find((c) => c.id === e.classId)
  const assessment = ws.assessments.find((a) => a.id === e.assessmentId)
  const start = Date.parse(e.startISO)
  const end = start + e.durationMin * 60000
  const live = !e.allDay && now >= start && now < end
  const past = !e.allDay && now >= end
  const timed = (e.type === 'exam' || e.type === 'quiz') && e.durationMin > 0
  const info = EVENT_TYPES[e.type]
  return (
    <li className={cx('overflow-hidden rounded-xl border-2 border-ink bg-surface shadow-brut-sm', past && 'opacity-60')}>
      <button type="button" onClick={onEdit} className="flex w-full items-stretch text-left">
        <span className={cx('w-2 shrink-0 border-r-2 border-ink', TONE_BG[info.tone])} aria-hidden />
        <span className="w-[68px] shrink-0 px-2.5 py-2.5">
          <span className="block text-[12.5px] leading-tight font-extrabold">{timeLabel(e)}</span>
          {!e.allDay && e.durationMin > 0 && <MonoLabel className="mt-0.5 text-subtle">{e.durationMin} min</MonoLabel>}
        </span>
        <span className="min-w-0 flex-1 py-2.5 pr-3">
          <span className="flex items-center gap-1.5">
            <span className={cx('rounded border-2 border-ink px-1 font-mono text-[9px] leading-[14px] font-bold uppercase', TONE_BG[info.tone])}>{info.label}</span>
            {live && <span className="rounded border-2 border-ink bg-mint px-1 font-mono text-[9px] leading-[14px] font-bold uppercase">Now</span>}
            {showDate && <MonoLabel className="text-subtle">{new Date(e.startISO).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}</MonoLabel>}
          </span>
          <span className="mt-0.5 block truncate text-[13.5px] font-bold">{e.title}</span>
          {cls && (
            <span className="mt-0.5 flex items-center gap-1 text-[11.5px] text-subtle">
              <span className={cx('size-2 rounded-full border border-ink', TONE_BG[levelTone(cls.level)])} />
              {classLabel(cls)}
            </span>
          )}
        </span>
      </button>
      {timed && !past && (
        <div className="grid grid-cols-2 gap-2 border-t-2 border-ink bg-canvas p-2">
          <BrutalistButton
            size="sm"
            variant="dark"
            icon={Timer}
            onClick={() => {
              startTimer({ label: e.title, assessmentId: e.assessmentId, classId: e.classId, durationMs: e.durationMin * 60000 })
              showToast(`${e.durationMin}-minute timer started`)
              navigate('timer')
            }}
          >
            Start timer
          </BrutalistButton>
          <BrutalistButton
            size="sm"
            variant="yellow"
            icon={Camera}
            disabled={!assessment?.key.questions.length}
            onClick={() => assessment && beginScan(assessment.id)}
          >
            Scan papers
          </BrutalistButton>
        </div>
      )}
    </li>
  )
}

function DueRow({ item }: { item: Extract<Item, { kind: 'due' }> }) {
  const ws = useWorkspace()
  const cls = ws.classes.find((c) => c.id === item.classId)
  return (
    <li className="flex items-center gap-3 rounded-xl border-2 border-dashed border-ink bg-coral/15 px-3 py-2.5">
      <Clock size={16} className="shrink-0" aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold">Due: {item.title}</span>
        <MonoLabel className="text-subtle">
          {new Date(item.iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
          {cls ? ` • ${classLabel(cls)}` : ''}
        </MonoLabel>
      </span>
    </li>
  )
}

function EventSheet({ initial, isNew, onClose }: { initial: CalendarEvent; isNew: boolean; onClose: () => void }) {
  const ws = useWorkspace()
  const upsertEvent = useStore((s) => s.upsertEvent)
  const removeEvent = useStore((s) => s.removeEvent)
  const showToast = useStore((s) => s.showToast)
  const start = new Date(initial.startISO)
  const pad = (n: number) => String(n).padStart(2, '0')
  const [title, setTitle] = useState(initial.title)
  const [type, setType] = useState<EventType>(initial.type)
  const [date, setDate] = useState(dayKey(start))
  const [time, setTime] = useState(`${pad(start.getHours())}:${pad(start.getMinutes())}`)
  const [allDay, setAllDay] = useState(initial.allDay)
  const [duration, setDuration] = useState(initial.durationMin || 60)
  const [classId, setClassId] = useState(initial.classId)
  const [assessmentId, setAssessmentId] = useState(initial.assessmentId)
  const [notes, setNotes] = useState(initial.notes)

  const assessments = ws.assessments.filter((a) => !classId || a.classId === classId)

  function save() {
    const when = new Date(`${date}T${allDay ? '00:00' : time}:00`)
    if (Number.isNaN(when.getTime())) return
    const linked = ws.assessments.find((a) => a.id === assessmentId)
    upsertEvent({
      ...initial,
      title: title.trim() || linked?.title || EVENT_TYPES[type].label,
      type,
      startISO: localIsoWithOffset(when),
      allDay,
      durationMin: allDay ? 0 : duration,
      classId,
      assessmentId,
      notes: notes.trim(),
    })
    showToast(isNew ? 'Added to your schedule' : 'Schedule updated')
    onClose()
  }

  return (
    <Sheet
      title={isNew ? 'New schedule item' : 'Edit schedule item'}
      subtitle={EVENT_TYPES[type].label}
      onClose={onClose}
      footer={
        <div className={cx('grid gap-2.5', isNew ? 'grid-cols-1' : 'grid-cols-[auto_1fr]')}>
          {!isNew && (
            <BrutalistButton
              variant="secondary"
              icon={Trash2}
              aria-label="Delete"
              onClick={() => {
                removeEvent(initial.id)
                showToast('Removed from your schedule')
                onClose()
              }}
            />
          )}
          <BrutalistButton variant="primary" onClick={save}>
            {isNew ? 'Add to schedule' : 'Save changes'}
          </BrutalistButton>
        </div>
      }
    >
      <div className="space-y-3">
        <div role="radiogroup" aria-label="Type" className="grid grid-cols-3 gap-1.5">
          {(Object.keys(EVENT_TYPES) as EventType[]).map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={type === t}
              onClick={() => setType(t)}
              className={cx(
                'press flex h-9 items-center justify-center gap-1.5 rounded-lg border-2 border-ink text-[12.5px] font-bold shadow-brut-sm',
                type === t ? TONE_BG[EVENT_TYPES[t].tone] : 'bg-surface',
              )}
            >
              {type !== t && <span className={cx('size-2.5 rounded-full border border-ink', TONE_BG[EVENT_TYPES[t].tone])} />}
              {EVENT_TYPES[t].label}
            </button>
          ))}
        </div>
        <label className="block">
          <span className="mb-1 block text-[13px] font-bold">Title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={80}
            placeholder={type === 'exam' ? 'e.g. Bio Midterm' : type === 'class' ? 'e.g. Cell division lab' : 'What is it?'}
            className={FIELD}
          />
        </label>
        <div className="flex items-center justify-between rounded-lg border-2 border-ink bg-surface px-3 py-2">
          <span className="text-[13.5px] font-bold">All day</span>
          <Switch checked={allDay} label="All day" onChange={setAllDay} />
        </div>
        <div className={cx('grid gap-2', allDay ? 'grid-cols-1' : 'grid-cols-2')}>
          <label className="block">
            <span className="mb-1 block text-[13px] font-bold">Date</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={FIELD} />
          </label>
          {!allDay && (
            <label className="block">
              <span className="mb-1 block text-[13px] font-bold">Starts</span>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} className={FIELD} />
            </label>
          )}
        </div>
        {!allDay && (
          <Select
            label="Length"
            value={String(duration)}
            options={DURATIONS.map((d) => ({ value: String(d), label: d < 60 ? `${d} minutes` : `${d / 60} ${d === 60 ? 'hour' : 'hours'}` }))}
            onChange={(v) => setDuration(Number(v))}
          />
        )}
        <Select
          label="Section"
          value={classId ?? ''}
          options={[
            { value: '', label: 'No section' },
            ...sortClasses(ws.classes).map((c) => ({ value: c.id, label: classLabel(c), hint: `${c.students.length} students`, tone: levelTone(c.level) })),
          ]}
          onChange={(v) => {
            setClassId(v || null)
            if (v && assessmentId && ws.assessments.find((a) => a.id === assessmentId)?.classId !== v) setAssessmentId(null)
          }}
        />
        {(type === 'exam' || type === 'quiz' || type === 'deadline') && (
          <Select
            label="Assessment"
            value={assessmentId ?? ''}
            options={[{ value: '', label: 'Not linked' }, ...assessments.map((a) => ({ value: a.id, label: a.title, hint: a.classLabel }))]}
            onChange={(v) => setAssessmentId(v || null)}
          />
        )}
        <label className="block">
          <span className="mb-1 block text-[13px] font-bold">Notes</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Room, materials, reminders…"
            className="w-full resize-none rounded-lg border-2 border-ink bg-surface p-2.5 text-[13.5px] outline-none focus:shadow-brut"
          />
        </label>
      </div>
    </Sheet>
  )
}

const FIELD = 'h-11 w-full rounded-lg border-2 border-ink bg-surface px-3 text-[15px] font-semibold outline-none focus:shadow-brut'
