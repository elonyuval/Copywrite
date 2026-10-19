import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { DOSSIER_FIELDS, STATUSES, STATUS_LABELS, type CreativeStatus, type Dossier } from '../../../shared/constants'
import { ImagePicker } from '../components/ImagePicker'
import { Linkify } from '../components/Linkify'
import { NewCreativeDialog } from '../components/NewCreativeDialog'
import { Empty, ErrorBox, Loading, StatusBadge } from '../components/ui'
import { api, ApiError, errorMessage, fileUrl } from '../lib/api'
import { timeAgo } from '../lib/format'
import { useToast } from '../lib/toast'
import { useAsync } from '../lib/useAsync'

const DOSSIER_HINTS: Record<string, string> = {
  benefits: 'מה הלקוח מרוויח. רק מה שנכון ומאומת.',
  features: 'רכיבים, מידות, טכנולוגיה, מה בקופסה…',
  audiences: 'למי זה מתאים, ובאיזה מצב.',
  offer: 'מחיר, מבצע, משלוח, אחריות, החזרות.',
  links: 'דף מוצר, ביקורות, מתחרים — קישור בכל שורה.',
  sources: 'מקורות לטענות: מחקרים, אישורים, ביקורות אמיתיות.',
  materials: 'כל דבר נוסף שכדאי לדעת.',
}

