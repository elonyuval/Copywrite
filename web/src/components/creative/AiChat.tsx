import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { api, errorMessage } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import type { CreativeConnection } from '../../lib/collab'
import { timeAgo } from '../../lib/format'
import { Linkify } from '../Linkify'
import { Avatar, ErrorBox, Loading } from '../ui'

interface Props {
  conn: CreativeConnection
  creativeId: string
  kind: 'assistant' | 'research'
  intro: string
  hookId?: string | null
  renderExtras?: (message: any) => ReactNode
  onReply?: (result: any) => void
  quickPrompts?: string[]
}

/** Conversation stored per creative. Shows which team member wrote each message. */
export function AiChat({ conn, creativeId, kind, intro, hookId, renderExtras, onReply, quickPrompts }: Props) {
  const { me } = useAuth()
  const [messages, setMessages] = useState<any[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const load = async () => {
    try {
      const r = await api.get(`/creatives/${creativeId}/ai/${kind}`)
      setMessages(r.messages)
      setLoadError(null)
    } catch (e) {
      setLoadError(errorMessage(e))
    }
  }
  useEffect(() => {
    load()
    return conn.onNotify((m) => m.scope === `ai:${kind}` && load())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creativeId, kind])
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [messages?.length, sending])

  const send = async (text = draft) => {
    const message = text.trim()
    if (!message || sending) return
    setSending(true)
    setError(null)
    const optimistic = { id: `tmp-${Date.now()}`, role: 'user', content: message, user_name: me!.user.name, user_color: me!.user.color, created_at: new Date().toISOString(), pending: true }
    setMessages((m) => [...(m ?? []), optimistic])
    setDraft('')
    try {
      const r = await api.post(`/creatives/${creativeId}/ai/${kind}`, { message, hookId })
      await load()
      onReply?.(r)
      conn.notify(`ai:${kind}`)
    } catch (e) {
      // Nothing was saved on the server; put the text back so it can be retried.
      setMessages((m) => (m ?? []).filter((x) => x.id !== optimistic.id))
      setDraft(message)
      setError(errorMessage(e))
    } finally {
      setSending(false)
    }
  }

  if (!me) return null
  return (
    <div className="chat">
      {!me.aiConfigured && (
        <div className="alert alert-warn small">
          חיבור ה-AI לא מוגדר, ולכן אין תשובות. <Link to="/settings">איך מגדירים</Link>
        </div>
      )}
      <div className="chat-log" ref={logRef}>
        {loadError && <ErrorBox error={loadError} onRetry={load} />}
        {!messages && !loadError && <Loading />}
        {messages && messages.length === 0 && (
          <div className="msg msg-assistant">
            <div className="msg-body">{intro}</div>
          </div>
        )}
        {messages?.map((m) => (
          <div key={m.id} className={`msg msg-${m.role}`} style={{ opacity: m.pending ? 0.6 : 1 }}>
            <div className="msg-meta">
              {m.role === 'user' ? <Avatar name={m.user_name ?? '?'} color={m.user_color ?? '#999'} /> : <span className="avatar" style={{ background: 'var(--accent)' }}>AI</span>}
              <span>{m.role === 'user' ? m.user_name : 'עוזר AI'}</span>
              <span>· {timeAgo(m.created_at)}</span>
            </div>
            <div className="msg-body bidi">
              <Linkify text={m.content} />
            </div>
            {renderExtras?.(m)}
          </div>
        ))}
        {sending && (
          <div className="msg msg-assistant">
            <div className="msg-body"><span className="spinner" /> חושב…</div>
          </div>
        )}
      </div>
      <div className="chat-input">
        {error && <div className="alert alert-error small">{error}</div>}
        {quickPrompts && (
          <div className="chips">
            {quickPrompts.map((q) => (
              <button key={q} className="chip" disabled={sending || !me.aiConfigured} onClick={() => send(q)}>{q}</button>
            ))}
          </div>
        )}
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={kind === 'research' ? 'ספרו על הקהל, הבעיה, מה כבר ניסו…' : 'בקשו הוקים, שיפור לגוף, בדיקת היגיון…'}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) send()
          }}
          aria-label="הודעה לעוזר"
          disabled={!me.aiConfigured}
        />
        <div className="row">
          <span className="subtle">Ctrl+Enter לשליחה</span>
          <span className="spacer" />
          <button className="btn btn-primary btn-sm" disabled={!draft.trim() || sending || !me.aiConfigured} onClick={() => send()}>
            {sending ? 'שולח…' : 'שליחה'}
          </button>
        </div>
      </div>
    </div>
  )
}
