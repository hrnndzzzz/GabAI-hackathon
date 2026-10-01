import { ArrowLeft, Camera, Check, ChevronDown, Image as ImageIcon, Zap, ZapOff } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import { usePhotoPicker } from '../components/PhotoPicker'
import { Sheet } from '../components/Sheet'
import { useScanSteps } from '../components/flowSteps'
import { MonoLabel, TONE_BG, cx } from '../components/ui'
import { classLabel, levelTone } from '../lib/classes'
import { setDarkChrome } from '../lib/native'
import { demoRecognize, fileToDataUrl, renderPaperSvg } from '../lib/ocr'
import { resolvedTheme, useSettings } from '../lib/settings'
import { expectedPapers, useStore, useWorkspace, type CaptureSource, type ScanSession } from '../store'

type CamState = 'starting' | 'live' | 'unavailable'
/** unknown until the stream reports its capabilities; none when this camera has no flash. */
type TorchState = 'unknown' | 'none' | 'off' | 'on'

// Rear camera found to have a usable flash on this phone, so the scanner opens it first next time.
const FLASH_CAMERA_KEY = 'gabai-flash-camera'

function rememberedCamera(): string | null {
  try {
    return localStorage.getItem(FLASH_CAMERA_KEY)
  } catch {
    return null
  }
}

function rememberCamera(deviceId: string): void {
  try {
    localStorage.setItem(FLASH_CAMERA_KEY, deviceId)
  } catch {
    // Storage unavailable: it is simply found again next time.
  }
}

const VIDEO = { width: { ideal: 1920 }, height: { ideal: 1080 } }

/**
 * The phone's main rear camera. Android numbers cameras ("camera 0, facing back"); the lowest
 * rear one is the primary lens, which has the flash and focuses close, while the default pick
 * for "environment" is often an ultra-wide without either. Labels exist once camera access is granted.
 */
async function mainRearCamera(): Promise<string | null> {
  try {
    const rear = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput' && d.deviceId && /back|rear|environment/i.test(d.label))
    const number = (label: string) => Number(/camera\s*(\d+)/i.exec(label)?.[1] ?? 99)
    return rear.sort((a, b) => number(a.label) - number(b.label))[0]?.deviceId ?? null
  } catch {
    return null
  }
}

async function openStream(deviceId?: string | null): Promise<MediaStream> {
  deviceId ??= await mainRearCamera()
  if (deviceId) {
    try {
      return await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...VIDEO, deviceId: { exact: deviceId } } })
    } catch {
      // That camera is gone or busy: fall back to the default rear camera.
    }
  }
  return navigator.mediaDevices.getUserMedia({ audio: false, video: { ...VIDEO, facingMode: { ideal: 'environment' } } })
}

const torchListed = (t?: MediaStreamTrack) => !!(t?.getCapabilities?.() as { torch?: boolean } | undefined)?.torch

/** Switches the torch and reports whether it really changed (some phones ignore the request silently). */
async function setTrackTorch(track: MediaStreamTrack, on: boolean): Promise<boolean> {
  try {
    await track.applyConstraints({ advanced: [{ torch: on } as MediaTrackConstraintSet] })
  } catch {
    return false
  }
  const reported = (track.getSettings() as { torch?: boolean }).torch
  return reported === undefined ? torchListed(track) : reported === on
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

/**
 * Phones with several rear cameras often give apps a lens without the flash. Android opens one
 * camera at a time, so this releases the current one and tries the others until one lights up.
 */
async function findFlashCamera(current: MediaStreamTrack, alive: () => boolean): Promise<{ stream: MediaStream; deviceId: string } | null> {
  const currentId = current.getSettings().deviceId
  const cameras = (await navigator.mediaDevices.enumerateDevices()).filter(
    (d) => d.kind === 'videoinput' && d.deviceId && d.deviceId !== currentId && !/front|user|selfie/i.test(d.label),
  )
  current.stop()
  for (const d of cameras) {
    if (!alive()) return null
    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { ...VIDEO, deviceId: { exact: d.deviceId } } })
    } catch {
      continue
    }
    const track = stream.getVideoTracks()[0]
    await wait(600)
    // Actually switch it on: a listed torch is not proof, and the light is what the teacher asked for.
    if (track && (await setTrackTorch(track, true))) return { stream, deviceId: d.deviceId }
    stream.getTracks().forEach((t) => t.stop())
  }
  return null
}

// The scanner is always dark, whatever the app theme: pin ink to the light-theme value.
const PINNED = { '--color-ink': '#1a1a1a' } as CSSProperties

const PAPER = { A4: 210 / 297, Letter: 8.5 / 11 } as const
// Transparent 1×1 GIF: hides the WebView's default play-button poster while the stream starts.
const BLANK_POSTER = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw=='

