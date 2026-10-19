import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { PACES, countWords, estimateSeconds, formatDuration, type Pace } from '../../../../shared/readingTime'
import { combinedScript, type ScriptSnapshot } from '../../../../shared/script'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { useToast } from '../../lib/toast'
import { Modal } from '../ui'

/** Creates a NEW linked creative with a shortened script. The source stays untouched. */
export function ShortDialog({ creativeId, snap, selectedHookId, pace, onClose }: { creativeId: string; snap: ScriptSnapshot; selectedHookId: string | null; pace: Pace; onClose: () => void }) {
  const { me } = useAuth()
  const [mode, setMode] = useState<'time' | 'free'>('time')
  const [seconds, setSeconds] = useState(30)
  const [free, setFree] = useState('')
  const [p, setP] = useState<Pace>(pace)
  const [includeOthers, setIncludeOthers] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const toast = useToast()
  const hookIndex = Math.max(0, snap.hooks.findIndex((h) => h.id === selectedHookId))
  const current = estimateSeconds(countWords(combinedScript(snap, selectedHookId)), p)

  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.post(`/creatives/${creativeId}/short`, {
        targetSeconds: mode === 'time' ? seconds : null,
        freeTarget: mode === 'free' ? free : null,
        pace: p,
        hookId: selectedHookId,
        includeOtherHooks: includeOthers,
      })
      toast.show('success', `נוצרה גרסה קצרה חדשה. ${r.notes ?? ''}`, { ms: 9000 })
      navigate(`/creatives/${r.creative.id}`)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }

  return (
    <Modal
      title="יצירת גרסה קצרה עם AI"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" disabled={busy || !me?.aiConfigured || (mode === 'free' && !free.trim())} onClick={submit}>
            {busy ? 'מקצר… (עד דקה)' : 'יצירת גרסה קצרה'}
          </button>
          <button className="btn btn-ghost" onClick={onClose} disabled={busy}>ביטול</button>
        </>
      }
    >
      {!me?.aiConfigured && <div className="alert alert-warn">חיבור ה-AI לא מוגדר.</div>}
      <div className="subtle">אורך נוכחי משוער: {formatDuration(current)} (הוק {hookIndex + 1} + ליד + גוף + קריאה לפעולה)</div>
      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        <button className={mode === 'time' ? 'active' : ''} onClick={() => setMode('time')}>יעד זמן</button>
        <button className={mode === 'free' ? 'active' : ''} onClick={() => setMode('free')}>יעד אורך חופשי</button>
      </div>
      {mode === 'time' ? (
        <div className="row-wrap">
          {[15, 20, 30, 45, 60].map((s) => (
            <button key={s} className={`chip ${seconds === s ? 'active' : ''}`} onClick={() => setSeconds(s)}>{s} שנ׳</button>
          ))}
          <input type="number" min={5} max={600} value={seconds} onChange={(e) => setSeconds(Number(e.target.value))} style={{ width: 90 }} aria-label="שניות" />
          <select value={p} onChange={(e) => setP(e.target.value as Pace)} style={{ width: 'auto' }} aria-label="קצב">
            {(Object.keys(PACES) as Pace[]).map((k) => <option key={k} value={k}>קצב {PACES[k].label}</option>)}
          </select>
        </div>
      ) : (
        <input type="text" value={free} onChange={(e) => setFree(e.target.value)} placeholder="לדוגמה: חצי מהאורך, או בערך 70 מילים" />
      )}
      <label className="checkbox">
        <input type="checkbox" checked={includeOthers} onChange={(e) => setIncludeOthers(e.target.checked)} disabled={snap.hooks.length < 2} />
        לכלול גם את שאר ההוקים כחלופות ({Math.max(0, snap.hooks.length - 1)})
      </label>
      <div className="alert alert-info small">
        ייווצר קריאייטיב חדש, מקושר למקור, בסטטוס ״בכתיבה״ וללא אישור. המקור לא ישתנה. יעד הזמן הוא הערכה — לא הבטחה לזמן הקראה מדויק.
      </div>
      {error && <div className="alert alert-error">{error}</div>}
    </Modal>
  )
}
