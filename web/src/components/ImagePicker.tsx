import { useRef, useState } from 'react'
import { api, errorMessage } from '../lib/api'
import { useToast } from '../lib/toast'

/** Uploads an image to protected storage and returns its file id. */
export function ImagePicker({ label, onUploaded }: { label: string; onUploaded: (fileId: string) => void }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const pick = async (file: File) => {
    if (!file.type.startsWith('image/')) return toast.show('error', 'יש לבחור קובץ תמונה')
    setBusy(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const f = await api.upload('/files', form)
      onUploaded(f.id)
    } catch (e) {
      toast.show('error', `ההעלאה נכשלה: ${errorMessage(e)}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <>
      <button type="button" className="btn btn-sm" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? 'מעלה…' : label}
      </button>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])} />
    </>
  )
}
