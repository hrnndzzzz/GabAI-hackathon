import { Maximize2, Minus, Pause, Play, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { useState } from 'react'
import { ScreenHeader } from '../components/FlowHeader'
import { Select } from '../components/Select'
import { BrutalistButton, BrutalistCard, IconButton, MonoLabel, SectionTitle, TONE_BG, cx } from '../components/ui'
import { useBackHandler } from '../lib/back'
import { classLabel, levelTone, type TeacherClass } from '../lib/classes'
import { formatClock, isRunning, remaining, timerTone, useSettings, type ExamTimer } from '../lib/settings'
import { useNow } from '../lib/useNow'
import { useWorkspace } from '../store'

const PRESETS = [15, 30, 45, 60, 90, 120]

const TONE_TEXT = { green: 'Plenty of time', yellow: 'Half time passed', coral: 'Final stretch' } as const

/** Countdown timers for exams, colour-coded by how much time is left. */
export function TimerScreen() {
  const ws = useWorkspace()
  const timers = useSettings((s) => s.timers)
  const startTimer = useSettings((s) => s.startTimer)
  const now = useNow(1000)
  const [minutes, setMinutes] = useState(60)
  const [assessmentId, setAssessmentId] = useState<string | null>(null)
  const [label, setLabel] = useState('')
  const [present, setPresent] = useState<string | null>(null)

  const assessment = ws.assessments.find((a) => a.id === assessmentId)
  const cls = ws.classes.find((c) => c.id === assessment?.classId)
  const presented = timers.find((t) => t.id === present)

  function start() {
    startTimer({
      label: label.trim() || assessment?.title || `${minutes}-minute exam`,
      assessmentId: assessment?.id ?? null,
      classId: assessment?.classId ?? null,
      durationMs: minutes * 60000,
    })
    setLabel('')
  }

  const sorted = [...timers].sort((a, b) => Number(isRunning(b, now)) - Number(isRunning(a, now)) || remaining(a, now) - remaining(b, now))

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader label="Exam timer" title="Countdowns" tone="ink" />
      <main className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        {sorted.length > 0 && (
          <section>
            <SectionTitle aside={<Legend />}>Running</SectionTitle>
            <ul className="space-y-3">
              {sorted.map((t) => (
                <TimerCard key={t.id} timer={t} now={now} section={ws.classes.find((c) => c.id === t.classId)} onPresent={() => setPresent(t.id)} />
              ))}
            </ul>
          </section>
        )}

        <section>
          <SectionTitle>New timer</SectionTitle>
          <BrutalistCard className="space-y-4 p-4">
            <div>
              <MonoLabel className="mb-1.5 text-subtle">Length</MonoLabel>
              <div className="flex items-center gap-3">
                <IconButton label="5 minutes less" icon={Minus} onClick={() => setMinutes((m) => Math.max(5, m - 5))} />
                <p className="flex-1 text-center font-mono text-[34px] leading-none font-extrabold tabular-nums">
                  {formatClock(minutes * 60000)}
                </p>
                <IconButton label="5 minutes more" icon={Plus} onClick={() => setMinutes((m) => Math.min(300, m + 5))} />
              </div>
              <div className="mt-3 grid grid-cols-6 gap-1.5">
                {PRESETS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-pressed={minutes === p}
                    onClick={() => setMinutes(p)}
                    className={cx('press h-8 rounded-md border-2 border-ink text-[12px] font-bold shadow-brut-sm', minutes === p ? 'bg-ink text-surface' : 'bg-surface')}
                  >
                    {p < 60 ? `${p}m` : `${p / 60}h`}
                  </button>
                ))}
              </div>
            </div>
            <Select
              label="For assessment (optional)"
              value={assessmentId}
              placeholder="Not linked"
              options={[
                { value: '', label: 'Not linked', hint: 'A general countdown' },
                ...ws.assessments.map((a) => {
                  const c = ws.classes.find((x) => x.id === a.classId)
                  return { value: a.id, label: a.title, hint: c ? classLabel(c) : a.classLabel, tone: c ? levelTone(c.level) : undefined }
                }),
              ]}
              onChange={(v) => setAssessmentId(v || null)}
            />
            <label className="block">
              <span className="mb-1 block text-[13px] font-bold">Label</span>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder={assessment?.title ?? 'e.g. Biology Midterm, Part II'}
                maxLength={60}
                className="h-11 w-full rounded-lg border-2 border-ink bg-surface px-3 text-[15px] font-semibold outline-none focus:shadow-brut"
              />
            </label>
            {cls && <MonoLabel className="text-subtle">{classLabel(cls)} • {cls.students.length} students</MonoLabel>}
          </BrutalistCard>
        </section>
      </main>
      <footer className="shrink-0 border-t-2 border-ink bg-canvas px-4 pt-3 pb-[max(12px,env(safe-area-inset-bottom))]">
        <BrutalistButton size="lg" variant="dark" icon={Play} className="w-full" onClick={start}>
          Start {minutes}-minute timer
        </BrutalistButton>
      </footer>
      {presented && <Present timer={presented} now={now} onClose={() => setPresent(null)} />}
    </div>
  )
}

