import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { CreativeStatus } from '../../../shared/constants'
import { BrandLogo } from '../components/BrandLogo'
import { ImagePicker } from '../components/ImagePicker'
import { Empty, ErrorBox, Loading, Modal, StatusBadge } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import { useMe } from '../lib/auth'
import { timeAgo } from '../lib/format'
import { useToast } from '../lib/toast'
import { useAsync } from '../lib/useAsync'

function SearchBox() {
  const [term, setTerm] = useState('')
  const [results, setResults] = useState<any>(null)
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()
  const seq = useRef(0)
  useEffect(() => {
    const t = term.trim()
    if (!t) return setResults(null)
    const n = ++seq.current
    const h = setTimeout(() => {
      api.get(`/search?q=${encodeURIComponent(t)}`).then((r) => n === seq.current && setResults(r)).catch(() => {})
    }, 200)
    return () => clearTimeout(h)
  }, [term])
  const any = results && (results.brands.length || results.products.length || results.creatives.length)
  return (
    <div className="search-box" onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setOpen(false)}>
      <span className="search-icon">⌕</span>
      <input
        type="search"
        placeholder="חיפוש מותג, מוצר או קריאייטיב…"
        value={term}
        onChange={(e) => {
          setTerm(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && results?.creatives?.[0]) navigate(`/creatives/${results.creatives[0].id}`)
          if (e.key === 'Escape') setOpen(false)
        }}
        aria-label="חיפוש"
      />
      {open && term.trim() && results && (
        <div className="card search-results">
          {!any && <div className="subtle" style={{ padding: 14 }}>לא נמצאו תוצאות עבור ״{term}״</div>}
          {results.brands.length > 0 && (
            <div className="result-group">
              <h4>מותגים</h4>
              {results.brands.map((b: any) => (
                <Link key={b.id} className="result-item bidi" to={`/brands/${b.id}`}>{b.name}</Link>
              ))}
            </div>
          )}
          {results.products.length > 0 && (
            <div className="result-group">
              <h4>מוצרים</h4>
              {results.products.map((p: any) => (
                <Link key={p.id} className="result-item" to={`/products/${p.id}`}>
                  <span className="bidi">{p.name}</span> <span className="subtle">· {p.brand_name}</span>
                </Link>
              ))}
            </div>
          )}
          {results.creatives.length > 0 && (
            <div className="result-group">
              <h4>קריאייטיבים</h4>
              {results.creatives.map((c: any) => (
                <Link key={c.id} className="result-item" to={`/creatives/${c.id}`}>
                  <span className="bidi">{c.name}</span> <span className="subtle">· {c.brand_name} / {c.product_name}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export function NewBrandDialog({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('')
  const [logo, setLogo] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const toast = useToast()
  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const b = await api.post('/brands', { name, logoFileId: logo })
      toast.show('success', 'המותג נוצר')
      navigate(`/brands/${b.id}`)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <Modal
      title="מותג חדש"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" disabled={!name.trim() || busy} onClick={create}>
            {busy ? 'יוצר…' : 'יצירת מותג'}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>ביטול</button>
        </>
      }
    >
      <label className="field">
        שם המותג
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim() && create()} />
      </label>
      <div className="row">
        <BrandLogo name={name || '?'} fileId={logo} />
        <ImagePicker label={logo ? 'החלפת לוגו' : 'העלאת לוגו (לא חובה)'} onUploaded={setLogo} />
      </div>
      {error && <div className="alert alert-error">{error}</div>}
    </Modal>
  )
}

export function HomePage() {
  const me = useMe()
  const { data, error, loading, reload } = useAsync(() => api.get('/home'), [])
  const [newBrand, setNewBrand] = useState(false)

  return (
    <div className="page">
      <div className="page-inner stack" style={{ gap: 24 }}>
        <div className="page-head" style={{ marginBottom: 0 }}>
          <h1>שלום, {me.user.name}</h1>
          <button className="btn btn-primary" onClick={() => setNewBrand(true)}>+ מותג חדש</button>
        </div>
        {!me.aiConfigured && (
          <div className="alert alert-warn">
            חיבור ה-AI לא מוגדר עדיין — כל השאר עובד. <Link to="/settings">הוראות הגדרה</Link>
          </div>
        )}
        <SearchBox />
        {loading && <Loading />}
        {error && <ErrorBox error={error} onRetry={() => reload()} />}
        {data && (
          <>
            {data.continue.length > 0 && (
              <section>
                <div className="section-title"><h2>להמשיך מאיפה שעצרת</h2></div>
                <div className="grid-cards">
                  {data.continue.map((c: any) => (
                    <Link key={c.id} to={`/creatives/${c.id}`} className="card card-link">
                      <div className="title bidi" style={{ fontWeight: 600 }}>{c.name}</div>
                      <div className="subtle">{c.brand_name} · {c.product_name}</div>
                      <div className="row" style={{ marginTop: 6 }}>
                        <StatusBadge status={c.status as CreativeStatus} />
                        <span className="subtle">נפתח {timeAgo(c.visited_at)}</span>
                      </div>
                    </Link>
                  ))}
                </div>
              </section>
            )}
            <section>
              <div className="section-title"><h2>מותגים</h2></div>
              {data.brands.length === 0 ? (
                <div className="card">
                  <Empty icon="◆" title="עדיין אין מותגים">
                    <span>מתחילים ממותג, מוסיפים לו מוצרים, ובכל מוצר כותבים קריאייטיבים.</span>
                    <button className="btn btn-primary" onClick={() => setNewBrand(true)}>יצירת המותג הראשון</button>
                  </Empty>
                </div>
              ) : (
                <div className="grid-cards">
                  {data.brands.map((b: any) => (
                    <Link key={b.id} to={`/brands/${b.id}`} className="card card-link row">
                      <BrandLogo name={b.name} fileId={b.logo_file_id} />
                      <div>
                        <div className="bidi" style={{ fontWeight: 600 }}>{b.name}</div>
                        <div className="subtle">{b.product_count} מוצרים · {b.creative_count} קריאייטיבים</div>
                      </div>
                    </Link>
                  ))}
                </div>
              )}
            </section>
            <section>
              <div className="section-title"><h2>קריאייטיבים אחרונים</h2></div>
              {data.recent.length === 0 ? (
                <div className="card"><Empty icon="✎" title="עדיין אין קריאייטיבים" /></div>
              ) : (
                <div className="card list">
                  {data.recent.map((c: any) => (
                    <Link key={c.id} to={`/creatives/${c.id}`} className="list-item">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div className="title bidi">{c.name}</div>
                        <div className="subtle">{c.brand_name} · {c.product_name}</div>
                      </div>
                      {c.needs_review && <span className="badge badge-warn">נדרשת בדיקה</span>}
                      <StatusBadge status={c.status} />
                      <span className="subtle hide-mobile">{timeAgo(c.content_updated_at)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </div>
      {newBrand && <NewBrandDialog onClose={() => setNewBrand(false)} />}
    </div>
  )
}
