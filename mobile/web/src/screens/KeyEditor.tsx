import { Camera, Check, LoaderCircle, Minus, Plus } from 'lucide-react'
import { useMemo, useState, type ReactNode } from 'react'
import { ClassPicker, ClassSheet } from '../components/ClassFields'
import { FlowFooter, ScreenHeader } from '../components/FlowHeader'
import { usePhotoPicker } from '../components/PhotoPicker'
import { BrutalistButton, BrutalistCard, IconButton, MonoLabel, SectionTitle, Switch, cx } from '../components/ui'
import { sortClasses } from '../lib/classes'
import type { Level } from '../lib/levels'
import { fileToDataUrl, toJpegBlob } from '../lib/ocr'
import { formatHundredths, normalize, toHundredths, type KeyQuestion } from '../lib/scoring'
import { localIsoWithOffset, todayISODate } from '../lib/workspace'
import { isConnected, useStore, useWorkspace } from '../store'

const CHOICES = ['A', 'B', 'C', 'D']

function validPoints(text: string): string | null {
  if (!/^\d{1,5}(\.\d{1,2})?$/.test(text.trim())) return null
  const hundredths = toHundredths(text.trim())
  return hundredths >= 1 && hundredths <= 1000000 ? formatHundredths(hundredths) : null
}

