import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import * as Y from 'yjs'
import { PROVENANCE, PROVENANCE_LABELS, RESEARCH_SECTIONS, type Provenance, type ResearchSection } from '../../../../shared/constants'
import { addResearchItem, researchArray } from '../../../../shared/script'
import { api } from '../../lib/api'
import { useYObserve, type CreativeConnection } from '../../lib/collab'
import { useToast } from '../../lib/toast'
import { AiChat } from './AiChat'

function AutoText({ value, onChange, placeholder, label, autoFocus }: { value: string; onChange: (v: string) => void; placeholder?: string; label: string; autoFocus?: boolean }) {
  const ref = useRef<HTMLTextAreaElement>(null)
  // Focus in the same render as the item appears, so no keystroke typed right after "+" is lost.
  useLayoutEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  return <textarea ref={ref} rows={1} value={value} placeholder={placeholder} aria-label={label} onChange={(e) => onChange(e.target.value)} />
}

function ProvenanceTag({ value, onChange }: { value: Provenance; onChange: (p: Provenance) => void }) {
  return (
    <select
      className={`prov prov-${value}`}
      value={value}
      onChange={(e) => onChange(e.target.value as Provenance)}
      aria-label="מקור המידע"
      title="מקור המידע"
      style={{ width: 'auto', height: 'auto', padding: '1px 4px' }}
    >
      {PROVENANCE.map((p) => (
        <option key={p} value={p}>{PROVENANCE_LABELS[p]}</option>
      ))}
    </select>
  )
}

function Section({ doc, section, label }: { doc: Y.Doc; section: ResearchSection; label: string }) {
  const arr = researchArray(doc, section)
  useYObserve(arr)
  const items = arr.toArray()
  const [focusId, setFocusId] = useState<string | null>(null)
  const add = () => {
    addResearchItem(doc, section, { text: '', provenance: 'user', source: '' })
    setFocusId(String(arr.get(arr.length - 1).get('id')))
  }
  return (
    <div className="research-section" data-section={section}>
      <h4>
        {label}
        <span className="subtle">({items.length})</span>
        <span className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={add} aria-label={`הוספה ל${label}`}>+ הוספה</button>
      </h4>
      {items.map((m, i) => {
        const prov = (m.get('provenance') as Provenance) ?? 'user'
        return (
          <div key={String(m.get('id'))} className="research-item">
            <div style={{ flex: 1, minWidth: 0 }} className="stack-sm">
              <AutoText value={String(m.get('text') ?? '')} onChange={(v) => m.set('text', v)} label={label} placeholder="כתבו כאן…" autoFocus={focusId === String(m.get('id'))} />
              {prov === 'sourced' && (
                <input type="text" className="small" value={String(m.get('source') ?? '')} onChange={(e) => m.set('source', e.target.value)} placeholder="מקור (קישור / שם)" style={{ padding: '2px 6px' }} />
              )}
              {prov === 'ai_example' && <span className="subtle">דוגמה בלבד — לא ציטוט של לקוח אמיתי</span>}
            </div>
            <ProvenanceTag value={prov} onChange={(p) => m.set('provenance', p)} />
            <button className="icon-btn" aria-label="מחיקה" title="מחיקה" onClick={() => arr.delete(i, 1)}>×</button>
          </div>
        )
      })}
    </div>
  )
}

