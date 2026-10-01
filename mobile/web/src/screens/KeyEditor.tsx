import { ArrowLeft, Camera, Check, LoaderCircle, Minus, Plus } from 'lucide-react'
import { useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import { FlowFooter } from '../components/FlowHeader'
import { BrutalistButton, BrutalistCard, IconButton, MonoLabel, SectionTitle, cx } from '../components/ui'
import { fileToDataUrl, toJpegBlob } from '../lib/ocr'
import { classLabels } from '../lib/records'
import { formatHundredths, normalize, toHundredths, type KeyQuestion } from '../lib/scoring'
import { todayISODate } from '../lib/workspace'
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
  const connected = isConnected(session)
  const labels = classLabels(ws, !connected)

  const [title, setTitle] = useState('')
  const [classLabel, setClassLabel] = useState(labels[0] ?? '')
  const [date, setDate] = useState(todayISODate())
  const [mcCount, setMcCount] = useState(20)
  const [tfCount, setTfCount] = useState(5)
  const [mcPoints, setMcPoints] = useState('1.00')
  const [tfPoints, setTfPoints] = useState('1.00')
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [checked, setChecked] = useState(false)
  const [reading, setReading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

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
    !classLabel.trim() && 'a class',
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

  async function onPhoto(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
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
    if (!ready) return
    const a = saveAssessment({ title, classLabel, assessmentDate: date, questions })
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
      <header className="shrink-0 border-b-2 border-ink bg-canvas px-4 pt-3 pb-3">
        <div className="flex items-center gap-3">
          <IconButton label="Back" icon={ArrowLeft} onClick={() => back()} />
          <div className="min-w-0 flex-1">
            <MonoLabel className="text-subtle">Answer key • {connected ? 'uploads when saved' : 'saved on device'}</MonoLabel>
            <h1 className="truncate text-[17px] leading-tight font-extrabold">New assessment</h1>
          </div>
          <span className="h-10 w-2.5 rounded-full border-2 border-ink bg-sun" aria-hidden />
        </div>
      </header>

      <main className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <BrutalistCard className="space-y-3 p-3">
          <TextField label="Title" value={title} onChange={setTitle} placeholder="e.g. Bio Quiz 5" maxLength={200} />
          <div>
            <TextField label="Class" value={classLabel} onChange={setClassLabel} placeholder="e.g. G9 Bio · Sampaguita" maxLength={80} />
            {labels.length > 0 && (
              <div className="no-scrollbar -mx-3 mt-2 flex gap-1.5 overflow-x-auto px-3">
                {labels.map((label) => (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setClassLabel(label)}
                    className={cx(
                      'h-7 shrink-0 rounded-md border-2 border-ink px-2 text-[11.5px] font-bold whitespace-nowrap',
                      classLabel === label ? 'bg-sun' : 'bg-white',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <label className="block">
            <span className="mb-1 block text-[13px] font-bold">Date given</span>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="h-11 w-full rounded-lg border-2 border-ink bg-white px-3 text-[15px] outline-none focus:shadow-brut"
            />
          </label>
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
            onClick={() => fileRef.current?.click()}
          >
            {reading ? 'Reading the key…' : connected ? 'Fill from a photo of the key (online)' : 'Photo fill needs a GabAI account'}
          </BrutalistButton>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPhoto} />
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
                        q.correct_answer === o ? 'bg-ink text-white' : 'bg-white',
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
    </div>
  )
}

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
        className="h-11 w-full rounded-lg border-2 border-ink bg-white px-3 text-[15px] font-semibold outline-none focus:shadow-brut"
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
          className={cx('h-8 w-14 rounded-md border-2 border-ink px-1.5 text-center font-mono text-[12px] font-bold outline-none', bad ? 'bg-coral/20' : 'bg-white')}
        />
        <span className="font-mono text-[10px] font-bold text-subtle">PTS</span>
      </label>
    </div>
  )
}