function Legend() {
  return (
    <span className="flex items-center gap-2" aria-label="Green: over half the time left. Yellow: under half. Coral: under a quarter.">
      {(
        [
          ['green', '>½'],
          ['yellow', '<½'],
          ['coral', '<¼'],
        ] as const
      ).map(([t, label]) => (
        <span key={t} className="flex items-center gap-1" aria-hidden>
          <span className={cx('size-3 rounded-full border-2 border-ink', TONE_BG[t])} />
          <span className="font-mono text-[10px] font-bold text-subtle">{label}</span>
        </span>
      ))}
    </span>
  )
}

function TimerCard({ timer: t, now, section, onPresent }: { timer: ExamTimer; now: number; section?: TeacherClass; onPresent: () => void }) {
  const { pauseTimer, resumeTimer, addTime, resetTimer, removeTimer } = useSettings()
  const left = remaining(t, now)
  const running = isRunning(t, now)
  const finished = left <= 0
  const tone = timerTone(t, now)
  const pct = t.durationMs ? (left / t.durationMs) * 100 : 0
  return (
    <li className={cx('overflow-hidden rounded-2xl border-2 border-ink shadow-brut', TONE_BG[tone], finished && 'animate-pulse')}>
      <div className="flex items-start gap-3 p-3 pb-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-[14px] font-extrabold">{t.label}</p>
          <MonoLabel className="truncate text-ink/75">
            {finished ? "Time's up" : running ? TONE_TEXT[tone] : 'Paused'}
            {section ? ` • ${classLabel(section)}` : ''}
          </MonoLabel>
        </div>
        <IconButton label="Show full screen" icon={Maximize2} className="size-9" onClick={onPresent} />
      </div>
      <p className="px-3 font-mono text-[46px] leading-none font-extrabold tabular-nums" aria-live="off">
        {formatClock(left)}
      </p>
      <div className="mx-3 mt-2.5 h-2.5 overflow-hidden rounded-full border-2 border-ink bg-white/70">
        <div className="h-full bg-[#1a1a1a]/80" style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-4 gap-2 border-t-2 border-ink bg-ink/10 p-2.5">
        {finished ? (
          <BrutalistButton size="sm" variant="secondary" icon={RotateCcw} onClick={() => resetTimer(t.id)}>
            Again
          </BrutalistButton>
        ) : running ? (
          <BrutalistButton size="sm" variant="secondary" icon={Pause} onClick={() => pauseTimer(t.id)}>
            Pause
          </BrutalistButton>
        ) : (
          <BrutalistButton size="sm" variant="dark" icon={Play} onClick={() => resumeTimer(t.id)}>
            Go
          </BrutalistButton>
        )}
        <BrutalistButton size="sm" variant="secondary" icon={Plus} onClick={() => addTime(t.id, 5 * 60000)}>
          5m
        </BrutalistButton>
        <BrutalistButton size="sm" variant="secondary" icon={RotateCcw} aria-label="Reset" disabled={finished} onClick={() => resetTimer(t.id)} />
        <BrutalistButton size="sm" variant="secondary" icon={Trash2} aria-label="Remove timer" onClick={() => removeTimer(t.id)} />
      </div>
    </li>
  )
}

/** Big, high-contrast countdown for showing the class (or a projector). */
function Present({ timer: t, now, onClose }: { timer: ExamTimer; now: number; onClose: () => void }) {
  useBackHandler(true, onClose)
  const { pauseTimer, resumeTimer } = useSettings()
  const left = remaining(t, now)
  const running = isRunning(t, now)
  const tone = timerTone(t, now)
  return (
    <div role="dialog" aria-label={`${t.label} countdown`} className={cx('absolute inset-0 z-50 flex flex-col p-5 text-[#1a1a1a]', TONE_BG[tone])}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <MonoLabel>{left <= 0 ? "Time's up" : running ? TONE_TEXT[tone] : 'Paused'}</MonoLabel>
          <p className="mt-1 text-[22px] leading-tight font-extrabold">{t.label}</p>
        </div>
        <IconButton label="Close full screen" icon={X} onClick={onClose} />
      </div>
      <button
        type="button"
        onClick={() => (left <= 0 ? undefined : running ? pauseTimer(t.id) : resumeTimer(t.id))}
        className="flex flex-1 items-center justify-center"
        aria-label={running ? 'Pause' : 'Resume'}
      >
        <span className={cx('font-mono leading-none font-extrabold tabular-nums', left >= 3600000 ? 'text-[84px]' : 'text-[112px]')}>{formatClock(left)}</span>
      </button>
      <p className="text-center text-[13px] font-bold opacity-80">{left <= 0 ? 'Pens down.' : running ? 'Tap the time to pause' : 'Tap the time to resume'}</p>
    </div>
  )
}
