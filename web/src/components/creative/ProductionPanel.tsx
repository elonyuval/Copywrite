import { useEffect, useRef, useState } from 'react'
import { api, errorMessage, fileUrl } from '../../lib/api'
import { useMe } from '../../lib/auth'
import type { CreativeConnection } from '../../lib/collab'
import { fileSize, fullDate, timeAgo } from '../../lib/format'
import { useToast } from '../../lib/toast'
import { Linkify } from '../Linkify'
import { Avatar, Empty, ErrorBox, Loading, Modal } from '../ui'

function useList(url: string, conn: CreativeConnection, scope: string) {
  const [items, setItems] = useState<any[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = async () => {
    try {
      setItems(await api.get(url))
      setError(null)
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  useEffect(() => {
    load()
    return conn.onNotify((m) => m.scope === scope && load())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url])
  return { items, error, load }
}

export function ApprovalBox({ creative, saveState, onChanged, conn }: { creative: any; saveState: string; onChanged: () => void; conn: CreativeConnection }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const toast = useToast()
  const approve = async () => {
    setBusy(true)
    try {
      await api.post(`/creatives/${creative.creative.id}/approve`, { note })
      toast.show('success', 'התסריט אושר. הגרסה המאושרת נשמרה בהיסטוריה.')
      setNote('')
      onChanged()
      conn.notify('meta')
    } catch (e) {
      toast.show('error', `האישור לא נשמר: ${errorMessage(e)}`)
    } finally {
      setBusy(false)
    }
  }
  const revoke = async () => {
    if (!confirm('לבטל את האישור?')) return
    try {
      await api.del(`/creatives/${creative.creative.id}/approve`)
      onChanged()
      conn.notify('meta')
    } catch (e) {
      toast.show('error', errorMessage(e))
    }
  }
  const c = creative.creative
  return (
    <div className="approval-box stack-sm" data-testid="approval">
      <strong>בדיקה ואישור תסריט</strong>
      {c.approved_at ? (
        c.needs_review ? (
          <div className="alert alert-warn small">
            התוכן השתנה אחרי האישור של {creative.approver?.name} ({fullDate(c.approved_at)}). <strong>נדרשת בדיקה מחודשת.</strong>
          </div>
        ) : (
          <div className="alert alert-ok small">✓ אושר על ידי {creative.approver?.name} · {fullDate(c.approved_at)}</div>
        )
      ) : (
        <div className="subtle">התסריט עוד לא אושר.</div>
      )}
      <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="הערה לאישור (לא חובה)" />
      <div className="row-wrap">
        <button className="btn btn-primary btn-sm" disabled={busy || saveState !== 'saved'} onClick={approve} title={saveState !== 'saved' ? 'יש לחכות לשמירה' : ''}>
          {c.approved_at ? 'אישור הגרסה הנוכחית' : 'אישור התסריט'}
        </button>
        {c.approved_at && <button className="btn btn-sm btn-ghost" onClick={revoke}>ביטול אישור</button>}
      </div>
      {saveState !== 'saved' && <span className="subtle">אפשר לאשר רק כשהכול נשמר.</span>}
    </div>
  )
}

function Comments({ creativeId, conn }: { creativeId: string; conn: CreativeConnection }) {
  const me = useMe()
  const { items, error, load } = useList(`/creatives/${creativeId}/comments`, conn, 'comments')
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const toast = useToast()
  const add = async () => {
    setBusy(true)
    try {
      await api.post(`/creatives/${creativeId}/comments`, { body })
      setBody('')
      await load()
      conn.notify('comments')
    } catch (e) {
      toast.show('error', `התגובה לא נשמרה: ${errorMessage(e)}`)
    } finally {
      setBusy(false)
    }
  }
  const remove = async (id: string) => {
    try {
      await api.del(`/comments/${id}`)
      await load()
      conn.notify('comments')
    } catch (e) {
      toast.show('error', errorMessage(e))
    }
  }
  return (
    <div>
      <strong>תגובות כלליות</strong>
      {error && <ErrorBox error={error} onRetry={load} />}
      {!items && !error && <Loading />}
      {items?.length === 0 && <div className="subtle" style={{ padding: '8px 0' }}>אין תגובות עדיין</div>}
      {items?.map((c) => (
        <div key={c.id} className="comment" data-testid="comment">
          <div className="row small">
            <Avatar name={c.user_name} color={c.user_color} />
            <strong>{c.user_name}</strong>
            <span className="subtle" title={fullDate(c.created_at)}>{timeAgo(c.created_at)}</span>
            <span className="spacer" />
            {c.user_id === me.user.id && <button className="btn-link small" onClick={() => remove(c.id)}>מחיקה</button>}
          </div>
          <div className="comment-body"><Linkify text={c.body} /></div>
        </div>
      ))}
      <div className="stack-sm" style={{ marginTop: 8 }}>
        <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="כתבו תגובה…" aria-label="תגובה חדשה" onKeyDown={(e) => e.key === 'Enter' && (e.metaKey || e.ctrlKey) && body.trim() && add()} />
        <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} disabled={!body.trim() || busy} onClick={add}>{busy ? 'שולח…' : 'הוספת תגובה'}</button>
      </div>
    </div>
  )
}

function AddAssetDialog({ creativeId, onClose, onAdded }: { creativeId: string; onClose: () => void; onAdded: () => void }) {
  const [kind, setKind] = useState<'file' | 'link'>('file')
  const [file, setFile] = useState<File | null>(null)
  const [form, setForm] = useState({ name: '', description: '', url: '' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  const submit = async () => {
    setBusy(true)
    setError(null)
    try {
      if (kind === 'file') {
        const fd = new FormData()
        fd.append('name', form.name)
        fd.append('description', form.description)
        fd.append('file', file!)
        await api.upload(`/creatives/${creativeId}/assets/file`, fd)
      } else {
        await api.post(`/creatives/${creativeId}/assets/link`, form)
      }
      onAdded()
      onClose()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }
  const valid = kind === 'file' ? !!file : form.url.trim() && form.name.trim()
  return (
    <Modal title="הוספת חומר הפקה" onClose={onClose} footer={<><button className="btn btn-primary" disabled={!valid || busy} onClick={submit}>{busy ? 'מעלה…' : 'הוספה'}</button><button className="btn btn-ghost" onClick={onClose}>ביטול</button></>}>
      <div className="seg" style={{ alignSelf: 'flex-start' }}>
        <button className={kind === 'file' ? 'active' : ''} onClick={() => setKind('file')}>קובץ</button>
        <button className={kind === 'link' ? 'active' : ''} onClick={() => setKind('link')}>קישור (למשל לסרטון)</button>
      </div>
      {kind === 'file' ? (
        <div className="row">
          <button className="btn" onClick={() => input.current?.click()}>בחירת קובץ</button>
          <span className="small bidi">{file ? `${file.name} · ${fileSize(file.size)}` : 'לא נבחר קובץ'}</span>
          <input ref={input} type="file" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </div>
      ) : (
        <label className="field">קישור<input type="url" dir="ltr" value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://" /></label>
      )}
      <label className="field">שם{kind === 'file' && <span className="hint">ברירת מחדל: שם הקובץ</span>}<input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
      <label className="field">תיאור<textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
      {error && <div className="alert alert-error">{error}</div>}
    </Modal>
  )
}

function Assets({ creativeId, conn }: { creativeId: string; conn: CreativeConnection }) {
  const { items, error, load } = useList(`/creatives/${creativeId}/assets`, conn, 'assets')
  const [adding, setAdding] = useState(false)
  const toast = useToast()
  const remove = async (a: any) => {
    if (!confirm(`להסיר את "${a.name}"?`)) return
    try {
      await api.del(`/assets/${a.id}`)
      await load()
      conn.notify('assets')
    } catch (e) {
      toast.show('error', errorMessage(e))
    }
  }
  return (
    <div>
      <div className="row">
        <strong>קבצים וקישורים</strong>
        <span className="spacer" />
        <button className="btn btn-sm" onClick={() => setAdding(true)}>+ הוספה</button>
      </div>
      {error && <ErrorBox error={error} onRetry={load} />}
      {!items && !error && <Loading />}
      {items?.length === 0 && <Empty icon="📎" title="אין עדיין חומרי הפקה">צילומים, עריכות, קבצים מוכנים וקישורים לסרטונים.</Empty>}
      {items?.map((a) => (
        <div key={a.id} className="asset" data-testid="asset">
          <span className="asset-icon">{a.kind === 'link' ? '🔗' : a.mime?.startsWith('video/') ? '🎬' : a.mime?.startsWith('image/') ? '🖼' : '📄'}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            {a.kind === 'link' ? (
              <a href={a.url} target="_blank" rel="noopener noreferrer" className="bidi" style={{ fontWeight: 500 }}>{a.name}</a>
            ) : (
              <a href={fileUrl(a.file_id)} target="_blank" rel="noopener noreferrer" className="bidi" style={{ fontWeight: 500 }}>{a.name}</a>
            )}
            {a.description && <div className="small muted bidi">{a.description}</div>}
            <div className="subtle">
              {a.user_name} · {timeAgo(a.created_at)}
              {a.size ? ` · ${fileSize(Number(a.size))}` : ''}
              {a.kind === 'file' && <> · <a href={`${fileUrl(a.file_id)}?download`}>הורדה</a></>}
            </div>
          </div>
          <button className="icon-btn" aria-label="הסרה" onClick={() => remove(a)}>×</button>
        </div>
      ))}
      {adding && <AddAssetDialog creativeId={creativeId} onClose={() => setAdding(false)} onAdded={() => { load(); conn.notify('assets') }} />}
    </div>
  )
}

export function ProductionPanel({ creative, conn, saveState, onChanged }: { creative: any; conn: CreativeConnection; saveState: string; onChanged: () => void }) {
  return (
    <div className="stack" style={{ gap: 20 }}>
      <ApprovalBox creative={creative} saveState={saveState} onChanged={onChanged} conn={conn} />
      <Comments creativeId={creative.creative.id} conn={conn} />
      <Assets creativeId={creative.creative.id} conn={conn} />
    </div>
  )
}
