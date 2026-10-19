import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, errorMessage } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Modal } from './ui'

/** New creative: free writing (empty editor) or developing the idea with AI first. */
export function NewCreativeDialog({ productId, onClose }: { productId: string; onClose: () => void }) {
  const { me } = useAuth()
  const [mode, setMode] = useState<'free' | 'ai'>('free')
  const [name, setName] = useState('')
  const [angle, setAngle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const c = await api.post(`/products/${productId}/creatives`, { name, angle, mode })
      navigate(`/creatives/${c.id}${mode === 'ai' ? '?start=ai' : ''}`)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <Modal
      title="קריאייטיב חדש"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" disabled={!name.trim() || busy} onClick={create}>{busy ? 'יוצר…' : 'יצירה'}</button>
          <button className="btn btn-ghost" onClick={onClose}>ביטול</button>
        </>
      }
    >
      <div className="stack-sm" role="radiogroup" aria-label="דרך התחלה">
        <label className={`card card-pad row ${mode === 'free' ? 'selected' : ''}`} style={{ cursor: 'pointer', borderColor: mode === 'free' ? 'var(--accent)' : undefined }}>
          <input type="radio" name="mode" checked={mode === 'free'} onChange={() => setMode('free')} />
          <div>
            <div style={{ fontWeight: 600 }}>כתיבה חופשית</div>
            <div className="subtle">פותח עורך ריק — הוק, ליד, גוף וקריאה לפעולה.</div>
          </div>
        </label>
        <label className="card card-pad row" style={{ cursor: 'pointer', borderColor: mode === 'ai' ? 'var(--accent)' : undefined }}>
          <input type="radio" name="mode" checked={mode === 'ai'} onChange={() => setMode('ai')} />
          <div>
            <div style={{ fontWeight: 600 }}>פיתוח רעיון עם AI</div>
            <div className="subtle">שיחה ממוקדת על הקהל, הבעיה, הזווית והמסר. אפשר להתחיל לכתוב בכל רגע.</div>
            {!me?.aiConfigured && <div className="subtle" style={{ color: 'var(--warning)' }}>חיבור ה-AI לא מוגדר — השיחה לא תעבוד עד להגדרה.</div>}
          </div>
        </label>
      </div>
      <label className="field">
        שם הקריאייטיב
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="לדוגמה: אמא עייפה — בוקר כאוטי" />
      </label>
      <label className="field">
        זווית שיווקית <span className="hint">לא חובה, אפשר להשלים אחר כך</span>
        <input type="text" value={angle} onChange={(e) => setAngle(e.target.value)} />
      </label>
      {error && <div className="alert alert-error">{error}</div>}
    </Modal>
  )
}
