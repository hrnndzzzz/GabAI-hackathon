// Thin bridge to MainActivity's `GabAINative` JavaScript interface, with
// browser fallbacks so the app also runs in a desktop dev server.

interface NativeBridge {
  getConfig?(): string
  shareFile(fileName: string, mimeType: string, content: string): void
  printHtml(jobName: string, html: string): void
  setDarkChrome(dark: boolean): void
  /** Newer shells: also remembers the theme so the next launch starts in it. */
  setTheme?(dark: boolean): void
  /** Outcome of the email-confirmation link that opened the app (JSON, consumed on read). */
  takeAuthEvent?(): string | null
  readClipboard?(): string | null
  /** {"x": centre of the punch-hole camera in CSS px} or {} when there is none. */
  getCutout?(): string
  setStatusRing?(color: string, pulse: boolean, durationMs: number): void
}

declare global {
  interface Window {
    GabAINative?: NativeBridge
    gabaiBack?: () => boolean
    /** Called by the shell when a confirmation link arrives while the app is open. */
    gabaiAuthEvent?: () => void
  }
}

/** Horizontal centre of the front camera's punch hole, in CSS px, or null. */
export function cutoutX(): number | null {
  try {
    const x = (JSON.parse(window.GabAINative?.getCutout?.() ?? '{}') as { x?: number }).x
    return typeof x === 'number' ? x : null
  } catch {
    return null
  }
}

/** Briefly rings the punch-hole camera in a status colour (Android only). */
export function showStatusRing(color: string, pulse: boolean, durationMs: number): void {
  window.GabAINative?.setStatusRing?.(color, pulse, durationMs)
}

/** Clipboard text: from the Android shell, else the browser's clipboard API (which may ask first). */
export async function readClipboardText(): Promise<string | null> {
  if (window.GabAINative?.readClipboard) return window.GabAINative.readClipboard() ?? null
  try {
    return (await navigator.clipboard?.readText()) ?? null
  } catch {
    return null
  }
}

/** Where the confirmation email sends the teacher: back into the app on Android. */
export const CONFIRM_REDIRECT = 'gabai://auth/confirmed'

export interface AuthEvent {
  kind: 'confirmed' | 'expired' | 'error'
  message?: string
}

export function takeAuthEvent(): AuthEvent | null {
  try {
    const raw = window.GabAINative?.takeAuthEvent?.()
    return raw ? (JSON.parse(raw) as AuthEvent) : null
  } catch {
    return null
  }
}

export const isAndroid = () => typeof window !== 'undefined' && !!window.GabAINative

export function shareTextFile(fileName: string, mimeType: string, content: string): void {
  if (window.GabAINative) {
    window.GabAINative.shareFile(fileName, mimeType, content)
    return
  }
  const url = URL.createObjectURL(new Blob([content], { type: `${mimeType};charset=utf-8` }))
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function printHtml(jobName: string, html: string): void {
  if (window.GabAINative) {
    window.GabAINative.printHtml(jobName, html)
    return
  }
  const frame = document.createElement('iframe')
  frame.style.cssText = 'position:fixed;width:0;height:0;border:0;opacity:0'
  frame.srcdoc = html
  frame.onload = () => {
    frame.contentWindow?.print()
    setTimeout(() => frame.remove(), 1000)
  }
  document.body.appendChild(frame)
}

export function setDarkChrome(dark: boolean): void {
  window.GabAINative?.setDarkChrome(dark)
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#121417' : '#F8F9FA')
}

/** The app theme (not a single dark screen like the scanner). */
export function setThemeChrome(dark: boolean): void {
  if (window.GabAINative?.setTheme) {
    window.GabAINative.setTheme(dark)
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#121417' : '#F8F9FA')
  } else {
    setDarkChrome(dark)
  }
}
