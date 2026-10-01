import { ArrowRight, Check, CheckCheck, CloudUpload, Keyboard, LoaderCircle, PenLine, RotateCcw, TriangleAlert } from 'lucide-react'
import { useEffect, useState } from 'react'
import { FlowFooter, FlowHeader, StepButtons } from '../components/FlowHeader'
import { useScanSteps } from '../components/flowSteps'
import { Badge, BrutalistButton, BrutalistCard, MonoLabel, SectionTitle, cx } from '../components/ui'
import { normalize, type Answer, type KeyQuestion } from '../lib/scoring'
import { useStore, useWorkspace, type ScanSession } from '../store'

const SOURCE_LABEL = { camera: 'Camera capture', gallery: 'Gallery photo', sample: 'Sample paper' }
const RECOGNIZER_LABEL = { demo: 'Demo recognizer • simulated', gemini: 'Gemini OCR • online', manual: 'Typed by teacher' }
const STATE_LABEL: Record<string, string> = {
  recognized: 'Recognized',
  blank_candidate: 'Looks blank',
  ambiguous: 'Ambiguous',
  unreadable: 'Unreadable',
  confirmed: 'Confirmed',
  confirmed_blank: 'Confirmed blank',
  missing: 'Not found',
}

type Status = 'confirmed' | 'recognized' | 'review'

/** Recognized answers that already normalize can be bulk-confirmed; everything else needs a look. */
function statusOf(q: KeyQuestion, a: Answer | undefined): Status {
  if (!a) return 'review'
  if (a.state === 'confirmed' || a.state === 'confirmed_blank') return 'confirmed'
  if (a.state === 'recognized' && q.kind !== 'essay') {
    const v = normalize(a.value ?? '', q.kind)
    if (v && (q.kind !== 'multiple_choice' || (q.choices ?? []).includes(v))) return 'recognized'
  }
  return 'review'
}