/** New assessment with a teacher-verified MCQ / True-False answer key (essays are not supported here yet). */
export function KeyEditor() {
  const ws = useWorkspace()
  const session = useStore((s) => s.session)
  const saveAssessment = useStore((s) => s.saveAssessment)
  const readReferenceKey = useStore((s) => s.readReferenceKey)
  const back = useStore((s) => s.back)
  const resetTo = useStore((s) => s.resetTo)
  const beginScan = useStore((s) => s.beginScan)
  const showToast = useStore((s) => s.showToast)
  const upsertClass = useStore((s) => s.upsertClass)
  const connected = isConnected(session)

  const [title, setTitle] = useState('')
  const [classId, setClassId] = useState<string | null>(() => sortClasses(ws.classes)[0]?.id ?? null)
  const [addingSection, setAddingSection] = useState<{ level: Level; grade: number } | null>(null)
  const [date, setDate] = useState(todayISODate())
  const [hasDue, setHasDue] = useState(false)
  const [dueDate, setDueDate] = useState(todayISODate())
  const [dueTime, setDueTime] = useState('17:00')
  const [mcCount, setMcCount] = useState(20)
  const [tfCount, setTfCount] = useState(5)
  const [mcPoints, setMcPoints] = useState('1.00')
  const [tfPoints, setTfPoints] = useState('1.00')
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [checked, setChecked] = useState(false)
  const [reading, setReading] = useState(false)
  const photo = usePhotoPicker((file) => void onPhoto(file))

  const questions = useMemo<KeyQuestion[]>(() => {
    const list: KeyQuestion[] = []
    for (let n = 1; n <= mcCount; n++) {
      const answer = CHOICES.includes(answers[n]) ? answers[n] : null
      list.push({ number: n, kind: 'multiple_choice', points: validPoints(mcPoints) ?? '1.00', choices: CHOICES, correct_answer: answer, alternatives: [] })
    }
    for (let i = 1; i <= tfCount; i++) {
      const n = mcCount + i
      // Counts can change after answers were picked; only keep answers valid for this kind.
      const answer = answers[n] === 'TRUE' || answers[n] === 'FALSE' ? answers[n] : null
      list.push({ number: n, kind: 'true_false', points: validPoints(tfPoints) ?? '1.00', choices: [], correct_answer: answer, alternatives: [] })
    }
    return list
  }, [mcCount, tfCount, mcPoints, tfPoints, answers])

  const missing = questions.filter((q) => !q.correct_answer).length
  const total = formatHundredths(questions.reduce((s, q) => s + toHundredths(q.points), 0)).replace('.00', '')
  const problems = [
    !title.trim() && 'a title',
    !classId && 'a section',
    !date && 'a date',
    !questions.length && 'at least one question',
    (mcCount && !validPoints(mcPoints)) || (tfCount && !validPoints(tfPoints)) ? 'valid points' : false,
    missing > 0 && `${missing} more ${missing === 1 ? 'answer' : 'answers'}`,
  ].filter(Boolean) as string[]
  const ready = problems.length === 0 && checked

  function setAnswer(n: number, value: string) {
    setAnswers((a) => ({ ...a, [n]: value }))
    setChecked(false)
  }

  async function onPhoto(file: File) {
    setReading(true)
    try {
      const found = await readReferenceKey(await toJpegBlob(await fileToDataUrl(file)))
      let filled = 0
      const next = { ...answers }
      for (const q of questions) {
        const raw = found[q.number]
        if (!raw) continue
        const value = normalize(raw, q.kind)
        if (value && (q.kind !== 'multiple_choice' || CHOICES.includes(value))) {
          next[q.number] = value
          filled++
        }
      }
      setAnswers(next)
      setChecked(false)
      showToast(filled ? `Filled ${filled} answers from the photo. Check every one.` : 'No readable answers were found on that photo.')
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not read that photo')
    } finally {
      setReading(false)
    }
  }

  function save(scan: boolean) {
    if (!ready || !classId) return
    const due = hasDue ? new Date(`${dueDate}T${dueTime || '23:59'}:00`) : null
    const a = saveAssessment({
      title,
      classId,
      assessmentDate: date,
      dueISO: due && !Number.isNaN(due.getTime()) ? localIsoWithOffset(due) : null,
      questions,
    })
    showToast(connected ? `Saved ${a.title} • key verified, uploading` : `Saved ${a.title} on this device`)
    if (scan) {
      resetTo(['hub'])
      beginScan(a.id)
    } else {
      back()
    }
  }

  return (
    <div className="flex h-full flex-col">
      <ScreenHeader label={`Answer key • ${connected ? 'uploads when saved' : 'saved on this phone'}`} title="New assessment" tone="yellow" />

      <main className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <BrutalistCard className="space-y-3 p-3">
          <TextField label="Title" value={title} onChange={setTitle} placeholder="e.g. Bio Quiz 5" maxLength={200} />
          <div>
            <span className="mb-1 block text-[13px] font-bold">Section</span>
            <ClassPicker classes={ws.classes} value={classId} onChange={setClassId} onAddSection={setAddingSection} />
          </div>
          <label className="block">
            <span className="mb-1 block text-[13px] font-bold">Date given</span>
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={DATE_INPUT} />
          </label>
          <div className="rounded-lg border-2 border-ink bg-surface">
            <div className="flex items-center justify-between gap-3 px-3 py-2">
              <span>
                <span className="block text-[13px] font-bold">Due date</span>
                <span className="block text-xs text-subtle">Papers approved after this are marked late.</span>
              </span>
              <Switch checked={hasDue} label="Set a due date" onChange={setHasDue} />
            </div>
            {hasDue && (
              <div className="grid grid-cols-2 gap-2 border-t-2 border-ink/15 p-2">
                <input type="date" aria-label="Due date" value={dueDate} min={date} onChange={(e) => setDueDate(e.target.value)} className={DATE_INPUT} />
                <input type="time" aria-label="Due time" value={dueTime} onChange={(e) => setDueTime(e.target.value)} className={DATE_INPUT} />
              </div>
            )}
          </div>
        </BrutalistCard>

        <section>
          <SectionTitle aside={<MonoLabel className="text-subtle">{questions.length} items • {total} pts</MonoLabel>}>Structure</SectionTitle>
          <BrutalistCard shadow="sm" className="divide-y-2 divide-ink/10 p-0">
            <CountRow label="Multiple choice (A–D)" count={mcCount} setCount={setMcCount} points={mcPoints} setPoints={setMcPoints} />
            <CountRow label="True or False" count={tfCount} setCount={setTfCount} points={tfPoints} setPoints={setTfPoints} />
          </BrutalistCard>
        </section>

        <section>
          <SectionTitle aside={<MonoLabel className="text-subtle">{questions.length - missing}/{questions.length} set</MonoLabel>}>Correct answers</SectionTitle>
          <BrutalistButton
            variant="secondary"
            size="sm"
            className="mb-3 w-full"
            icon={reading ? LoaderCircle : Camera}
            disabled={!connected || reading}
            onClick={photo.pick}
          >
            {reading ? 'Reading the key…' : connected ? 'Fill from a photo of the key (online)' : 'Photo fill needs a GabAI account'}
          </BrutalistButton>
          {photo.element}
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            {questions.map((q) => {
              const options = q.kind === 'true_false' ? ['TRUE', 'FALSE'] : CHOICES
              return (
                <div key={q.number} role="radiogroup" aria-label={`Correct answer for question ${q.number}`} className="flex items-center gap-1">
                  <span className={cx('w-6 shrink-0 font-mono text-[11px] font-bold', !q.correct_answer && 'text-alert-ink')}>{q.number}</span>
                  {options.map((o) => (
                    <button
                      key={o}
                      type="button"
                      role="radio"
                      aria-checked={q.correct_answer === o}
                      aria-label={`${o}`}
                      onClick={() => setAnswer(q.number, o)}
                      className={cx(
                        'h-8 flex-1 rounded-md border-2 border-ink font-mono text-[12px] font-bold',
                        q.correct_answer === o ? 'bg-ink text-surface' : 'bg-surface',
                      )}
                    >
                      {q.kind === 'true_false' ? o[0] : o}
                    </button>
                  ))}
                </div>
              )
            })}
          </div>
        </section>
      </main>

      <FlowFooter
        note={
          <label className="flex items-start gap-2.5 text-[13px] leading-snug">
            <input
              type="checkbox"
              checked={checked}
              disabled={problems.length > 0}
              onChange={(e) => setChecked(e.target.checked)}
              className="mt-0.5 size-5 shrink-0 accent-ink"
            />
            <span>
              {problems.length ? (
                <>Still needed: {problems.join(', ')}.</>
              ) : (
                <>
                  <span className="font-bold">I checked every answer.</span> This verifies the key; results can then be approved.
                </>
              )}
            </span>
          </label>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <BrutalistButton variant="secondary" icon={Check} disabled={!ready} onClick={() => save(false)}>
            Save key
          </BrutalistButton>
          <BrutalistButton variant="yellow" icon={Camera} disabled={!ready} onClick={() => save(true)}>
            Save & scan
          </BrutalistButton>
        </div>
      </FlowFooter>
      {addingSection && (
        <ClassSheet
          defaults={addingSection}
          onClose={() => setAddingSection(null)}
          onSave={(c) => {
            upsertClass(c)
            setClassId(c.id)
            setAddingSection(null)
          }}
        />
      )}
    </div>
  )
}

const DATE_INPUT = 'h-11 w-full rounded-lg border-2 border-ink bg-surface px-3 text-[15px] outline-none focus:shadow-brut'

function TextField({
  label,
  value,
  onChange,
  placeholder,
  maxLength,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  maxLength: number
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-[13px] font-bold">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        maxLength={maxLength}
        className="h-11 w-full rounded-lg border-2 border-ink bg-surface px-3 text-[15px] font-semibold outline-none focus:shadow-brut"
      />
    </label>
  )
}

function CountRow({
  label,
  count,
  setCount,
  points,
  setPoints,
}: {
  label: string
  count: number
  setCount: (n: number) => void
  points: string
  setPoints: (p: string) => void
}): ReactNode {
  const bad = count > 0 && !validPoints(points)
  return (
    <div className="flex items-center gap-2 px-3 py-2.5">
      <span className="min-w-0 flex-1 text-[13px] leading-tight font-bold">{label}</span>
      <div className="flex items-center gap-1">
        <IconButton label={`Fewer ${label} questions`} icon={Minus} className="size-8" onClick={() => setCount(Math.max(0, count - 1))} />
        <span className="w-7 text-center font-mono text-sm font-extrabold" aria-live="polite">
          {count}
        </span>
        <IconButton label={`More ${label} questions`} icon={Plus} className="size-8" onClick={() => setCount(Math.min(100, count + 1))} />
      </div>
      <label className="flex items-center gap-1">
        <input
          inputMode="decimal"
          value={points}
          onChange={(e) => setPoints(e.target.value)}
          aria-label={`Points per ${label} question`}
          aria-invalid={bad}
          className={cx('h-8 w-14 rounded-md border-2 border-ink px-1.5 text-center font-mono text-[12px] font-bold outline-none', bad ? 'bg-coral/20' : 'bg-surface')}
        />
        <span className="font-mono text-[10px] font-bold text-subtle">PTS</span>
      </label>
    </div>
  )
}