function ProductDetails({ product, onSaved }: { product: any; onSaved: (p: any) => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState({ name: product.name, description: product.description, dossier: { ...(product.dossier as Dossier) } })
  const [busy, setBusy] = useState(false)
  const [conflictMsg, setConflictMsg] = useState<string | null>(null)
  const toast = useToast()

  const start = () => {
    setDraft({ name: product.name, description: product.description, dossier: { ...(product.dossier as Dossier) } })
    setConflictMsg(null)
    setEditing(true)
  }
  const save = async () => {
    setBusy(true)
    try {
      const changed: Dossier = {}
      for (const f of DOSSIER_FIELDS) if ((draft.dossier[f.key] ?? '') !== (product.dossier?.[f.key] ?? '')) changed[f.key] = draft.dossier[f.key] ?? ''
      const p = await api.patch(`/products/${product.id}`, { revision: product.revision, name: draft.name, description: draft.description, dossier: changed })
      onSaved(p)
      setEditing(false)
      toast.show('success', 'תיק המוצר נשמר')
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        // Someone else saved meanwhile: load their version and keep our draft visible for merging.
        onSaved(e.data.current)
        setConflictMsg(e.message)
      } else toast.show('error', `השמירה נכשלה: ${errorMessage(e)}`)
    } finally {
      setBusy(false)
    }
  }
  const setImage = async (fileId: string | null) => {
    try {
      onSaved(await api.patch(`/products/${product.id}`, { revision: product.revision, imageFileId: fileId }))
    } catch (e) {
      toast.show('error', errorMessage(e))
    }
  }

  return (
    <div className="card card-pad stack">
      <div className="row" style={{ alignItems: 'flex-start' }}>
        {product.image_file_id ? (
          <img src={fileUrl(product.image_file_id)} alt="" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 10 }} />
        ) : (
          <div className="product-img" style={{ width: 96, height: 96, aspectRatio: 'auto', margin: 0 }}>▣</div>
        )}
        <div className="stack-sm" style={{ flex: 1 }}>
          {editing ? (
            <>
              <input type="text" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} aria-label="שם המוצר" />
              <textarea value={draft.description} onChange={(e) => setDraft({ ...draft, description: e.target.value })} placeholder="תיאור" aria-label="תיאור" />
            </>
          ) : (
            <>
              <h1 className="bidi">{product.name}</h1>
              {product.description ? <p className="muted bidi" style={{ whiteSpace: 'pre-wrap' }}><Linkify text={product.description} /></p> : <span className="subtle">אין תיאור</span>}
            </>
          )}
          <div className="row">
            <ImagePicker label={product.image_file_id ? 'החלפת תמונה' : 'הוספת תמונה'} onUploaded={(id) => setImage(id)} />
          </div>
        </div>
      </div>

      <div className="section-title" style={{ marginBottom: 0, marginTop: 6 }}>
        <h2>תיק מוצר משותף</h2>
        <span className="subtle">הבסיס שה-AI עובד ממנו. מה שלא כתוב כאן — ה-AI לא אמור להמציא.</span>
        <span className="spacer" />
        {!editing ? (
          <button className="btn" onClick={start}>עריכה</button>
        ) : (
          <>
            <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'שומר…' : 'שמירה'}</button>
            <button className="btn btn-ghost" onClick={() => setEditing(false)}>ביטול</button>
          </>
        )}
      </div>
      {conflictMsg && <div className="alert alert-warn">{conflictMsg} הטיוטה שלכם נשארה בטופס.</div>}
      <div className="stack">
        {DOSSIER_FIELDS.map((f) => {
          const value = product.dossier?.[f.key] ?? ''
          return (
            <div key={f.key}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>{f.label}</div>
              {editing ? (
                <>
                  <textarea
                    className="bidi"
                    value={draft.dossier[f.key] ?? ''}
                    onChange={(e) => setDraft({ ...draft, dossier: { ...draft.dossier, [f.key]: e.target.value } })}
                    placeholder={DOSSIER_HINTS[f.key]}
                    aria-label={f.label}
                  />
                  {conflictMsg && value !== (draft.dossier[f.key] ?? '') && (
                    <div className="subtle">הגרסה השמורה כרגע: <span className="bidi" style={{ whiteSpace: 'pre-wrap' }}>{value || '(ריק)'}</span></div>
                  )}
                </>
              ) : value ? (
                <div className="bidi muted" style={{ whiteSpace: 'pre-wrap' }}><Linkify text={value} /></div>
              ) : (
                <div className="subtle">— {DOSSIER_HINTS[f.key]}</div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function ProductPage() {
  const { id } = useParams()
  const { data, setData, error, loading, reload } = useAsync(() => api.get(`/products/${id}`), [id])
  const [filter, setFilter] = useState<CreativeStatus | 'all' | 'review'>('all')
  const [newOpen, setNewOpen] = useState(false)
  const creatives = useMemo(() => {
    const all = data?.creatives ?? []
    if (filter === 'all') return all
    if (filter === 'review') return all.filter((c: any) => c.needs_review)
    return all.filter((c: any) => c.status === filter)
  }, [data, filter])

  if (loading) return <div className="page"><Loading /></div>
  if (error || !data) return <div className="page"><div className="page-inner"><ErrorBox error={error ?? ''} onRetry={() => reload()} /></div></div>
  const counts = (s: string) => data.creatives.filter((c: any) => c.status === s).length

  return (
    <div className="page">
      <div className="page-inner stack" style={{ gap: 20 }}>
        <div className="crumbs">
          <Link to="/">בית</Link> / <Link to={`/brands/${data.brand.id}`} className="bidi">{data.brand.name}</Link> / <span>מוצר</span>
        </div>
        <ProductDetails product={data.product} onSaved={(p) => setData({ ...data, product: p })} />

        <section>
          <div className="section-title">
            <h2>קריאייטיבים</h2>
            <span className="spacer" />
            <button className="btn btn-primary" onClick={() => setNewOpen(true)}>+ קריאייטיב חדש</button>
          </div>
          <div className="chips" style={{ marginBottom: 10 }}>
            <button className={`chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>הכול ({data.creatives.length})</button>
            {STATUSES.map((s) => (
              <button key={s} className={`chip ${filter === s ? 'active' : ''}`} onClick={() => setFilter(s)}>
                {STATUS_LABELS[s]} ({counts(s)})
              </button>
            ))}
            <button className={`chip ${filter === 'review' ? 'active' : ''}`} onClick={() => setFilter('review')}>נדרשת בדיקה</button>
          </div>
          {data.creatives.length === 0 ? (
            <div className="card">
              <Empty icon="✎" title="אין עדיין קריאייטיבים למוצר">
                <button className="btn btn-primary" onClick={() => setNewOpen(true)}>קריאייטיב חדש</button>
              </Empty>
            </div>
          ) : creatives.length === 0 ? (
            <div className="card"><Empty title="אין קריאייטיבים בסטטוס הזה" /></div>
          ) : (
            <div className="card list">
              {creatives.map((c: any) => (
                <Link key={c.id} to={`/creatives/${c.id}`} className="list-item">
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="title bidi">{c.name}</div>
                    <div className="subtle bidi">{c.angle || 'ללא זווית'}{c.source_kind === 'short' ? ' · גרסה קצרה' : c.source_kind === 'duplicate' ? ' · שכפול' : ''}</div>
                  </div>
                  {c.needs_review && <span className="badge badge-warn">נדרשת בדיקה</span>}
                  {c.approved_at && !c.needs_review && <span className="badge badge-ok">✓ אושר</span>}
                  <StatusBadge status={c.status} />
                  <span className="subtle hide-mobile">{timeAgo(c.content_updated_at)}</span>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
      {newOpen && <NewCreativeDialog productId={data.product.id} onClose={() => setNewOpen(false)} />}
    </div>
  )
}