export function ScanOcr() {
  const scan = useStore((s) => s.scan) as ScanSession
  const ws = useWorkspace()
  const navigate = useStore((s) => s.navigate)
  const back = useStore((s) => s.back)
  const steps = useScanSteps()
  const setScanStudent = useStore((s) => s.setScanStudent)
  const runOnlineOcr = useStore((s) => s.runOnlineOcr)
  const startManualEntry = useStore((s) => s.startManualEntry)
  const confirmAllRecognized = useStore((s) => s.confirmAllRecognized)
  const showToast = useStore((s) => s.showToast)
  const [selected, setSelected] = useState<number | null>(null)
  const [revealed, setRevealed] = useState(scan.recognizer !== 'demo')

  // The demo recognizer is instant; a short beat makes it read as work being done.
  useEffect(() => {
    if (revealed) return
    const t = setTimeout(() => setRevealed(true), 1200)
    return () => clearTimeout(t)
  }, [revealed])

  const assessment = ws.assessments.find((a) => a.id === scan.assessmentId)!
  const questions = assessment.key.questions
  const answerOf = (n: number) => scan.answers.find((a) => a.number === n)
  const statuses = questions.map((q) => statusOf(q, answerOf(q.number)))
  const confirmed = statuses.filter((s) => s === 'confirmed').length
  const recognized = statuses.filter((s) => s === 'recognized').length
  const review = statuses.filter((s) => s === 'review').length
  const parsed = questions.filter((q) => answerOf(q.number)?.extracted).length
  const done = scan.ocr.status === 'done' && revealed
  const touchUps = questions.filter((q, i) => statuses[i] === 'review' || q.number === selected)

  return (
    <div className="flex h-full flex-col">
      <FlowHeader step={2} total={4} label="OCR extraction" title="Check the answers" tone="yellow" steps={steps} />
      <main className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <BrutalistCard className="overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b-2 border-ink px-3 py-2">
            <MonoLabel>Original scan</MonoLabel>
            <MonoLabel className="truncate text-subtle">
              {scan.recognizer ? RECOGNIZER_LABEL[scan.recognizer] : scan.imageSource ? SOURCE_LABEL[scan.imageSource] : ''}
            </MonoLabel>
          </div>
          <div className="relative flex justify-center bg-line/70 p-3">
            {scan.image && <img src={scan.image} alt="Captured answer sheet" className="max-h-52 rounded-md border-2 border-ink bg-surface object-contain" />}
            {(!revealed || scan.ocr.status === 'running') && (
              <span className="absolute inset-x-6 h-0.5 animate-scan bg-brand shadow-[0_0_10px_#4D96FF]" />
            )}
          </div>
        </BrutalistCard>

        {scan.recognizer === null && scan.ocr.status === 'idle' && (
          <BrutalistCard className="p-4">
            <p className="text-[15px] font-bold">Read the answers</p>
            <p className="mt-1 text-[13px] leading-snug text-subtle">
              Online OCR sends this photo to the GabAI server, which asks Gemini to transcribe the marks. The photo is
              discarded afterwards and nothing is saved until you approve.
            </p>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <BrutalistButton variant="yellow" icon={CloudUpload} onClick={() => void runOnlineOcr()}>
                Read online
              </BrutalistButton>
              <BrutalistButton variant="secondary" icon={Keyboard} onClick={startManualEntry}>
                Type answers
              </BrutalistButton>
            </div>
          </BrutalistCard>
        )}

        {(scan.ocr.status === 'running' || !revealed) && (
          <BrutalistCard className="flex items-center gap-3 p-4" role="status" aria-live="polite">
            <LoaderCircle size={20} className="shrink-0 animate-spin" aria-hidden />
            <div>
              <p className="text-[15px] font-bold">{scan.recognizer === 'demo' ? 'Parsing on device…' : 'Reading answers with Gemini…'}</p>
              <p className="text-xs text-subtle">Mapping shaded bubbles to {questions.length} questions</p>
            </div>
          </BrutalistCard>
        )}

        {scan.ocr.status === 'failed' && (
          <div role="alert" className="rounded-xl border-2 border-ink bg-coral/25 p-3">
            <p className="flex items-center gap-2 text-[14px] font-bold">
              <TriangleAlert size={17} aria-hidden /> Online OCR didn't work
            </p>
            <p className="mt-1 text-[13px] leading-snug">{scan.ocr.error}</p>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <BrutalistButton size="sm" variant="yellow" icon={RotateCcw} onClick={() => void runOnlineOcr()}>
                Try again
              </BrutalistButton>
              <BrutalistButton size="sm" variant="secondary" icon={Keyboard} onClick={startManualEntry}>
                Type answers
              </BrutalistButton>
            </div>
          </div>
        )}

        {done && (
          <>
            <div className="flex flex-wrap gap-2">
              {scan.recognizer !== 'manual' && (
                <Badge mono>
                  {parsed} of {questions.length} Questions Parsed
                </Badge>
              )}
              <Badge variant={review ? 'yellow' : 'green'} mono>
                {review ? `${review} need review` : 'Nothing ambiguous'}
              </Badge>
              <Badge variant="green" mono>
                {confirmed} confirmed
              </Badge>
            </div>

            {!!scan.ocr.notes?.length && (
              <ul className="space-y-1 rounded-xl border-2 border-dashed border-ink/40 p-3 text-[12.5px] leading-snug">
                {scan.ocr.notes.map((n, i) => (
                  <li key={i}>• {n}</li>
                ))}
              </ul>
            )}

            <BrutalistCard className="p-3">
              <label htmlFor="ocr-student" className="flex items-center justify-between">
                <MonoLabel>Student name</MonoLabel>
                <PenLine size={14} aria-hidden />
              </label>
              <input
                id="ocr-student"
                value={scan.student}
                maxLength={120}
                onChange={(e) => setScanStudent(e.target.value)}
                placeholder="Type the name on the paper"
                className={cx(
                  'mt-1.5 h-11 w-full rounded-lg border-2 border-ink px-3 text-[15px] font-bold outline-none focus:shadow-brut',
                  scan.student.trim() ? 'bg-surface' : 'bg-sun/30',
                )}
              />
              <MonoLabel className="mt-2 text-subtle">Section: {assessment.classLabel}</MonoLabel>
            </BrutalistCard>

            {recognized > 0 && (
              <BrutalistButton
                variant="green"
                className="w-full"
                icon={CheckCheck}
                onClick={() => {
                  const n = confirmAllRecognized()
                  showToast(`Confirmed ${n} recognized ${n === 1 ? 'answer' : 'answers'}`)
                }}
              >
                I checked them: confirm {recognized} recognized
              </BrutalistButton>
            )}

            <section>
              <SectionTitle aside={<MonoLabel className="text-subtle">Tap a box to edit</MonoLabel>}>Answer regions</SectionTitle>
              <div className="grid grid-cols-5 gap-1.5">
                {questions.map((q, i) => (
                  <RegionBox key={q.number} q={q} answer={answerOf(q.number)} status={statuses[i]} selected={selected === q.number} onSelect={() => setSelected(q.number)} />
                ))}
              </div>
              <div className="mt-2 flex flex-wrap gap-3 font-mono text-[10px] font-semibold text-subtle">
                <Legend className="border-ink bg-sun" label="NEEDS REVIEW" />
                <Legend className="border-dashed border-ink/50 bg-surface" label="RECOGNIZED" />
                <Legend className="border-ink bg-mint" label="CONFIRMED" />
              </div>
            </section>

            {touchUps.length > 0 && (
              <section>
                <SectionTitle aside={<Badge variant={review ? 'yellow' : 'green'} mono>{review ? `${review} left` : 'All checked'}</Badge>}>Touch-ups</SectionTitle>
                <ul className="space-y-2.5">
                  {touchUps.map((q) => (
                    <ReviewItem key={q.number} q={q} answer={answerOf(q.number)} />
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
      <FlowFooter
        note={
          done && review + recognized > 0 ? (
            <p className="text-center text-xs text-subtle">
              {review + recognized} {review + recognized === 1 ? 'answer is' : 'answers are'} not confirmed yet. Approval needs every answer confirmed.
            </p>
          ) : null
        }
      >
        <StepButtons onBack={() => back()}>
          <BrutalistButton variant="yellow" size="lg" className="w-full" iconRight={ArrowRight} disabled={!done} onClick={() => navigate('scan-match')}>
            Match Answer Key
          </BrutalistButton>
        </StepButtons>
      </FlowFooter>
    </div>
  )
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className={cx('size-3 rounded-sm border-2', className)} /> {label}
    </span>
  )
}

function shortValue(q: KeyQuestion, a: Answer | undefined): string {
  if (!a) return '—'
  if (a.state === 'confirmed_blank' || a.state === 'blank_candidate') return 'Blank'
  if (a.state === 'unreadable' && !a.value) return '?'
  const v = a.value ?? ''
  if (q.kind === 'true_false' && (a.state === 'confirmed' || a.state === 'recognized')) return normalize(v, q.kind)?.[0] ?? v
  return v
}

function RegionBox({ q, answer, status, selected, onSelect }: { q: KeyQuestion; answer: Answer | undefined; status: Status; selected: boolean; onSelect: () => void }) {
  const value = shortValue(q, answer)
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`Question ${q.number}: ${value}, ${STATE_LABEL[answer?.state ?? 'missing']}`}
      className={cx(
        'relative flex h-11 items-center justify-center rounded-md border-2 px-1',
        status === 'review' ? 'border-ink bg-sun' : status === 'confirmed' ? 'border-ink bg-mint' : 'border-dashed border-ink/50 bg-surface',
        selected && 'outline-3 outline-offset-1 outline-brand',
      )}
    >
      <span className="absolute top-0.5 left-1 font-mono text-[9px] font-bold text-ink/70">{q.number}</span>
      <span className={cx('max-w-full truncate font-extrabold', value.length > 2 ? 'pt-1.5 text-[10px]' : 'text-[15px]')}>{value}</span>
    </button>
  )
}

function ReviewItem({ q, answer }: { q: KeyQuestion; answer: Answer | undefined }) {
  const setAnswer = useStore((s) => s.setAnswer)
  const initial = answer?.state === 'confirmed_blank' ? 'BLANK' : (normalize(answer?.value ?? '', q.kind) ?? '')
  const [value, setValue] = useState(initial)
  useEffect(() => setValue(initial), [initial])
  const options = q.kind === 'true_false' ? ['TRUE', 'FALSE'] : q.kind === 'multiple_choice' ? (q.choices ?? []) : []
  const extracted = answer?.extracted
  const isConfirmed = answer?.state === 'confirmed' || answer?.state === 'confirmed_blank'
  const unchanged = isConfirmed && value === initial
  const canConfirm = value === 'BLANK' || (q.kind === 'essay' ? value.trim().length > 0 : options.includes(value))

  function confirm() {
    if (value === 'BLANK') setAnswer(q.number, 'confirmed_blank', null)
    else setAnswer(q.number, 'confirmed', value)
  }

  return (
    <li className="rounded-xl border-2 border-ink bg-surface p-3 shadow-brut-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="min-w-0 text-sm font-bold">
          Q{q.number}{' '}
          <span className="font-mono text-[11px] font-semibold text-subtle">
            {extracted ? `• READ AS “${extracted.value ?? 'blank'}”` : '• NOT DETECTED'}
          </span>
        </p>
        <Badge variant={isConfirmed ? 'green' : 'yellow'} mono>
          {STATE_LABEL[answer?.state ?? 'missing']}
        </Badge>
      </div>
      {(extracted?.notes || !!extracted?.review_flags.length) && (
        <p className="mt-1.5 text-[12px] leading-snug text-subtle">
          {[...(extracted?.review_flags ?? []), extracted?.notes].filter(Boolean).join(' • ')}
        </p>
      )}
      <div className="mt-2.5 flex items-center gap-2">
        {q.kind === 'essay' ? (
          <input
            value={value === 'BLANK' ? '' : value}
            onChange={(e) => setValue(e.target.value)}
            aria-label={`Answer for question ${q.number}`}
            className="h-10 min-w-0 flex-1 rounded-lg border-2 border-ink bg-surface px-3 text-[14px] font-semibold outline-none focus:shadow-brut"
          />
        ) : (
          <div role="radiogroup" aria-label={`Answer for question ${q.number}`} className="flex min-w-0 flex-1 gap-1.5">
            {[...options, 'BLANK'].map((o) => (
              <button
                key={o}
                type="button"
                role="radio"
                aria-checked={value === o}
                onClick={() => setValue(o)}
                className={cx(
                  'h-10 min-w-0 flex-1 rounded-lg border-2 border-ink font-mono font-bold',
                  o === 'BLANK' || o.length > 1 ? 'text-[10.5px]' : 'text-[15px]',
                  value === o ? 'bg-ink text-surface' : 'bg-surface',
                )}
              >
                {o === 'BLANK' ? 'Blank' : q.kind === 'true_false' ? (o === 'TRUE' ? 'True' : 'False') : o}
              </button>
            ))}
          </div>
        )}
        <BrutalistButton
          size="sm"
          variant={unchanged ? 'green' : 'dark'}
          icon={Check}
          className="h-10"
          disabled={!canConfirm}
          onClick={confirm}
          aria-label={`Confirm answer for question ${q.number}`}
        >
          {unchanged ? 'Saved' : 'OK'}
        </BrutalistButton>
      </div>
    </li>
  )
}
