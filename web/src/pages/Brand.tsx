import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { BrandLogo } from '../components/BrandLogo'
import { ImagePicker } from '../components/ImagePicker'
import { Empty, ErrorBox, Loading, Modal } from '../components/ui'
import { api, errorMessage, fileUrl } from '../lib/api'
import { useToast } from '../lib/toast'
import { useAsync } from '../lib/useAsync'

function NewProductDialog({ brandId, onClose }: { brandId: string; onClose: () => void }) {
  const [form, setForm] = useState({ name: '', description: '' })
  const [image, setImage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()
  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const p = await api.post(`/brands/${brandId}/products`, { ...form, imageFileId: image })
      navigate(`/products/${p.id}`)
    } catch (e) {
      setError(errorMessage(e))
      setBusy(false)
    }
  }
  return (
    <Modal
      title="מוצר חדש"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-primary" disabled={!form.name.trim() || busy} onClick={create}>{busy ? 'יוצר…' : 'יצירת מוצר'}</button>
          <button className="btn btn-ghost" onClick={onClose}>ביטול</button>
        </>
      }
    >
      <label className="field">
        שם המוצר
        <input type="text" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </label>
      <label className="field">
        תיאור קצר <span className="hint">את תיק המוצר המלא ממלאים בעמוד המוצר</span>
        <textarea value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </label>
      <div className="row">
        {image && <img src={fileUrl(image)} alt="" style={{ width: 60, height: 60, objectFit: 'cover', borderRadius: 8 }} />}
        <ImagePicker label={image ? 'החלפת תמונה' : 'העלאת תמונה (לא חובה)'} onUploaded={setImage} />
      </div>
      {error && <div className="alert alert-error">{error}</div>}
    </Modal>
  )
}

function EditBrandDialog({ brand, onClose, onSaved }: { brand: any; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(brand.name)
  const [logo, setLogo] = useState<string | null>(brand.logo_file_id)
  const [error, setError] = useState<string | null>(null)
  const toast = useToast()
  const save = async () => {
    try {
      await api.patch(`/brands/${brand.id}`, { name, logoFileId: logo })
      toast.show('success', 'המותג נשמר')
      onSaved()
      onClose()
    } catch (e) {
      setError(errorMessage(e))
    }
  }
  return (
    <Modal title="עריכת מותג" onClose={onClose} footer={<><button className="btn btn-primary" onClick={save} disabled={!name.trim()}>שמירה</button><button className="btn btn-ghost" onClick={onClose}>ביטול</button></>}>
      <label className="field">שם<input type="text" value={name} onChange={(e) => setName(e.target.value)} /></label>
      <div className="row">
        <BrandLogo name={name} fileId={logo} />
        <ImagePicker label="החלפת לוגו" onUploaded={setLogo} />
        {logo && <button className="btn btn-sm btn-ghost" onClick={() => setLogo(null)}>הסרת לוגו</button>}
      </div>
      {error && <div className="alert alert-error">{error}</div>}
    </Modal>
  )
}

export function BrandPage() {
  const { id } = useParams()
  const { data, error, loading, reload } = useAsync(() => api.get(`/brands/${id}`), [id])
  const [dialog, setDialog] = useState<'product' | 'edit' | null>(null)

  if (loading) return <div className="page"><Loading /></div>
  if (error || !data) return <div className="page"><div className="page-inner"><ErrorBox error={error ?? ''} onRetry={() => reload()} /></div></div>
  const { brand, products } = data
  return (
    <div className="page">
      <div className="page-inner">
        <div className="crumbs"><Link to="/">בית</Link> / <span>מותג</span></div>
        <div className="page-head">
          <BrandLogo name={brand.name} fileId={brand.logo_file_id} size={48} />
          <h1 className="bidi">{brand.name}</h1>
          <button className="btn" onClick={() => setDialog('edit')}>עריכה</button>
          <button className="btn btn-primary" onClick={() => setDialog('product')}>+ מוצר חדש</button>
        </div>
        {products.length === 0 ? (
          <div className="card">
            <Empty icon="▣" title="אין עדיין מוצרים למותג הזה">
              <button className="btn btn-primary" onClick={() => setDialog('product')}>יצירת מוצר</button>
            </Empty>
          </div>
        ) : (
          <div className="grid-cards">
            {products.map((p: any) => (
              <Link key={p.id} to={`/products/${p.id}`} className="card card-link">
                {p.image_file_id ? <img className="product-img" src={fileUrl(p.image_file_id)} alt="" /> : <div className="product-img">▣</div>}
                <div className="bidi" style={{ fontWeight: 600 }}>{p.name}</div>
                {p.description && <div className="subtle bidi" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description}</div>}
                <div className="subtle">{p.creative_count} קריאייטיבים</div>
              </Link>
            ))}
          </div>
        )}
      </div>
      {dialog === 'product' && <NewProductDialog brandId={brand.id} onClose={() => setDialog(null)} />}
      {dialog === 'edit' && <EditBrandDialog brand={brand} onClose={() => setDialog(null)} onSaved={() => reload(true)} />}
    </div>
  )
}
