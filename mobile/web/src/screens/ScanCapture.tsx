import { Camera, Image as ImageIcon, X, Zap, ZapOff } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { MonoLabel, cx } from '../components/ui'
import { setDarkChrome } from '../lib/native'
import { demoRecognize, fileToDataUrl, renderPaperSvg } from '../lib/ocr'
import { useStore, useWorkspace, type CaptureSource, type ScanSession } from '../store'

type CamState = 'starting' | 'live' | 'unavailable'

const PAPER = { A4: 210 / 297, Letter: 8.5 / 11 } as const
// Transparent 1×1 GIF: hides the WebView's default play-button poster while the stream starts.
const BLANK_POSTER = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='

export function ScanCapture() {
  const scan = useStore((s) => s.scan) as ScanSession
  const setCapture = useStore((s) => s.setCapture)
  const back = useStore((s) => s.back)
  const showToast = useStore((s) => s.showToast)

  const [paper, setPaper] = useState<keyof typeof PAPER>('A4')
  const [cam, setCam] = useState<CamState>('starting')
  const [locked, setLocked] = useState(false)
  const [light, setLight] = useState<number | null>(null)
  const [torch, setTorch] = useState(false)
  const [torchSupported, setTorchSupported] = useState(false)
  const [flashing, setFlashing] = useState(false)
  const [box, setBox] = useState({ w: 0, h: 0 })

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const ws = useWorkspace()
  const assessment = ws.assessments.find((a) => a.id === scan.assessmentId)!
  // The sample paper is drawn from the demo recognizer's marks so both always agree.
  const sample = useMemo(
    () =>
      renderPaperSvg({
        student: scan.student || 'Sample Student',
        classLabel: assessment.classLabel,
        title: assessment.title,
        questions: assessment.key.questions,
        marks: demoRecognize(scan.student || 'Sample Student', assessment.key.id, assessment.key.questions).marks,
      }),
    [scan.student, assessment],
  )

  useEffect(() => {
    setDarkChrome(true)
    return () => setDarkChrome(false)
  }, [])

  useEffect(() => {
    let cancelled = false
    let noFrames: ReturnType<typeof setTimeout> | undefined
    const media = navigator.mediaDevices
    if (!media?.getUserMedia) {
      setCam('unavailable')
      return
    }
    media
      .getUserMedia({
        audio: false,
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
      })
      .then((stream) => {
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop())
          return
        }
        streamRef.current = stream
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          video.play().catch(() => undefined)
        }
        const caps = stream.getVideoTracks()[0]?.getCapabilities?.() as { torch?: boolean } | undefined
        setTorchSupported(!!caps?.torch)
        // The viewfinder goes live on the first decoded frame (onPlaying); give up if none arrive.
        noFrames = setTimeout(() => {
          if (videoRef.current?.videoWidth) return
          stream.getTracks().forEach((t) => t.stop())
          setCam('unavailable')
        }, 8000)
      })
      .catch(() => {
        if (!cancelled) setCam('unavailable')
      })
    return () => {
      cancelled = true
      clearTimeout(noFrames)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  // Boundary lock is simulated; it re-arms whenever the source or paper size changes.
  useEffect(() => {
    if (cam === 'starting') return
    setLocked(false)
    const t = setTimeout(() => setLocked(true), 1400)
    return () => clearTimeout(t)
  }, [cam, paper])

  // Lighting telemetry is real: mean luminance of a downsampled frame.
  useEffect(() => {
    if (cam !== 'live') return
    const canvas = document.createElement('canvas')
    canvas.width = 24
    canvas.height = 24
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    const t = setInterval(() => {
      const video = videoRef.current
      if (!ctx || !video || !video.videoWidth) return
      ctx.drawImage(video, 0, 0, 24, 24)
      const { data } = ctx.getImageData(0, 0, 24, 24)
      let sum = 0
      for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]
      setLight(Math.round((sum / (data.length / 4) / 255) * 100))
    }, 600)
    return () => clearInterval(t)
  }, [cam])

  useLayoutEffect(() => {
    const el = viewRef.current
    if (!el) return
    const ro = new ResizeObserver(([entry]) => setBox({ w: entry.contentRect.width, h: entry.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const ratio = PAPER[paper]
  const frameW = Math.max(0, Math.min(box.w * 0.84, box.h * 0.84 * ratio))
  const frameH = frameW / ratio
  const frameX = (box.w - frameW) / 2
  const frameY = (box.h - frameH) / 2

  async function toggleTorch() {
    if (cam !== 'live' || !torchSupported) {
      showToast(cam === 'live' ? 'This camera has no flash' : 'Flash needs the camera')
      return
    }
    const next = !torch
    try {
      await streamRef.current
        ?.getVideoTracks()[0]
        ?.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
      setTorch(next)
    } catch {
      showToast('Could not switch the flash')
    }
  }

  function capture() {
    let image = sample
    let source: CaptureSource = 'sample'
    const video = videoRef.current
    if (cam === 'live' && video?.videoWidth) {
      // Map the on-screen guide frame back into video pixels (the video is object-cover).
      const scale = Math.max(box.w / video.videoWidth, box.h / video.videoHeight)
      const offX = (box.w - video.videoWidth * scale) / 2
      const offY = (box.h - video.videoHeight * scale) / 2
      const sx = Math.max(0, (frameX - offX) / scale)
      const sy = Math.max(0, (frameY - offY) / scale)
      const sw = Math.min(video.videoWidth - sx, frameW / scale)
      const sh = Math.min(video.videoHeight - sy, frameH / scale)
      const out = Math.min(1, 1400 / sh)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(sw * out)
      canvas.height = Math.round(sh * out)
      canvas.getContext('2d')!.drawImage(video, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height)
      image = canvas.toDataURL('image/jpeg', 0.85)
      source = 'camera'
    }
    setFlashing(true)
    setTimeout(() => setCapture(image, source), 220)
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    fileToDataUrl(file)
      .then((url) => setCapture(url, 'gallery'))
      .catch(() => showToast('That file could not be opened as an image'))
  }

  const lowLight = cam === 'live' && light !== null && light < 22
  const cornerColor = locked ? '#6BCB77' : '#FFD93D'

  return (
    <div className="flex h-full flex-col bg-ink text-white">
      <header className="flex shrink-0 items-center gap-3 px-4 pt-3 pb-2">
        <button
          type="button"
          aria-label="Close scanner"
          onClick={() => back()}
          className="press flex size-10 shrink-0 items-center justify-center rounded-lg border-2 border-ink bg-white text-ink shadow-[2px_2px_0_rgba(255,255,255,0.35)]"
        >
          <X size={19} aria-hidden />
        </button>
        <div className="min-w-0 flex-1">
          <MonoLabel className="text-white/70">Step 01 / 04 • Capture</MonoLabel>
          <p className="truncate text-[15px] font-bold">
            {assessment.title} · {assessment.classLabel}
          </p>
        </div>
        <div role="radiogroup" aria-label="Paper size" className="flex shrink-0 rounded-lg border-2 border-white p-0.5">
          {(Object.keys(PAPER) as (keyof typeof PAPER)[]).map((size) => (
            <button
              key={size}
              type="button"
              role="radio"
              aria-checked={paper === size}
              onClick={() => setPaper(size)}
              className={cx(
                'rounded-md px-2 py-1 font-mono text-[11px] font-bold',
                paper === size ? 'bg-sun text-ink' : 'text-white/80',
              )}
            >
              {size}
            </button>
          ))}
        </div>
      </header>
      <div className="flex shrink-0 gap-1.5 px-4 pb-3" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className={cx('h-2 flex-1 rounded-full border-2 border-white', i === 0 ? 'bg-sun' : 'bg-transparent')} />
        ))}
      </div>

      <div ref={viewRef} className="relative mx-4 min-h-0 flex-1 overflow-hidden rounded-2xl border-2 border-white bg-[#2b2b2b]">
        <video
          ref={videoRef}
          playsInline
          muted
          autoPlay
          poster={BLANK_POSTER}
          onPlaying={() => setCam((c) => (c === 'starting' ? 'live' : c))}
          className={cx('absolute inset-0 size-full object-cover', cam !== 'live' && 'opacity-0')}
        />
        {cam === 'unavailable' && frameW > 0 && (
          <img
            src={sample}
            alt="Sample answer sheet in the scanner"
            className="absolute rounded-sm shadow-[6px_8px_0_rgba(0,0,0,0.45)]"
            style={{
              left: frameX + frameW * 0.05,
              top: frameY + frameH * 0.05,
              width: frameW * 0.9,
              height: frameH * 0.9,
              transform: 'rotate(-1.2deg)',
            }}
          />
        )}

        {frameW > 0 && (
          <div
            className="pointer-events-none absolute rounded-lg"
            style={{
              left: frameX,
              top: frameY,
              width: frameW,
              height: frameH,
              boxShadow: '0 0 0 9999px rgba(26,26,26,0.55)',
              border: `2px ${locked ? 'solid' : 'dashed'} ${locked ? '#6BCB77' : 'rgba(255,255,255,0.55)'}`,
            }}
          >
            {(
              [
                ['-left-1.5 -top-1.5', 'borderTopWidth', 'borderLeftWidth', 'rounded-tl-xl'],
                ['-right-1.5 -top-1.5', 'borderTopWidth', 'borderRightWidth', 'rounded-tr-xl'],
                ['-left-1.5 -bottom-1.5', 'borderBottomWidth', 'borderLeftWidth', 'rounded-bl-xl'],
                ['-right-1.5 -bottom-1.5', 'borderBottomWidth', 'borderRightWidth', 'rounded-br-xl'],
              ] as const
            ).map(([pos, a, b, round]) => (
              <span
                key={pos}
                className={cx('absolute size-8 transition-colors', pos, round)}
                style={{ borderColor: cornerColor, borderStyle: 'solid', borderWidth: 0, [a]: 5, [b]: 5 }}
              />
            ))}
            {!locked && cam !== 'starting' && (
              <span className="absolute inset-x-2 h-0.5 animate-scan bg-sun shadow-[0_0_12px_#FFD93D]" />
            )}
            <span className="absolute inset-x-0 -bottom-9 text-center font-mono text-[10px] font-bold tracking-widest text-white/70">
              {paper === 'A4' ? 'A4 • 210 × 297 MM' : 'LETTER • 8.5 × 11 IN'}
            </span>
          </div>
        )}

        <div className="absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2">
          <span
            className={cx(
              'inline-flex items-center gap-1.5 rounded-lg border-2 border-ink px-2 py-1 text-[11px] font-bold text-ink',
              locked ? 'bg-mint' : 'bg-sun',
            )}
            role="status"
          >
            <span className={cx('size-2 rounded-full border border-ink', locked ? 'bg-white' : 'animate-pulse bg-white')} />
            {cam === 'starting' ? 'Starting camera…' : locked ? 'Document boundaries locked' : 'Detecting edges…'}
          </span>
          <span className="inline-flex items-center gap-1 rounded-lg border-2 border-ink bg-white px-2 py-1 font-mono text-[10px] font-bold text-ink">
            {cam === 'live' ? `LIGHT ${light ?? '—'}% • EDGES ${locked ? '4' : '2'}/4` : cam === 'unavailable' ? 'SAMPLE PAPER' : '—'}
          </span>
        </div>

        <span className="absolute bottom-3 left-3 rounded-lg border-2 border-ink bg-white px-2 py-1 font-mono text-[10px] font-bold text-ink">
          {scan.paperNumber ? `PAPER ${scan.paperNumber} OF ${scan.paperCount}` : `${assessment.key.questions.length} ITEMS`}
        </span>
        {flashing && <div className="absolute inset-0 animate-flash bg-white" />}
      </div>

      <p className="shrink-0 px-6 pt-3 text-center text-xs text-white/80">
        {cam === 'unavailable'
          ? 'Camera unavailable. Capture uses the sample paper, or pick a photo from the gallery.'
          : lowLight
            ? 'Low light. Turn on the flash or move closer to a window.'
            : 'Align the paper inside the frame and hold steady.'}
      </p>

      <div className="flex shrink-0 items-end justify-between px-8 pt-3 pb-[max(16px,env(safe-area-inset-bottom))]">
        <SideAction
          label={torch ? 'Flash on' : 'Flash'}
          icon={torch ? Zap : ZapOff}
          active={torch}
          onClick={toggleTorch}
        />
        <button
          type="button"
          aria-label="Capture paper"
          onClick={capture}
          disabled={cam === 'starting' || flashing}
          className="press flex size-[76px] items-center justify-center rounded-2xl border-2 border-white bg-sun text-ink shadow-[3px_3px_0_#fff] disabled:opacity-60"
        >
          <span className="flex size-[58px] items-center justify-center rounded-xl border-2 border-ink">
            <Camera size={28} strokeWidth={2.25} aria-hidden />
          </span>
        </button>
        <SideAction label="Gallery" icon={ImageIcon} onClick={() => fileRef.current?.click()} />
      </div>
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onFile} />
    </div>
  )
}

function SideAction({
  label,
  icon: Icon,
  active,
  onClick,
}: {
  label: string
  icon: typeof Camera
  active?: boolean
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className="flex w-14 flex-col items-center gap-1.5">
      <span
        className={cx(
          'press flex size-12 items-center justify-center rounded-xl border-2 border-ink text-ink shadow-[2px_2px_0_rgba(255,255,255,0.35)]',
          active ? 'bg-sun' : 'bg-white',
        )}
      >
        <Icon size={21} aria-hidden />
      </span>
      <span className="font-mono text-[10px] font-bold tracking-wider text-white/80 uppercase">{label}</span>
    </button>
  )
}
