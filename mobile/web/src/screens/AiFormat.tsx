import { CircleCheck, Feather, FileCode2, FileText, Layers, LoaderCircle, Sheet, Sparkles, TrendingUp, TriangleAlert, type LucideIcon } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { FlowFooter, FlowHeader } from '../components/FlowHeader'
import { BrutalistButton, BrutalistCard, ChoiceCard, IconTile, MonoLabel, SectionTitle, accentVariant, cx } from '../components/ui'
import { useBackHandler } from '../lib/back'
import { LEVELS, gradeLabel, levelOf } from '../lib/levels'
import { FORMATS, MODES, TIERS, type ExportFormat, type Tier } from '../lib/lessons'
import { isConnected, useStore } from '../store'
import { MODE_ICONS } from './AiParams'

const TIER_ICONS: Record<Tier, LucideIcon> = { standard: Layers, remedial: Feather, honors: TrendingUp }
const FORMAT_ICONS: Record<ExportFormat, LucideIcon> = { pdf: FileText, markdown: FileCode2, csv: Sheet }

export function AiFormat() {
  const params = useStore((s) => s.aiParams)
  const setAiParams = useStore((s) => s.setAiParams)
  const generateDraft = useStore((s) => s.generate)
  const navigate = useStore((s) => s.navigate)
  const connected = useStore((s) => isConnected(s.session))
  const tone = LEVELS[levelOf(params)].tone
  const [stage, setStage] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timers = useRef<number[]>([])

  const steps = connected
    ? ['Sending your request to the GabAI server', 'Gemini is drafting the sections', 'Checking the draft against the format', 'Saving it as an editable draft']
    : [
        'Loading demo templates on device',
        `Drafting ${MODES[params.mode].label.toLowerCase()} sections`,
        `Applying ${TIERS[params.tier].label} differentiation`,
        `Formatting for ${FORMATS[params.format].label}`,
      ]

  function clearTimers() {
    timers.current.forEach(clearTimeout)
    timers.current = []
  }
  function cancel() {
    clearTimers()
    setStage(null)
  }
  // An online request cannot be taken back (it is billed and saved), so back is ignored while it runs.
  useBackHandler(stage !== null, connected ? () => undefined : cancel)
  useEffect(() => clearTimers, [])

  function finish() {
    clearTimers()
    setStage(steps.length - 1)
    timers.current = [window.setTimeout(() => {
      setStage(null)
      navigate('ai-draft')
    }, 350)]
  }

  function generate() {
    setError(null)
    setStage(0)
    if (connected) {
      timers.current = [window.setTimeout(() => setStage(1), 700), window.setTimeout(() => setStage(2), 8000)]
      generateDraft()
        .then(finish)
        .catch((e: unknown) => {
          clearTimers()
          setStage(null)
          setError(e instanceof Error ? e.message : 'Generation failed')
        })
      return
    }
    timers.current = steps.slice(1).map((_, i) => window.setTimeout(() => setStage(i + 1), 480 * (i + 1)))
    timers.current.push(window.setTimeout(() => void generateDraft().then(finish), 480 * steps.length))
  }

  const ModeIcon = MODE_ICONS[params.mode]

  return (
    <div className="relative flex h-full flex-col">
      <FlowHeader step={2} total={3} label="Format & tiers" title="Shape the output" tone={tone} />
      <main className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <BrutalistCard color={tone} shadow="sm" className="flex items-center gap-3 p-3">
          <IconTile icon={ModeIcon} size={38} />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">{params.topic}</p>
            <MonoLabel className="mt-0.5 text-ink/80">
              {MODES[params.mode].label} • {gradeLabel(levelOf(params), params.grade)} • {params.subject}
            </MonoLabel>
          </div>
        </BrutalistCard>

        <section>
          <SectionTitle>Differentiation tier</SectionTitle>
          <div role="radiogroup" aria-label="Differentiation tier" className="space-y-2">
            {(Object.keys(TIERS) as Tier[]).map((tier) => (
              <ChoiceCard
                key={tier}
                tone={tone}
                icon={TIER_ICONS[tier]}
                selected={params.tier === tier}
                onSelect={() => setAiParams({ tier })}
                title={TIERS[tier].label}
                description={TIERS[tier].description}
              />
            ))}
          </div>
        </section>

        <section>
          <SectionTitle>Export format</SectionTitle>
          <div role="radiogroup" aria-label="Export format" className="space-y-2">
            {(Object.keys(FORMATS) as ExportFormat[]).map((format) => (
              <ChoiceCard
                key={format}
                tone={tone}
                icon={FORMAT_ICONS[format]}
                selected={params.format === format}
                onSelect={() => setAiParams({ format })}
                title={FORMATS[format].label}
                description={FORMATS[format].description}
                aside={<MonoLabel className="text-ink/70">.{FORMATS[format].ext}</MonoLabel>}
              />
            ))}
          </div>
        </section>
      </main>
      <FlowFooter
        note={
          error ? (
            <p role="alert" className="flex items-start gap-2 rounded-lg border-2 border-ink bg-coral/25 px-3 py-2 text-[13px] leading-snug font-semibold">
              <TriangleAlert size={16} className="mt-0.5 shrink-0" aria-hidden /> {error}
            </p>
          ) : null
        }
      >
        <BrutalistButton variant={accentVariant(tone)} size="lg" className="w-full" icon={Sparkles} onClick={generate} disabled={stage !== null}>
          Generate Draft
        </BrutalistButton>
      </FlowFooter>

      {stage !== null && (
        <div className="absolute inset-0 z-40 flex items-end bg-ink/45 p-4 pb-[max(16px,env(safe-area-inset-bottom))]">
          <BrutalistCard shadow="lg" className="w-full animate-toast-in p-4" role="status" aria-live="polite">
            <div className="flex items-center gap-3">
              <IconTile icon={Sparkles} tone={tone} size={40} />
              <div>
                <p className="text-[15px] font-bold">Synthesizing your draft</p>
                <MonoLabel className="text-subtle">{connected ? 'Gemini • online' : 'Demo • on device'}</MonoLabel>
              </div>
            </div>
            <ul className="mt-4 space-y-2.5">
              {steps.map((label, i) => (
                <li key={label} className={cx('flex items-center gap-2.5 text-[13px]', i > stage && 'text-subtle')}>
                  {i < stage ? (
                    <CircleCheck size={18} className="text-leaf" aria-hidden />
                  ) : i === stage ? (
                    <LoaderCircle size={18} className="animate-spin" aria-hidden />
                  ) : (
                    <span className="size-[18px] rounded-full border-2 border-muted" aria-hidden />
                  )}
                  {label}
                </li>
              ))}
            </ul>
            {connected ? (
              <p className="mt-4 text-center text-xs text-subtle">Online drafts usually take 10–40 seconds.</p>
            ) : (
              <BrutalistButton variant="secondary" size="sm" className="mt-4 w-full" onClick={cancel}>
                Cancel
              </BrutalistButton>
            )}
          </BrutalistCard>
        </div>
      )}
    </div>
  )
}