/** Customer research stored inside this creative's shared document. */
export function ResearchPanel({ conn, creative, onAngle, startWithChat }: { conn: CreativeConnection; creative: any; onAngle: (angle: string) => void; startWithChat?: boolean }) {
  const [view, setView] = useState<'fields' | 'chat'>(startWithChat ? 'chat' : 'fields')
  const toast = useToast()

  const applyUpdates = async (message: any, indexes: number[]) => {
    const updates = indexes.map((i) => message.payload.updates[i])
    conn.doc.transact(() => {
      for (const u of updates) addResearchItem(conn.doc, u.section, { text: u.text, provenance: u.provenance, source: u.source ?? '' })
    })
    try {
      const r = await api.post(`/ai/messages/${message.id}/research-applied`, { indexes })
      message.payload = r.payload
      toast.show('success', indexes.length > 1 ? `${indexes.length} פריטים נוספו למחקר` : 'נוסף למחקר')
    } catch {
      // The items are in the shared document (and saved through it); only the "added" marker failed.
    }
  }

  return (
    <div className="stack" style={{ height: '100%' }}>
      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        <button className={view === 'fields' ? 'active' : ''} onClick={() => setView('fields')}>שדות המחקר</button>
        <button className={view === 'chat' ? 'active' : ''} onClick={() => setView('chat')}>שיחת חקר עם AI</button>
      </div>
      {view === 'fields' ? (
        <div>
          <div className="alert alert-warn small" style={{ marginBottom: 10 }} data-testid="research-overwrite-note">
            שימו לב: כל פריט מחקר נשמר כשדה אחד. אם שניכם עורכים <strong>את אותו פריט</strong> באותו רגע — השינוי האחרון קובע ועלול לדרוס את השני. פריטים שונים לא מתנגשים, והתסריט עצמו ממוזג בלי דריסה.
          </div>
          <div className="row-wrap subtle" style={{ marginBottom: 10 }}>
            {PROVENANCE.map((p) => (
              <span key={p} className={`prov prov-${p}`}>{PROVENANCE_LABELS[p]}</span>
            ))}
          </div>
          {RESEARCH_SECTIONS.map((s) => (
            <Section key={s.key} doc={conn.doc} section={s.key} label={s.label} />
          ))}
        </div>
      ) : (
        <div style={{ flex: 1, minHeight: 0 }}>
          <AiChat
            conn={conn}
            creativeId={creative.id}
            kind="research"
            intro="נבנה יחד את חקר הלקוח לקריאייטיב הזה. ספרו במשפט או שניים על הרעיון או הקהל — ואשאל שאלות בהדרגה. אפשר להתחיל לכתוב בכל שלב."
            renderExtras={(m) =>
              m.role === 'assistant' && (m.payload?.updates?.length || m.payload?.suggested_angle) ? (
                <ResearchUpdates message={m} onApply={applyUpdates} onAngle={onAngle} />
              ) : null
            }
          />
        </div>
      )}
    </div>
  )
}

function ResearchUpdates({ message, onApply, onAngle }: { message: any; onApply: (m: any, idx: number[]) => Promise<void>; onAngle: (a: string) => void }) {
  const [, force] = useState(0)
  const updates: any[] = message.payload?.updates ?? []
  const pending = updates.filter((u) => !u.applied).map((u) => u.index)
  const label = (key: string) => RESEARCH_SECTIONS.find((s) => s.key === key)?.label ?? key
  const apply = async (idx: number[]) => {
    await onApply(message, idx)
    force((n) => n + 1)
  }
  return (
    <div className="suggestion">
      {updates.length > 0 && (
        <>
          <div className="row small">
            <strong>עדכונים מוצעים למחקר</strong>
            <span className="spacer" />
            {pending.length > 1 && <button className="btn btn-sm" onClick={() => apply(pending)}>הוספת הכול</button>}
          </div>
          {updates.map((u) => (
            <div key={u.index} className="update-item">
              <span className={`prov prov-${u.provenance}`}>{PROVENANCE_LABELS[u.provenance as Provenance]}</span>
              <div style={{ flex: 1 }}>
                <div className="subtle">{label(u.section)}</div>
                <div className="bidi">{u.text}</div>
                {u.source && <div className="subtle ltr">{u.source}</div>}
              </div>
              {u.applied ? <span className="badge badge-ok">נוסף</span> : <button className="btn btn-sm" onClick={() => apply([u.index])}>הוספה</button>}
            </div>
          ))}
        </>
      )}
      {message.payload?.suggested_angle && (
        <div className="row small">
          <span className="spacer bidi">זווית מוצעת: <strong>{message.payload.suggested_angle}</strong></span>
          <button className="btn btn-sm" onClick={() => onAngle(message.payload.suggested_angle)}>קביעה כזווית</button>
        </div>
      )}
    </div>
  )
}
