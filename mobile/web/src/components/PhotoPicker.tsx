import { ImageIcon } from 'lucide-react'
import { useRef, useState, type ChangeEvent } from 'react'
import { useSettings } from '../lib/settings'
import { Sheet } from './Sheet'
import { BrutalistButton } from './ui'

/**
 * Opens the photo picker, asking the teacher first. The Android system picker only hands
 * over the photo that is chosen, but the app still asks before showing it, and remembers.
 */
export function usePhotoPicker(onFile: (file: File) => void) {
  const access = useSettings((s) => s.photoAccess)
  const update = useSettings((s) => s.update)
  const [asking, setAsking] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  function pick() {
    if (access === 'allowed') input.current?.click()
    else setAsking(true)
  }

  function onChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) onFile(file)
  }

  const element = (
    <>
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={onChange} />
      {asking && (
        <Sheet
          title="Allow access to your photos?"
          subtitle="Gallery"
          onClose={() => setAsking(false)}
          footer={
            <div className="grid grid-cols-2 gap-2.5">
              <BrutalistButton
                variant="secondary"
                onClick={() => {
                  update({ photoAccess: 'denied' })
                  setAsking(false)
                }}
              >
                Don't allow
              </BrutalistButton>
              <BrutalistButton
                variant="yellow"
                onClick={() => {
                  update({ photoAccess: 'allowed' })
                  setAsking(false)
                  // Same tap that granted access opens the picker (file pickers need a user gesture).
                  input.current?.click()
                }}
              >
                Allow
              </BrutalistButton>
            </div>
          }
        >
          <div className="flex gap-3 text-[13.5px] leading-snug">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-xl border-2 border-ink bg-sun">
              <ImageIcon size={20} aria-hidden />
            </span>
            <p>
              GabAI opens your gallery so you can pick one photo of a paper or a profile picture. Only the photo you choose is
              used, and it stays on this phone unless you send it for online OCR. You can change this in Settings → System.
            </p>
          </div>
        </Sheet>
      )}
    </>
  )
  return { pick, element }
}
