import { useState } from 'react'
import { PREFERENCE_CATEGORIES, type PreferenceCategory } from '../../../shared/constants'
import { Empty, ErrorBox, Loading, Modal } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import { useToast } from '../lib/toast'
import { useAsync } from '../lib/useAsync'

const HINTS: Record<PreferenceCategory, string> = {
  style: 'טון, אורך משפטים, סלנג, גוף ראשון/שני…',
  method: 'מבנים ועקרונות שעובדים לנו — למשל: הוק לא חושף את המוצר.',
  example: 'תסריטים או הוקים שאהבנו (הדביקו טקסט).',
  brand_guideline: 'מילים מותרות/אסורות, הבטחות שאסור לתת, שפה של המותג.',
  avoid: 'דברים שלא רוצים לראות בכלל.',
  imported: 'מידע שהעתקתם במפורש ממקום אחר (למשל זיכרונות מ-ChatGPT).',
}

function PrefDialog({ initial, brands, onClose, onSaved }: { initial?: any; brands: any[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    category: (initial?.category ?? 'style') as PreferenceCategory,
    title: initial?.title ?? '',
    content: initial?.content ?? '',
    brandId: initial?.brand_id ?? '',
    active: initial?.active ?? true,
  })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    setBusy(true)
    try {
      const body = { ...form, brandId: form.brandId || null }
      if (initial) await api.put(`/preferences/${initial.id}`, body)
      else await api.post('/preferences', body)
      onSaved()
      onClose()
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <Modal title={initial ? 'עריכת פריט' : 'פריט חדש'} onClose={onClose} wide footer={<><button className="btn btn-primary" disabled={busy || !form.title.trim() || !form.content.trim()} onClick={submit}>שמירה</button><button className="btn btn-ghost" onClick={onClose}>ביטול</button></>}>
      <div className="row-wrap">
        <label className="field" style={{ flex: 1 }}>
          סוג
          <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value as PreferenceCategory })}>
            {Object.entries(PREFERENCE_CATEGORIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <label className="field" style={{ flex: 1 }}>
          חל על
          <select value={form.brandId} onChange={(e) => setForm({ ...form, brandId: e.target.value })}>
            <option value="">כל המותגים</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </label>
      </div>
      <label className="field">כותרת<input type="text" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
      <label className="field">
        תוכן <span className="hint">{HINTS[form.category]}</span>
        <textarea className="bidi" style={{ minHeight: 160 }} value={form.content} onChange={(e) => setForm({ ...form, content: e.target.value })} />
      </label>
      <label className="checkbox"><input type="checkbox" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> פעיל — העוזר משתמש בזה</label>
      {error && <div className="alert alert-error">{error}</div>}
    </Modal>
  )
}

export function PreferencesPage() {
  const prefs = useAsync(() => Promise.all([api.get('/preferences'), api.get('/home')]), [])
  const [editing, setEditing] = useState<any | 'new' | null>(null)
  const toast = useToast()
  if (prefs.loading && !prefs.data) return <div className="page"><Loading /></div>
  if (prefs.error || !prefs.data) return <div className="page"><div className="page-inner"><ErrorBox error={prefs.error ?? ''} onRetry={() => prefs.reload()} /></div></div>
  const [items, home] = prefs.data
  const remove = async (p: any) => {
    if (!confirm(`למחוק את "${p.title}"?`)) return
    try {
      await api.del(`/preferences/${p.id}`)
      prefs.reload(true)
    } catch (e) {
      toast.show('error', errorMessage(e))
    }
  }
  return (
    <div className="page">
      <div className="page-inner stack" style={{ gap: 18 }}>
        <div className="page-head" style={{ marginBottom: 0 }}>
          <h1>העדפות ושיטות עבודה</h1>
          <button className="btn btn-primary" onClick={() => setEditing('new')}>+ פריט חדש</button>
        </div>
        <div className="alert alert-info">
          כאן נשמר ה״זיכרון״ של העוזר: הוא מקבל את הפריטים הפעילים (הכלליים + של המותג הרלוונטי) בכל בקשה. לעוזר אין גישה לשיחות או לזיכרונות בחשבון ChatGPT שלכם — מידע כזה יהיה זמין רק אם תעתיקו אותו לכאן במפורש (סוג ״יובא ידנית״).
        </div>
        {items.length === 0 && <div className="card"><Empty icon="✦" title="עדיין אין העדפות">מתחילים עם סגנון כתיבה ודברים שחשוב להימנע מהם.</Empty></div>}
        {(Object.keys(PREFERENCE_CATEGORIES) as PreferenceCategory[]).map((cat) => {
          const list = items.filter((p: any) => p.category === cat)
          if (!list.length) return null
          return (
            <section key={cat}>
              <div className="section-title"><h2>{PREFERENCE_CATEGORIES[cat]}</h2></div>
              <div className="stack-sm">
                {list.map((p: any) => (
                  <div key={p.id} className="card card-pad" style={{ opacity: p.active ? 1 : 0.55 }}>
                    <div className="row">
                      <strong className="bidi">{p.title}</strong>
                      {p.brand_name && <span className="badge">{p.brand_name}</span>}
                      {!p.active && <span className="badge">לא פעיל</span>}
                      <span className="spacer" />
                      <button className="btn btn-sm btn-ghost" onClick={() => setEditing(p)}>עריכה</button>
                      <button className="btn btn-sm btn-ghost btn-danger" onClick={() => remove(p)}>מחיקה</button>
                    </div>
                    <div className="bidi muted small" style={{ whiteSpace: 'pre-wrap', marginTop: 4 }}>{p.content}</div>
                  </div>
                ))}
              </div>
            </section>
          )
        })}
      </div>
      {editing && <PrefDialog initial={editing === 'new' ? undefined : editing} brands={home.brands} onClose={() => setEditing(null)} onSaved={() => prefs.reload(true)} />}
    </div>
  )
}
