import { useState } from 'react'
import { FIELD_LABELS } from '../../../../shared/constants'
import type { ScriptSnapshot } from '../../../../shared/script'
import { api, ApiError, errorMessage } from '../../lib/api'
import { useToast } from '../../lib/toast'

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

export function currentTargetText(snap: ScriptSnapshot, target: string | null): string | null {
  if (!target) return null
  if (target.startsWith('hook:')) return snap.hooks.find((h) => `hook:${h.id}` === target)?.text ?? null
  return (snap as any)[target] ?? null
}

function targetLabel(snap: ScriptSnapshot, target: string | null) {
  if (!target) return ''
  if (target.startsWith('hook:')) {
    const i = snap.hooks.findIndex((h) => `hook:${h.id}` === target)
    return i === -1 ? 'הוק שנמחק' : `הוק ${i + 1}`
  }
  return FIELD_LABELS[target] ?? target
}

const ISSUE_LABELS: Record<string, string> = {
  new_hook: 'הוק חדש',
  rewrite: 'הצעת שכתוב',
  note: 'הערה',
}

/**
 * An AI suggestion awaiting a decision. Nothing changes until someone approves it, and a rewrite
 * is blocked if the text changed since the AI saw it (checked here and again on the server).
 */
export function SuggestionCard({ s, snap, selectedHookId, onResolved }: { s: any; snap: ScriptSnapshot; selectedHookId: string | null; onResolved: () => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  const current = currentTargetText(snap, s.target)
  const stale = s.kind === 'rewrite' && (current === null || norm(current) !== norm(s.base_text ?? ''))
  const resolved = s.status !== 'pending'

  const act = async (action: 'apply' | 'add-as-hook' | 'reject', okText: string) => {
    setBusy(true)
    setError(null)
    try {
      await api.post(`/suggestions/${s.id}/${action}`, action === 'add-as-hook' ? { afterHookId: selectedHookId } : {})
      toast.show('success', okText)
      onResolved()
    } catch (e) {
      setError(errorMessage(e))
      if (e instanceof ApiError && e.status === 409 && e.message.includes('כבר טופלה')) onResolved()
    } finally {
      setBusy(false)
    }
  }
  const copy = async () => {
    await navigator.clipboard.writeText(s.text).then(
      () => toast.show('success', 'הועתק'),
      () => toast.show('error', 'ההעתקה נכשלה'),
    )
  }

  return (
    <div className={`suggestion ${resolved ? 'resolved' : ''}`} data-testid="suggestion">
      <div className="row small">
        <span className="badge">{ISSUE_LABELS[s.kind] ?? s.kind}</span>
        {s.target && <span className="subtle">על {targetLabel(snap, s.target)}</span>}
        {s.origin === 'proactive' && <span className="subtle">· הצעה יזומה</span>}
        <span className="spacer" />
        {resolved && <span className="subtle">{{ applied: 'הוחל', added_as_hook: 'נוסף כהוק', rejected: 'נדחה', dismissed: 'הוחלף בבדיקה חדשה' }[s.status as string]}</span>}
      </div>
      {s.kind !== 'note' ? <div className="suggestion-text bidi">{s.text}</div> : <div className="bidi small">{s.text}</div>}
      {s.reason && <div className="suggestion-reason bidi">למה: {s.reason}</div>}
      {!resolved && stale && (
        <div className="alert alert-warn small">הטקסט השתנה מאז שההצעה נוצרה — אי אפשר להחיל אותה בלי לדרוס עריכה חדשה יותר.</div>
      )}
      {error && <div className="alert alert-error small">{error}</div>}
      {!resolved && (
        <div className="row-wrap">
          {s.kind === 'rewrite' && (
            <button className="btn btn-primary btn-sm" disabled={busy || stale} onClick={() => act('apply', 'ההצעה הוחלה על הטקסט')}>החלה על הטקסט</button>
          )}
          {(s.kind === 'new_hook' || (s.kind === 'rewrite' && s.target?.startsWith('hook:'))) && (
            <button className={`btn btn-sm ${s.kind === 'new_hook' ? 'btn-primary' : ''}`} disabled={busy} onClick={() => act('add-as-hook', 'נוסף הוק חדש')}>
              הוספה כהוק חדש
            </button>
          )}
          {s.kind !== 'note' && <button className="btn btn-sm btn-ghost" onClick={copy}>העתקה</button>}
          <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => act('reject', s.kind === 'note' ? 'סומן כטופל' : 'ההצעה נדחתה')}>
            {s.kind === 'note' ? 'סימון כטופל' : 'דחייה'}
          </button>
        </div>
      )}
    </div>
  )
}
