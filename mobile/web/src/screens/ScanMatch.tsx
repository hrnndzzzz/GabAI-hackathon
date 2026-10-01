import { ArrowRight, Check, CircleHelp, KeyRound, ServerCog, TriangleAlert, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ClassPicker } from '../components/ClassFields'
import { FlowFooter, FlowHeader, StepButtons } from '../components/FlowHeader'
import { useScanSteps } from '../components/flowSteps'
import { Badge, BrutalistButton, BrutalistCard, ChoiceCard, MonoLabel, ProgressBar, SectionTitle, cx } from '../components/ui'
import { api, describeError } from '../lib/api'
import { useBackHandler } from '../lib/back'
import { descriptor, formatPercent, partTotals } from '../lib/grading'
import { displayScore, formatHundredths, scorePercent, toHundredths, type ItemScore, type KeyQuestion } from '../lib/scoring'
import { isConnected, scoreScan, useStore, useWorkspace, type ScanSession } from '../store'

export const BADGE_FOR_TONE = { green: 'green', blue: 'blue', yellow: 'yellow', coral: 'urgent' } as const

export function ScanMatch() {
  const scan = useStore((s) => s.scan) as ScanSession
  const ws = useWorkspace()
  const connected = useStore((s) => isConnected(s.session))
  const setScanAssessment = useStore((s) => s.setScanAssessment)
  const navigate = useStore((s) => s.navigate)
  const back = useStore((s) => s.back)
  const steps = useScanSteps()
  const [editing, setEditing] = useState<number | null>(null)
  const [check, setCheck] = useState<{ state: 'idle' | 'busy' | 'ok' | 'error'; message?: string }>({ state: 'idle' })

  const assessment = ws.assessments.find((a) => a.id === scan.assessmentId)!
  const [classId, setClassId] = useState<string | null>(assessment.classId)
  const inClass = ws.assessments.filter((a) => a.key.questions.length && (classId ? a.classId === classId : !a.classId))
  const questions = assessment.key.questions
  const score = scoreScan(scan, assessment)
  const percent = scorePercent(score)
  const grade = descriptor(percent)
  const answered = new Set(scan.answers.map((a) => a.number))
  const extra = [...answered].filter((n) => !questions.some((q) => q.number === n)).length
  const canCheck = connected && assessment.sync === 'synced'
  const fingerprint = `${assessment.id}|${score.final_score}|${score.unresolved_numbers.length}|${JSON.stringify(scan.adjustments)}`

  // A server verdict only applies to the score it checked.
  useEffect(() => setCheck({ state: 'idle' }), [fingerprint])

  async function serverCheck() {
    setCheck({ state: 'busy' })
    try {
      const numbers = new Set(questions.map((q) => q.number))
      const result = await api.previewScore(
        assessment.key.id,
        scan.answers.filter((a) => numbers.has(a.number)),
        scan.adjustments,
        { automatic_score: score.automatic_score, final_score: score.final_score, possible_score: score.possible_score, items: score.items },
      )
      setCheck({ state: 'ok', message: `Server agrees: ${displayScore(result.final_score)}/${displayScore(result.possible_score)}` })
    } catch (error) {
      setCheck({ state: 'error', message: describeError(error) })
    }
  }

  return (
    <div className="relative flex h-full flex-col">
      <FlowHeader step={3} total={4} label="Key matching" title="Match the answer key" tone="yellow" steps={steps} />
      <main className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <section>
          <SectionTitle>Course & section</SectionTitle>
          <ClassPicker classes={ws.classes} value={classId} onChange={setClassId} />
        </section>

        <section>
          <SectionTitle>Answer key</SectionTitle>
          {inClass.length === 0 && (
            <p className="rounded-xl border-2 border-dashed border-ink/40 px-3 py-4 text-center text-[13px] text-subtle">
              No answer key for this section yet. Pick another section, or create one from Quick Assessments.
            </p>
          )}
          <div role="radiogroup" aria-label="Assessment and answer key" className="space-y-2">
            {inClass.map((a) => (
              <ChoiceCard
                key={a.id}
                icon={KeyRound}
                selected={a.id === assessment.id}
                onSelect={() => setScanAssessment(a.id)}
                title={a.title}
                description={`${a.key.questions.length} items • ${displayScore(formatHundredths(a.key.questions.reduce((s, q) => s + toHundredths(q.points), 0)))} pts • ${a.assessmentDate}`}
                aside={
                  <Badge variant={a.key.verified ? 'green' : 'yellow'} mono>
                    {a.key.verified ? (a.key.version ? `v${a.key.version}` : 'Verified') : 'Unverified'}
                  </Badge>
                }
              />
            ))}
          </div>
          {(!assessment.key.verified || extra > 0) && (
            <div role="alert" className="mt-2.5 flex gap-2.5 rounded-xl border-2 border-ink bg-coral/25 p-3 text-[13px] leading-snug">
              <TriangleAlert size={18} className="mt-0.5 shrink-0" aria-hidden />
              <p>
                {!assessment.key.verified && 'This key is not verified, so the result cannot be approved yet. '}
                {extra > 0 && `${extra} answers on the paper have no matching question in this key and will be ignored.`}
              </p>
            </div>
          )}
        </section>

        <section>
          <SectionTitle>Auto-score breakdown</SectionTitle>
          <BrutalistCard className="p-4">
            <div className="flex items-end justify-between gap-3">
              <div>
                <MonoLabel className="text-subtle">{score.unresolved_numbers.length ? 'Partial score' : 'Final score'}</MonoLabel>
                <p className="mt-1 font-mono text-[34px] leading-none font-extrabold">
                  {displayScore(score.final_score)}
                  <span className="text-xl text-subtle">/{displayScore(score.possible_score)}</span>
                </p>
              </div>
              <div className="flex flex-col items-end gap-1.5">
                <p className="font-mono text-2xl leading-none font-extrabold">{formatPercent(percent)}</p>
                {score.unresolved_numbers.length ? (
                  <Badge variant="yellow">{score.unresolved_numbers.length} unresolved</Badge>
                ) : (
                  <Badge variant={BADGE_FOR_TONE[grade.tone]}>{grade.label}</Badge>
                )}
              </div>
            </div>
            <div className="mt-3">
              <ProgressBar value={percent} tone={grade.tone} />
            </div>
            <table className="mt-4 w-full text-[13px]">
              <thead>
                <tr className="border-b-2 border-ink text-left font-mono text-[10px] tracking-wider uppercase">
                  <th className="pb-1.5 font-semibold">Part</th>
                  <th className="pb-1.5 text-right font-semibold">Points</th>
                  <th className="pb-1.5 text-right font-semibold">Weight</th>
                </tr>
              </thead>
              <tbody>
                {partTotals(questions, score).map((p, i) => (
                  <tr key={p.kind} className="border-b border-line last:border-0">
                    <td className="py-2 font-semibold">
                      Part {['I', 'II', 'III'][i]} · {p.label}
                    </td>
                    <td className="py-2 text-right font-mono font-bold">
                      {p.earned}/{p.possible}
                    </td>
                    <td className="py-2 text-right font-mono">{p.weight}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {connected && (
              <div className="mt-3 border-t-2 border-dashed border-ink/20 pt-3">
                <BrutalistButton
                  size="sm"
                  variant="secondary"
                  icon={ServerCog}
                  className="w-full"
                  disabled={!canCheck || check.state === 'busy'}
                  onClick={() => void serverCheck()}
                >
                  {check.state === 'busy' ? 'Checking…' : canCheck ? 'Check score with the server' : 'Server check after the key uploads'}
                </BrutalistButton>
                {check.message && (
                  <p className={cx('mt-2 text-center text-xs font-semibold', check.state === 'ok' ? 'text-ink' : 'text-alert-ink')} role="status">
                    {check.message}
                  </p>
                )}
              </div>
            )}
          </BrutalistCard>
        </section>

        <section>
          <SectionTitle aside={<MonoLabel className="text-subtle">Tap to adjust</MonoLabel>}>Points per question</SectionTitle>
          <div className="grid grid-cols-5 gap-1.5">
            {score.items.map((item) => (
              <PointBox key={item.number} item={item} onClick={() => setEditing(item.number)} />
            ))}
          </div>
          <p className="mt-2 text-xs leading-snug text-subtle">
            An adjustment sets a new score for one confirmed answer and needs a reason; the automatic score is kept for the
            record. Dashed boxes are adjusted, “?” still needs confirming on the previous step.
          </p>
        </section>
      </main>
      <FlowFooter>
        <StepButtons onBack={() => back()}>
          <BrutalistButton variant="yellow" size="lg" className="w-full" iconRight={ArrowRight} onClick={() => navigate('scan-review')}>
            Review & Approve
          </BrutalistButton>
        </StepButtons>
      </FlowFooter>

      {editing !== null && (
        <AdjustSheet
          question={questions.find((q) => q.number === editing)!}
          item={score.items.find((i) => i.number === editing)!}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  )
}

function PointBox({ item, onClick }: { item: ItemScore; onClick: () => void }) {
  const full = item.final_score !== null && toHundredths(item.final_score) >= toHundredths(item.possible_score)
  const adjusted = item.adjusted_score !== null
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Question ${item.number}: ${item.resolved ? `${item.final_score} of ${item.possible_score}` : 'unresolved'}${adjusted ? ', adjusted' : ''}`}
      className={cx(
        'relative flex h-14 flex-col items-center justify-center rounded-md border-2 border-ink',
        !item.resolved ? 'bg-sun/60' : full ? 'bg-surface' : 'bg-coral/30',
        adjusted && 'border-dashed',
      )}
    >
      <span className="absolute top-0.5 left-1 font-mono text-[9px] font-bold text-ink/70">{item.number}</span>
      {!item.resolved ? (
        <CircleHelp size={16} strokeWidth={2.5} aria-hidden />
      ) : full ? (
        <Check size={16} strokeWidth={3} aria-hidden />
      ) : (
        <X size={16} strokeWidth={3} aria-hidden />
      )}
      <span className="font-mono text-[10px] font-bold">
        {item.final_score === null ? '–' : displayScore(item.final_score)}/{displayScore(item.possible_score)}
      </span>
    </button>
  )
}

function AdjustSheet({ question, item, onClose }: { question: KeyQuestion; item: ItemScore; onClose: () => void }) {
  const scan = useStore((s) => s.scan) as ScanSession
  const setAdjustment = useStore((s) => s.setAdjustment)
  const removeAdjustment = useStore((s) => s.removeAdjustment)
  const current = scan.adjustments.find((a) => a.number === question.number)
  const [score, setScore] = useState(current?.score ?? item.final_score ?? '')
  const [reason, setReason] = useState(current?.reason ?? '')
  useBackHandler(true, onClose)

  const answer = scan.answers.find((a) => a.number === question.number)
  const answerConfirmed = answer?.state === 'confirmed' || answer?.state === 'confirmed_blank'
  const valid = /^\d{1,6}(\.\d{1,2})?$/.test(score.trim()) && toHundredths(score.trim()) <= toHundredths(question.points)
  const reasonOk = reason.trim().length >= 3

  return (
    <div className="absolute inset-0 z-40 flex items-end bg-black/50" onClick={onClose}>
      <BrutalistCard shadow="lg" className="m-3 w-full animate-toast-in p-4" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Adjust question ${question.number}`}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-[16px] font-extrabold">Adjust Q{question.number}</p>
            <MonoLabel className="mt-0.5 text-subtle">
              Automatic {item.automatic_score === null ? '—' : displayScore(item.automatic_score)} of {displayScore(question.points)} pts
              {answer?.value ? ` • answered ${answer.value}` : ''} • key {question.correct_answer ?? '—'}
            </MonoLabel>
          </div>
          <button type="button" aria-label="Close" onClick={onClose} className="rounded-md p-1">
            <X size={18} />
          </button>
        </div>
        {!answerConfirmed ? (
          <p className="mt-3 rounded-lg border-2 border-ink bg-sun/40 px-3 py-2 text-[13px] leading-snug">
            Confirm this answer on the previous step first. Adjustments never resolve an unconfirmed answer.
          </p>
        ) : (
          <>
            <label className="mt-3 block">
              <span className="mb-1 block text-[13px] font-bold">New score (0 – {displayScore(question.points)})</span>
              <input
                inputMode="decimal"
                value={score}
                onChange={(e) => setScore(e.target.value)}
                className="h-11 w-full rounded-lg border-2 border-ink bg-surface px-3 font-mono text-[16px] font-bold outline-none focus:shadow-brut"
              />
            </label>
            <label className="mt-3 block">
              <span className="mb-1 block text-[13px] font-bold">Reason (kept in the record)</span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={2000}
                rows={2}
                placeholder="e.g. Accepted an alternate correct reading of the question"
                className="w-full resize-none rounded-lg border-2 border-ink bg-surface p-2.5 text-[13.5px] outline-none focus:shadow-brut"
              />
            </label>
            <div className="mt-3 grid grid-cols-2 gap-2.5">
              <BrutalistButton
                variant="secondary"
                disabled={!current}
                onClick={() => {
                  removeAdjustment(question.number)
                  onClose()
                }}
              >
                Remove
              </BrutalistButton>
              <BrutalistButton
                variant="yellow"
                disabled={!valid || !reasonOk}
                onClick={() => {
                  setAdjustment({ number: question.number, score: formatHundredths(toHundredths(score.trim())), reason: reason.trim() })
                  onClose()
                }}
              >
                Save
              </BrutalistButton>
            </div>
          </>
        )}
      </BrutalistCard>
    </div>
  )
}
