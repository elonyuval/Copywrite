import { useState } from 'react'
import { ErrorBox, Loading } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import { useAuth, useMe } from '../lib/auth'
import { fullDate } from '../lib/format'
import { useToast } from '../lib/toast'
import { useAsync } from '../lib/useAsync'

const COLORS = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2', '#dc2626']

export function SettingsPage() {
  const me = useMe()
  const { refresh } = useAuth()
  const toast = useToast()
  const data = useAsync(() => Promise.all([api.get('/workspace/members'), api.get('/api-tokens')]), [])
  const [invite, setInvite] = useState<{ code: string; expiresAt: string } | null>(null)
  const [newToken, setNewToken] = useState<string | null>(null)
  const [profile, setProfile] = useState({ name: me.user.name, color: me.user.color })

  const createInvite = async () => {
    try {
      setInvite(await api.post('/workspace/invites'))
    } catch (e) {
      toast.show('error', errorMessage(e))
    }
  }
  const saveProfile = async () => {
    try {
      await api.patch('/me', profile)
      await refresh()
      toast.show('success', 'הפרופיל נשמר')
    } catch (e) {
      toast.show('error', errorMessage(e))
    }
  }
  const createToken = async () => {
    const name = prompt('שם לטוקן (למשל: חיבור MCP)')
    if (!name) return
    try {
      const r = await api.post('/api-tokens', { name })
      setNewToken(r.token)
      data.reload(true)
    } catch (e) {
      toast.show('error', errorMessage(e))
    }
  }
  const revoke = async (id: string) => {
    if (!confirm('לבטל את הטוקן? חיבורים שמשתמשים בו יפסיקו לעבוד.')) return
    await api.del(`/api-tokens/${id}`).catch((e) => toast.show('error', errorMessage(e)))
    data.reload(true)
  }

  return (
    <div className="page">
      <div className="page-inner stack" style={{ gap: 22, maxWidth: 820 }}>
        <h1>הגדרות וחיבורים</h1>

        <section className="card card-pad stack">
          <h2>חיבור AI (OpenAI)</h2>
          {me.aiConfigured ? (
            <div className="alert alert-ok">מחובר · מודל: <span className="ltr">{me.aiModel}</span>. המפתח שמור בשרת בלבד ואינו נשלח לדפדפן.</div>
          ) : (
            <div className="alert alert-warn stack-sm">
              <strong>לא מוגדר.</strong>
              <span>כל ה-AI (חקר, עוזר, הצעות, גרסה קצרה) דורש מפתח API של OpenAI. השימוש מחויב בנפרד בחשבון OpenAI, ואינו קשור למנוי ChatGPT.</span>
              <ol style={{ margin: 0, paddingInlineStart: 20 }}>
                <li>יוצרים מפתח ב-<a className="ltr" href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">platform.openai.com/api-keys</a> ומגדירים אמצעי תשלום.</li>
                <li>מוסיפים בהגדרות השרת: <code className="ltr">OPENAI_API_KEY=sk-…</code> (ואופציונלית <code className="ltr">OPENAI_MODEL</code>).</li>
                <li>מפעילים מחדש את השרת.</li>
              </ol>
            </div>
          )}
          <div className="subtle">המערכת לא מחוברת לשיחות או לזיכרונות שלכם ב-ChatGPT. מידע משם זמין רק אם תעתיקו אותו ל״העדפות ושיטות עבודה״.</div>
        </section>

        <section className="card card-pad stack">
          <h2>הפרופיל שלי</h2>
          <div className="row-wrap">
            <label className="field" style={{ flex: 1, minWidth: 200 }}>שם<input type="text" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></label>
            <div className="field">
              צבע (לסמן ולנוכחות)
              <div className="row">
                {COLORS.map((c) => (
                  <button key={c} aria-label={c} onClick={() => setProfile({ ...profile, color: c })} style={{ width: 24, height: 24, borderRadius: '50%', background: c, border: profile.color === c ? '3px solid #1c1917' : '2px solid white', cursor: 'pointer' }} />
                ))}
              </div>
            </div>
          </div>
          <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={saveProfile}>שמירה</button>
        </section>

        <section className="card card-pad stack">
          <h2>חברי סביבת העבודה</h2>
          {data.loading && !data.data && <Loading />}
          {data.error && <ErrorBox error={data.error} onRetry={() => data.reload()} />}
          {data.data?.[0].map((m: any) => (
            <div key={m.id} className="row">
              <span className="avatar" style={{ background: m.color }}>{m.name[0]}</span>
              <span>{m.name}</span>
              <span className="subtle ltr">{m.email}</span>
              {m.role === 'owner' && <span className="badge">בעלים</span>}
            </div>
          ))}
          <div className="row-wrap">
            <button className="btn btn-sm" onClick={createInvite}>יצירת קוד הזמנה</button>
            {invite && (
              <span className="row">
                <code className="ltr" style={{ background: '#f0efed', padding: '2px 8px', borderRadius: 6 }} data-testid="invite-code">{invite.code}</code>
                <button className="btn btn-sm btn-ghost" onClick={() => navigator.clipboard.writeText(invite.code)}>העתקה</button>
                <span className="subtle">חד-פעמי, בתוקף עד {fullDate(invite.expiresAt)}</span>
              </span>
            )}
          </div>
          <div className="subtle">השותף/ה נכנס/ת לכתובת המערכת → ״הצטרפות״ → מזין/ה את הקוד.</div>
        </section>

        <section className="card card-pad stack">
          <h2>גישה חיצונית (API לקריאה בלבד)</h2>
          <div className="subtle">
            הכנה לחיבור עתידי (למשל שרת MCP או אוטומציה) לקריאת מוצרים, קריאייטיבים והיסטוריה. הטוקן מאפשר קריאה בלבד ורק של סביבת העבודה הזו. שום חיבור חיצוני לא פעיל עד שיוגדר במפורש.
          </div>
          <code className="ltr small" style={{ whiteSpace: 'pre-wrap', background: '#f7f6f4', padding: 10, borderRadius: 8 }}>
            {`GET /api/ext/v1/brands\nGET /api/ext/v1/products\nGET /api/ext/v1/products/:id/creatives\nGET /api/ext/v1/creatives/:id\nGET /api/ext/v1/creatives/:id/history\nAuthorization: Bearer <token>`}
          </code>
          {newToken && (
            <div className="alert alert-ok stack-sm">
              <span>הטוקן נוצר. העתיקו אותו עכשיו — הוא לא יוצג שוב:</span>
              <code className="ltr" style={{ wordBreak: 'break-all' }}>{newToken}</code>
            </div>
          )}
          {data.data?.[1].map((t: any) => (
            <div key={t.id} className="row small">
              <span>{t.name}</span>
              <span className="subtle">{t.created_by_name} · {fullDate(t.created_at)}{t.last_used_at ? ` · שימוש אחרון ${fullDate(t.last_used_at)}` : ''}</span>
              <span className="spacer" />
              {t.revoked_at ? <span className="badge">בוטל</span> : <button className="btn btn-sm btn-ghost btn-danger" onClick={() => revoke(t.id)}>ביטול</button>}
            </div>
          ))}
          <button className="btn btn-sm" style={{ alignSelf: 'flex-start' }} onClick={createToken}>יצירת טוקן</button>
        </section>
      </div>
    </div>
  )
}
