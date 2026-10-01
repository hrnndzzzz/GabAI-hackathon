// Thin bridge to MainActivity's `GabAINative` JavaScript interface, with
// browser fallbacks so the app also runs in a desktop dev server.

interface NativeBridge {
  getConfig?(): string
  shareFile(fileName: string, mimeType: string, content: string): void
  printHtml(jobName: string, html: string): void
  setDarkChrome(dark: boolean): void
}

declare global {
  interface Window {
    GabAINative?: NativeBridge
    gabaiBack?: () => boolean
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
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#1A1A1A' : '#F8F9FA')
}