export function ScanCapture() {
  const scan = useStore((s) => s.scan) as ScanSession
  const setCapture = useStore((s) => s.setCapture)
  const back = useStore((s) => s.back)
  const showToast = useStore((s) => s.showToast)

  const switchScan = useStore((s) => s.switchScan)
  const steps = useScanSteps()
  const defaultPaper = useSettings((s) => s.paperSize)
  const [paper, setPaper] = useState<keyof typeof PAPER>(defaultPaper)
  const [cam, setCam] = useState<CamState>('starting')
  const [locked, setLocked] = useState(false)
  const [light, setLight] = useState<number | null>(null)
  const [torch, setTorch] = useState<TorchState>('unknown')
  const [flashing, setFlashing] = useState(false)
  const [seeking, setSeeking] = useState(false)
  const mounted = useRef(true)
  const [picking, setPicking] = useState(false)
  const [box, setBox] = useState({ w: 0, h: 0 })

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const viewRef = useRef<HTMLDivElement>(null)
  const gallery = usePhotoPicker((file) =>
    fileToDataUrl(file)
      .then((url) => setCapture(url, 'gallery'))
      .catch(() => showToast('That file could not be opened as an image')),
  )

  const ws = useWorkspace()
  const assessment = ws.assessments.find((a) => a.id === scan.assessmentId)!
  const section = ws.classes.find((c) => c.id === assessment.classId)
  const graded = ws.submissions.filter((s) => s.assessmentId === assessment.id).length
  const scannable = ws.assessments.filter((a) => a.key.questions.length)
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
    return () => setDarkChrome(resolvedTheme(useSettings.getState().theme) === 'dark')
  }, [])

  useEffect(() => {
    let cancelled = false
    let noFrames: ReturnType<typeof setTimeout> | undefined
    const media = navigator.mediaDevices
    if (!media?.getUserMedia) {
      setCam('unavailable')
      return
    }
    mounted.current = true
    openStream(rememberedCamera())
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
        // Camera names only appear once a camera is open. If this isn't the main rear lens (which
        // has the flash and focuses close), switch to it once and remember it for next time.
        void mainRearCamera().then(async (main) => {
          const current = stream.getVideoTracks()[0]
          if (cancelled || !main || !current || main === current.getSettings().deviceId) return
          current.stop()
          try {
            const better = await openStream(main)
            if (cancelled) return better.getTracks().forEach((t) => t.stop())
            streamRef.current = better
            if (videoRef.current) {
              videoRef.current.srcObject = better
              videoRef.current.play().catch(() => undefined)
            }
            rememberCamera(main)
          } catch {
            const back = await openStream(current.getSettings().deviceId).catch(() => null)
            if (back && !cancelled) {
              streamRef.current = back
              if (videoRef.current) videoRef.current.srcObject = back
            }
          }
        })
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
      mounted.current = false
      clearTimeout(noFrames)
      streamRef.current?.getTracks().forEach((t) => t.stop())
      streamRef.current = null
    }
  }, [])

  function attach(stream: MediaStream) {
    streamRef.current = stream
    const video = videoRef.current
    if (video) {
      video.srcObject = stream
      video.play().catch(() => undefined)
    }
  }

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

  // Capabilities are only reliable once frames are flowing (and some phones add the torch a moment
  // later), so check when the stream goes live and again shortly after.
  useEffect(() => {
    if (cam !== 'live') return
    const check = () => setTorch((t) => (t === 'on' ? t : torchListed(streamRef.current?.getVideoTracks()[0]) ? 'off' : 'none'))
    check()
    const later = window.setTimeout(check, 1200)
    return () => window.clearTimeout(later)
  }, [cam])

  async function toggleTorch() {
    if (cam !== 'live') {
      showToast('The flash needs the camera')
      return
    }
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track || seeking) return
    const next = torch !== 'on'
    // Try even when the camera doesn't list a torch: several phones still honour the request.
    if (await setTrackTorch(track, next)) {
      setTorch(next ? 'on' : 'off')
      return
    }
    if (!next) {
      setTorch('off')
      return
    }
    setSeeking(true)
    showToast('Looking for the camera with the flash…')
    const found = await findFlashCamera(track, () => mounted.current)
    if (!mounted.current) {
      found?.stream.getTracks().forEach((t) => t.stop())
      return
    }
    setSeeking(false)
    if (found) {
      attach(found.stream)
      rememberCamera(found.deviceId)
      setTorch('on')
      showToast('Flash on')
      return
    }
    // No rear camera lit up: go back to the original one.
    try {
      attach(await openStream(track.getSettings().deviceId))
    } catch {
      setCam('unavailable')
    }
    setTorch('none')
    showToast("This phone doesn't let apps use the flash. Move closer to a light instead.")
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

  const lowLight = cam === 'live' && light !== null && light < 22
  const cornerColor = locked ? '#6BCB77' : '#FFD93D'

  return (
    <div className="flex h-full flex-col bg-[#141414] text-white" style={PINNED}>
      <header className="flex shrink-0 items-center gap-3 px-4 pt-3 pb-2">
        <button
          type="button"
          aria-label="Back"
          onClick={() => back()}
          className="press flex size-10 shrink-0 items-center justify-center rounded-lg border-2 border-ink bg-sun text-ink shadow-[2px_2px_0_rgba(255,255,255,0.35)]"
        >
          <ArrowLeft size={19} aria-hidden />
        </button>
        <button type="button" onClick={() => setPicking(true)} className="min-w-0 flex-1 text-left" aria-label={`Scanning ${assessment.title}. Change assessment`}>
          <MonoLabel className="text-white/70">Step 01 / 04 • Capture</MonoLabel>
          <span className="flex items-center gap-1">
            <span className="truncate text-[15px] font-bold">
              {assessment.title} · {section ? classLabel(section) : assessment.classLabel}
            </span>
            <ChevronDown size={16} className="shrink-0" aria-hidden />
          </span>
        </button>
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
      <nav aria-label="Steps" className="flex shrink-0 gap-1.5 px-4 pb-2">
        {steps.map((step, i) => (
          <button
            key={step.label}
            type="button"
            aria-current={i === 0 ? 'step' : undefined}
            aria-label={`Step ${i + 1}: ${step.label}`}
            disabled={i === 0 || !step.go}
            onClick={step.go}
            className="flex-1 py-1.5 disabled:cursor-default"
          >
            <span className={cx('block h-2 rounded-full border-2 border-white', i === 0 ? 'bg-sun' : step.go ? 'bg-white/40' : 'bg-transparent')} />
          </button>
        ))}
      </nav>

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

        <button
          type="button"
          onClick={() => setPicking(true)}
          className="absolute bottom-3 left-3 rounded-lg border-2 border-ink bg-white px-2 py-1 text-left font-mono text-[10px] font-bold text-ink"
        >
          {scan.paperCount ? `PAPER ${scan.paperNumber} OF ${scan.paperCount}` : `PAPER ${scan.paperNumber ?? 1}`} • {assessment.key.questions.length} ITEMS
          {scan.student && <span className="block max-w-[180px] truncate font-sans text-[11px] normal-case">{scan.student}</span>}
        </button>
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
          label={seeking ? 'Finding…' : torch === 'on' ? 'Flash on' : torch === 'off' ? 'Flash off' : 'Flash'}
          icon={torch === 'on' ? Zap : ZapOff}
          active={torch === 'on'}
          muted={cam !== 'live' || seeking}
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
        <SideAction label="Gallery" icon={ImageIcon} onClick={gallery.pick} />
      </div>
      {gallery.element}
      {picking && (
        <Sheet title="Which assessment are you scanning?" subtitle={`${graded} of ${expectedPapers(ws, assessment) || '?'} graded for this one`} onClose={() => setPicking(false)}>
          <ul className="space-y-2">
            {scannable.map((a) => {
              const c = ws.classes.find((x) => x.id === a.classId)
              const done = ws.submissions.filter((s) => s.assessmentId === a.id).length
              const expected = expectedPapers(ws, a)
              const current = a.id === assessment.id
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!current) switchScan(a.id)
                      setPicking(false)
                    }}
                    className={cx('press flex w-full items-center gap-3 rounded-lg border-2 border-ink px-3 py-2.5 text-left shadow-brut-sm', current ? 'bg-sun' : 'bg-surface')}
                  >
                    <span className={cx('size-3 shrink-0 rounded-full border-2 border-ink', TONE_BG[c ? levelTone(c.level) : 'white'])} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13.5px] font-bold">{a.title}</span>
                      <MonoLabel className="truncate text-subtle">
                        {c ? classLabel(c) : a.classLabel} • {expected ? `${done} of ${expected} graded` : `${done} graded`}
                      </MonoLabel>
                    </span>
                    {current && <Check size={18} aria-hidden />}
                  </button>
                </li>
              )
            })}
          </ul>
        </Sheet>
      )}
    </div>
  )
}

function SideAction({
  label,
  icon: Icon,
  active,
  muted,
  onClick,
}: {
  label: string
  icon: typeof Camera
  active?: boolean
  muted?: boolean
  onClick: () => void
}) {
  return (
    <button type="button" onClick={onClick} aria-pressed={active} className="flex w-16 flex-col items-center gap-1.5">
      <span
        className={cx(
          'press flex size-12 items-center justify-center rounded-xl border-2 border-ink text-ink shadow-[2px_2px_0_rgba(255,255,255,0.35)]',
          active ? 'bg-sun' : muted ? 'bg-white/45' : 'bg-white',
        )}
      >
        <Icon size={21} aria-hidden />
      </span>
      <span className="font-mono text-[10px] font-bold tracking-wider text-white/80 uppercase">{label}</span>
    </button>
  )
}
