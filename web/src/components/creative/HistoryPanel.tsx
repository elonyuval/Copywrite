import { useEffect, useState } from 'react'
import { STATUS_LABELS } from '../../../../shared/constants'
import { api, errorMessage } from '../../lib/api'
import type { CreativeConnection } from '../../lib/collab'
import { fullDate, timeAgo } from '../../lib/format'
import { useToast } from '../../lib/toast'
import { ErrorBox, Loading, Modal } from '../ui'

const REASONS: Record<string, string> = {
  created: 'נוצר',
  auto: 'שמירה אוטומטית',
  manual: 'נשמר ידנית',
  approval: 'גרסה שאושרה',
  pre_restore: 'לפני שחזור',
  restore: 'שחזור',
  ai_applied: 'לפני החלת הצעת AI',
}

const ACTIONS: Record<string, (d: any) => string> = {
  'creative.created': () => 'יצר/ה את הקריאייטיב',
  'creative.duplicated': (d) => `שכפל/ה מ״${d.sourceName}״`,
  'creative.status': (d) => `שינה/תה סטטוס ל״${STATUS_LABELS[d.to as keyof typeof STATUS_LABELS] ?? d.to}״`,
  'creative.renamed': () => 'עדכן/ה שם או זווית',
  'creative.approved': () => 'אישר/ה את התסריט',
  'creative.approval_revoked': () => 'ביטל/ה את האישור',
  'creative.needs_review': () => 'שינה/תה את התוכן אחרי האישור — נדרשת בדיקה מחודשת',
  'creative.matches_approved': () => 'החזיר/ה את התוכן לגרסה המאושרת',
  'creative.short_version_derived': (d) => `נוצרה גרסה קצרה (${d.target})`,
  'ai.short_version_created': (d) => `נוצר/ה כגרסה קצרה עם AI (${d.target})`,
  'ai.suggestion_applied': () => 'החיל/ה הצעת AI',
  'ai.hook_added': () => 'הוסיף/ה הוק מהצעת AI',
  'ai.research_applied': (d) => `הוסיף/ה ${d.count} פריטי מחקר מה-AI`,
  'version.saved': () => 'שמר/ה גרסה',
  'version.restored': (d) => `שחזר/ה גרסה מ-${fullDate(d.versionDate)}`,
  'comment.added': () => 'הוסיף/ה תגובה',
  'asset.added': (d) => `הוסיף/ה ${d.kind === 'link' ? 'קישור' : 'קובץ'}: ${d.name}`,
  'asset.removed': (d) => `הסיר/ה: ${d.name}`,
  'creative.archived': () => 'העביר/ה לארכיון',
}

function VersionView({ id, onClose }: { id: string; onClose: () => void }) {
  const [v, setV] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    api.get(`/versions/${id}`).then(setV, (e) => setError(errorMessage(e)))
  }, [id])
  return (
    <Modal title={v ? `גרסה מ-${fullDate(v.created_at)}` : 'גרסה'} onClose={onClose} wide>
      {error && <ErrorBox error={error} />}
      {!v && !error && <Loading />}
      {v && (
        <div className="stack bidi" style={{ whiteSpace: 'pre-wrap' }}>
          {v.snapshot.hooks.map((h: any, i: number) => (
            <div key={h.id}><strong className="small">הוק {i + 1}</strong><div>{h.text || '—'}</div></div>
          ))}
          <div><strong className="small">ליד</strong><div>{v.snapshot.lead || '—'}</div></div>
          <div><strong className="small">גוף</strong><div>{v.snapshot.body || '—'}</div></div>
          <div><strong className="small">קריאה לפעולה</strong><div>{v.snapshot.cta || '—'}</div></div>
          {v.snapshot.shooting && <div className="muted"><strong className="small">הוראות צילום</strong><div>{v.snapshot.shooting}</div></div>}
        </div>
      )}
    </Modal>
  )
}

export function HistoryPanel({ creativeId, conn }: { creativeId: string; conn: CreativeConnection }) {
  const [versions, setVersions] = useState<any[] | null>(null)
  const [activity, setActivity] = useState<any[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const load = async () => {
    try {
      const [v, a] = await Promise.all([api.get(`/creatives/${creativeId}/versions`), api.get(`/creatives/${creativeId}/activity`)])
      setVersions(v)
      setActivity(a)
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  useEffect(() => {
    load()
    return conn.onNotify(() => load())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creativeId])

  const saveNow = async () => {
    const label = prompt('שם לגרסה (לא חובה)') ?? undefined
    if (label === null) return
    setBusy(true)
    try {
      await api.post(`/creatives/${creativeId}/versions`, { label: label || undefined })
      toast.show('success', 'הגרסה נשמרה')
      load()
    } catch (e) {
      toast.show('error', errorMessage(e))
    } finally {
      setBusy(false)
    }
  }
  const restore = async (v: any) => {
    if (!confirm(`לשחזר את הגרסה מ-${fullDate(v.created_at)}? המצב הנוכחי יישמר קודם בהיסטוריה, כך שאפשר לחזור אליו.`)) return
    setBusy(true)
    try {
      await api.post(`/creatives/${creativeId}/versions/${v.id}/restore`)
      toast.show('success', 'הגרסה שוחזרה')
      load()
      conn.notify('history')
    } catch (e) {
      toast.show('error', `השחזור נכשל: ${errorMessage(e)}`)
    } finally {
      setBusy(false)
    }
  }

  if (error) return <ErrorBox error={error} onRetry={load} />
  if (!versions || !activity) return <Loading />
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div>
        <div className="row">
          <strong>גרסאות</strong>
          <span className="spacer" />
          <button className="btn btn-sm" disabled={busy} onClick={saveNow}>שמירת גרסה עכשיו</button>
        </div>
        <div className="subtle">גרסה נשמרת אוטומטית כל כמה דקות של עבודה, לפני שחזור ולפני החלת הצעות AI.</div>
        {versions.map((v) => (
          <div key={v.id} className="timeline-item" data-testid="version">
            <div style={{ flex: 1 }}>
              <div>
                {v.label || REASONS[v.reason] || v.reason} {v.is_approved && <span className="badge badge-ok">מאושרת</span>}
              </div>
              <div className="subtle">{v.user_name ?? 'מערכת'} · {fullDate(v.created_at)}</div>
            </div>
            <button className="btn btn-sm btn-ghost" onClick={() => setView(v.id)}>צפייה</button>
            <button className="btn btn-sm btn-ghost" disabled={busy} onClick={() => restore(v)}>שחזור</button>
          </div>
        ))}
      </div>
      <div>
        <strong>יומן פעולות</strong>
        {activity.length === 0 && <div className="subtle">אין פעולות</div>}
        {activity.map((a) => (
          <div key={a.id} className="timeline-item">
            <span className="dot" style={{ background: a.user_color ?? '#a8a29e', marginTop: 7 }} />
            <div style={{ flex: 1 }}>
              <span><strong>{a.user_name ?? 'מערכת'}</strong> {(ACTIONS[a.action] ?? (() => a.action))(a.details ?? {})}</span>
              <div className="subtle" title={fullDate(a.created_at)}>{timeAgo(a.created_at)}</div>
            </div>
          </div>
        ))}
      </div>
      {view && <VersionView id={view} onClose={() => setView(null)} />}
    </div>
  )
}
