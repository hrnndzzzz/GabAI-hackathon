import { ArrowLeft, Check, PenLine, TriangleAlert } from 'lucide-react'
import { FlowFooter, FlowHeader } from '../components/FlowHeader'
import { useScanSteps } from '../components/flowSteps'
import { Badge, BrutalistButton, BrutalistCard, MonoLabel, ProgressBar, cx } from '../components/ui'
import { capitalize, initials } from '../lib/format'
import { buildFeedback, descriptor, formatPercent, type FeedbackOptions } from '../lib/grading'
import { displayScore, scorePercent, toHundredths } from '../lib/scoring'
import { isConnected, scoreScan, useStore, useWorkspace, type ScanSession } from '../store'
import { BADGE_FOR_TONE } from './ScanMatch'

const SUGGESTIONS: { key: keyof FeedbackOptions; label: string }[] = [
  { key: 'warm', label: 'Warmer tone' },
  { key: 'nextStep', label: 'Add next step' },
  { key: 'short', label: 'Make it shorter' },
  { key: 'bilingual', label: 'Add Filipino' },
]

export function ScanReview() {
  const scan = useStore((s) => s.scan) as ScanSession
  const ws = useWorkspace()
  const connected = useStore((s) => isConnected(s.session))
  const setFeedback = useStore((s) => s.setFeedback)
  const setFeedbackOpts = useStore((s) => s.setFeedbackOpts)
  const approveScan = useStore((s) => s.approveScan)
  const beginScan = useStore((s) => s.beginScan)
  const resetTo = useStore((s) => s.resetTo)
  const back = useStore((s) => s.back)
  const showToast = useStore((s) => s.showToast)
  const openRecords = useStore((s) => s.openRecords)
  const steps = useScanSteps()

  const assessment = ws.assessments.find((a) => a.id === scan.assessmentId)!
  const score = scoreScan(scan, assessment)
  const percent = scorePercent(score)
  const grade = descriptor(percent)
  const text = scan.feedback ?? buildFeedback(scan.student, score, assessment.topics, scan.feedbackOpts)
  const edited = scan.feedback !== null
  const missed = score.items.filter((i) => i.final_score !== null && toHundredths(i.final_score) < toHundredths(i.possible_score))
  const adjusted = scan.adjustments.length
  const nameMissing = !scan.student.trim()
  const blockers = [
    !assessment.key.verified && 'the answer key is not verified',
    score.unresolved_numbers.length > 0 &&
      `${score.unresolved_numbers.length} ${score.unresolved_numbers.length === 1 ? 'answer needs' : 'answers need'} confirming (Q${score.unresolved_numbers.slice(0, 5).join(', Q')}${score.unresolved_numbers.length > 5 ? '…' : ''})`,
    nameMissing && 'the student name is empty',
  ].filter(Boolean) as string[]
  const leftAfter = scan.paperCount && scan.paperNumber ? Math.max(0, scan.paperCount - scan.paperNumber) : null

  function toggleSuggestion(k: keyof FeedbackOptions) {
    const prevText = scan.feedback
    const prevOpts = scan.feedbackOpts
    setFeedbackOpts({ ...prevOpts, [k]: !prevOpts[k] })
    setFeedback(null)
    if (prevText !== null) {
      showToast('Feedback regenerated. Your manual edits were replaced.', {
        label: 'Undo',
        run: () => {
          setFeedbackOpts(prevOpts)
          setFeedback(prevText)
        },
      })
    }
  }

  function approve(next: 'scan' | 'records') {
    let saved
    try {
      saved = approveScan()
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not approve')
      return
    }
    const where = connected ? 'queued for upload' : 'saved on this device'
    if (next === 'scan' && (leftAfter === null || leftAfter > 0)) {
      beginScan(assessment.id, { resetStack: true })
      showToast(`Approved ${saved.studentLabel} • ${displayScore(saved.score.final_score)}/${displayScore(saved.score.possible_score)}, ${where}`)
    } else {
      resetTo(['hub'])
      openRecords(assessment.classId)
      showToast(`Approved ${saved.studentLabel} • ${where}`)
    }
  }

  return (
    <div className="flex h-full flex-col">
      <FlowHeader step={4} total={4} label="Review & approve" title="Approve the grade" tone="yellow" steps={steps} />
      <main className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        <BrutalistCard shadow="lg" className="overflow-hidden">
          <div className="flex items-center gap-3 border-b-2 border-ink bg-sun p-3">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-full border-2 border-ink bg-surface font-extrabold">
              {initials(scan.student) || '?'}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[17px] font-extrabold">{scan.student.trim() || 'Unnamed student'}</p>
              <MonoLabel className="mt-0.5 truncate text-ink/80">
                {assessment.classLabel} • {assessment.title}
              </MonoLabel>
            </div>
          </div>
          <div className="p-4">
            <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold">
              Score:
              <span className="font-mono text-[30px] leading-none font-extrabold">
                {displayScore(score.final_score)}/{displayScore(score.possible_score)}
              </span>
              <span className="font-mono text-lg font-bold">({formatPercent(percent)})</span>
            </p>
            <div className="mt-2.5 flex flex-wrap items-center gap-2">
              {blockers.length ? <Badge variant="yellow">Not approvable yet</Badge> : <Badge variant={BADGE_FOR_TONE[grade.tone]}>{grade.label}</Badge>}
              <MonoLabel className="text-subtle">
                {missed.length} missed • {adjusted} adjusted
              </MonoLabel>
            </div>
            <div className="mt-3">
              <ProgressBar value={percent} tone={grade.tone} />
            </div>
            {missed.length > 0 && (
              <ul className="mt-3.5 space-y-1.5">
                {missed.map((m) => {
                  const q = assessment.key.questions.find((x) => x.number === m.number)
                  const given = scan.answers.find((a) => a.number === m.number)
                  return (
                    <li key={m.number} className="flex items-center gap-2 text-[13px]">
                      <span className="rounded-md border-2 border-ink bg-coral/30 px-1.5 font-mono text-[11px] font-bold">Q{m.number}</span>
                      <span className="min-w-0 flex-1 truncate">{capitalize(assessment.topics[m.number] ?? (q?.kind === 'true_false' ? 'True or false' : 'Multiple choice'))}</span>
                      <span className="shrink-0 font-mono text-[11px] text-subtle">
                        {given?.state === 'confirmed_blank' ? 'blank' : (given?.value ?? '—')} → {q?.correct_answer ?? '—'}
                      </span>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </BrutalistCard>

        {blockers.length > 0 && (
          <div role="alert" className="flex gap-2.5 rounded-xl border-2 border-ink bg-sun/50 p-3 text-[13px] leading-snug">
            <TriangleAlert size={18} className="mt-0.5 shrink-0" aria-hidden />
            <div className="min-w-0">
              <p>Before approving: {blockers.join('; ')}.</p>
              <button type="button" onClick={() => back()} className="mt-1 font-bold underline underline-offset-2">
                Go back and fix
              </button>
            </div>
          </div>
        )}

        <BrutalistCard className="overflow-hidden">
          <div className="flex items-center justify-between border-b-2 border-ink bg-canvas px-3 py-2">
            <span className="flex items-center gap-2 text-sm font-bold">
              <PenLine size={16} aria-hidden /> Feedback for the student
            </span>
            <MonoLabel>{edited ? 'Edited by you' : 'Drafted on device'}</MonoLabel>
          </div>
          <div className="p-3">
            <textarea
              value={text}
              onChange={(e) => setFeedback(e.target.value)}
              aria-label={`Feedback for ${scan.student}`}
              className="min-h-32 w-full resize-none rounded-lg border-2 border-ink bg-surface p-3 text-[13.5px] leading-relaxed outline-none [field-sizing:content] focus:shadow-brut"
            />
            <MonoLabel className="mt-3 mb-2 text-subtle">One-tap suggestions</MonoLabel>
            <div className="flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => {
                const on = scan.feedbackOpts[s.key]
                return (
                  <button
                    key={s.key}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleSuggestion(s.key)}
                    className={cx(
                      'press inline-flex h-8 items-center gap-1.5 rounded-lg border-2 border-ink px-2.5 text-xs font-bold shadow-brut-sm',
                      on ? 'bg-sun' : 'bg-surface',
                    )}
                  >
                    {on && <Check size={13} strokeWidth={3} aria-hidden />}
                    {s.label}
                  </button>
                )
              })}
            </div>
            <p className="mt-2.5 text-[11.5px] text-subtle">Feedback stays on this device; only the answers and score are uploaded.</p>
          </div>
        </BrutalistCard>
      </main>
      <FlowFooter
        note={
          <MonoLabel className="text-center text-subtle">
            {scan.paperNumber ? `Paper ${scan.paperNumber} of ${scan.paperCount} • ${leftAfter} left after this` : connected ? 'Approved results upload automatically' : 'Results stay on this device'}
          </MonoLabel>
        }
      >
        <div className="grid grid-cols-[auto_1fr] gap-2.5">
          <BrutalistButton size="lg" variant="secondary" icon={ArrowLeft} aria-label="Previous step" onClick={() => back()} className="px-3" />
          <BrutalistButton variant="yellow" size="lg" className="min-w-0" disabled={blockers.length > 0} onClick={() => approve('scan')}>
            {leftAfter === 0 ? 'Approve & Finish' : 'Approve & Next paper'}
          </BrutalistButton>
        </div>
        <BrutalistButton size="sm" variant="secondary" className="mt-2 w-full" disabled={blockers.length > 0} onClick={() => approve('records')}>
          Approve & save to Gradebook
        </BrutalistButton>
      </FlowFooter>
    </div>
  )
}
