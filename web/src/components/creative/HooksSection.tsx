import type { HocuspocusProvider } from '@hocuspocus/provider'
import { useState } from 'react'
import type * as Y from 'yjs'
import { addHook, fragmentToText, hookFragment, hookFieldName, hooksMap, listHooks, moveHook, setHookDeleted } from '../../../../shared/script'
import { useYObserve, type PresenceUser } from '../../lib/collab'
import { useToast } from '../../lib/toast'
import { FieldEditor } from '../FieldEditor'
import { Avatar } from '../ui'

interface Props {
  doc: Y.Doc
  provider: HocuspocusProvider
  userId: string
  selectedHookId: string | null
  onSelect: (id: string) => void
  presence: PresenceUser[]
}

/**
 * Hook variations. Only hooks vary; lead/body/CTA are shared and stored once.
 * Deletion is a soft delete (undo from the toast or the "deleted hooks" list).
 */
export function HooksSection({ doc, provider, userId, selectedHookId, onSelect, presence }: Props) {
  const map = hooksMap(doc)
  useYObserve(map)
  const hooks = listHooks(doc)
  const deleted = listHooks(doc, { includeDeleted: true }).filter((h) => h.deleted)
  const [showDeleted, setShowDeleted] = useState(false)
  const toast = useToast()

  const add = () => {
    const id = addHook(doc, { createdBy: userId })
    onSelect(id)
    setTimeout(() => document.querySelector<HTMLElement>(`[data-field="${hookFieldName(id)}"]`)?.focus(), 50)
  }
  const remove = (id: string, n: number) => {
    setHookDeleted(doc, id, true)
    if (selectedHookId === id) {
      const next = listHooks(doc)[0]
      if (next) onSelect(next.id)
    }
    toast.show('info', `הוק ${n} נמחק`, { action: { label: 'ביטול', onClick: () => setHookDeleted(doc, id, false) }, ms: 9000 })
  }

  return (
    <div>
      <div className="block-label">
        הוקים <span className="hint">· רק ההוק משתנה בין הווריאציות · {hooks.length} הוקים</span>
      </div>
      {hooks.map((h, i) => {
        const editors = presence.filter((p) => !p.self && p.activeField === hookFieldName(h.id))
        const selected = h.id === selectedHookId
        return (
          <div key={h.id} className={`hook-card ${selected ? 'selected' : ''}`} data-hook-id={h.id}>
            <div className="hook-head">
              <span className="hook-num">הוק {i + 1}</span>
              <button className={`btn btn-sm ${selected ? 'btn-ghost' : 'btn-ghost'} hook-select`} onClick={() => onSelect(h.id)} aria-pressed={selected}>
                {selected ? '● נבחר לתצוגה' : '○ בחירה'}
              </button>
              {editors.map((p) => (
                <Avatar key={p.clientId} name={p.name} color={p.color} title={`${p.name} עורך/ת כאן`} />
              ))}
              <div className="hook-actions">
                <button className="icon-btn" title="הזזה למעלה" aria-label="הזזה למעלה" disabled={i === 0} onClick={() => moveHook(doc, h.id, -1)}>↑</button>
                <button className="icon-btn" title="הזזה למטה" aria-label="הזזה למטה" disabled={i === hooks.length - 1} onClick={() => moveHook(doc, h.id, 1)}>↓</button>
                <button className="icon-btn" title="שכפול הוק" aria-label="שכפול הוק" onClick={() => onSelect(addHook(doc, { afterId: h.id, copyFrom: h.id, createdBy: userId }))}>⧉</button>
                <button className="icon-btn" title="מחיקה" aria-label="מחיקת הוק" disabled={hooks.length <= 1} onClick={() => remove(h.id, i + 1)}>🗑</button>
              </div>
            </div>
            <div className="editor-wrap" onFocus={() => onSelect(h.id)}>
              <FieldEditor fragment={hookFragment(doc, h.id)} provider={provider} field={hookFieldName(h.id)} label={`הוק ${i + 1}`} placeholder="כתבו הוק — המשפט שעוצר את הגלילה…" />
            </div>
          </div>
        )
      })}
      <div className="row">
        <button className="btn" onClick={add}>+ הוק</button>
        {deleted.length > 0 && (
          <button className="btn btn-ghost btn-sm" onClick={() => setShowDeleted((s) => !s)}>
            הוקים שנמחקו ({deleted.length})
          </button>
        )}
      </div>
      {showDeleted && deleted.length > 0 && (
        <div className="card card-pad stack-sm" style={{ marginTop: 8 }}>
          {deleted.map((h) => (
            <div key={h.id} className="row">
              <span className="bidi spacer muted small">{fragmentToText(hookFragment(doc, h.id)) || '(הוק ריק)'}</span>
              <button className="btn btn-sm" onClick={() => setHookDeleted(doc, h.id, false)}>שחזור</button>
            </div>
          ))}
        </div>
      )}
      {map.size === 0 && <div className="subtle">אין הוקים</div>}
    </div>
  )
}
