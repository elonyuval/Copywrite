import { useEffect, useState, type FormEvent } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Loading } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import { useAuth } from '../lib/auth'

type Mode = 'login' | 'register' | 'setup'

export function LoginPage() {
  const { me, refresh } = useAuth()
  const navigate = useNavigate()
  const location = useLocation() as { state?: { from?: string } }
  const [state, setState] = useState<{ setupRequired: boolean; setupTokenRequired: boolean } | null>(null)
  const [mode, setMode] = useState<Mode>('login')
  const [form, setForm] = useState({ name: '', email: '', password: '', inviteCode: '', workspaceName: 'הסטודיו שלנו', setupToken: '' })
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api
      .get('/auth/state')
      .then((s) => {
        setState(s)
        if (s.setupRequired) setMode('setup')
      })
      .catch((e) => setError(errorMessage(e)))
  }, [])

  if (me) return <Navigate to={location.state?.from ?? '/'} replace />
  if (!state && !error) return <Loading />

  const set = (k: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      if (mode === 'login') await api.post('/auth/login', { email: form.email, password: form.password })
      if (mode === 'register') await api.post('/auth/register', form)
      if (mode === 'setup') await api.post('/auth/setup', form)
      await refresh()
      navigate(location.state?.from ?? '/', { replace: true })
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <form className="card card-pad auth-card stack" onSubmit={submit}>
        <div className="row">
          <span className="logo">✎</span>
          <div>
            <h1>{mode === 'setup' ? 'הקמת סביבת העבודה' : mode === 'register' ? 'הצטרפות עם קוד הזמנה' : 'התחברות'}</h1>
            <div className="subtle">סביבת עבודה פרטית לכתיבת קריאייטיבים</div>
          </div>
        </div>
        {mode === 'setup' && (
          <div className="alert alert-info">זה המשתמש הראשון. לאחר ההקמה תוכלו ליצור קוד הזמנה לשותף/ה מתוך ״הגדרות״.</div>
        )}
        {(mode === 'setup' || mode === 'register') && (
          <label className="field">
            שם
            <input type="text" value={form.name} onChange={set('name')} required autoComplete="name" />
          </label>
        )}
        <label className="field">
          אימייל
          <input type="email" value={form.email} onChange={set('email')} required autoComplete="email" dir="ltr" />
        </label>
        <label className="field">
          סיסמה
          <input type="password" value={form.password} onChange={set('password')} required minLength={mode === 'login' ? 1 : 8} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} dir="ltr" />
          {mode !== 'login' && <span className="hint">לפחות 8 תווים</span>}
        </label>
        {mode === 'setup' && (
          <>
            <label className="field">
              שם סביבת העבודה
              <input type="text" value={form.workspaceName} onChange={set('workspaceName')} required />
            </label>
            {state?.setupTokenRequired && (
              <label className="field">
                קוד הקמה (SETUP_TOKEN מהגדרות השרת)
                <input type="password" value={form.setupToken} onChange={set('setupToken')} required dir="ltr" />
              </label>
            )}
          </>
        )}
        {mode === 'register' && (
          <label className="field">
            קוד הזמנה
            <input type="text" value={form.inviteCode} onChange={set('inviteCode')} required dir="ltr" />
          </label>
        )}
        {error && <div className="alert alert-error" role="alert">{error}</div>}
        <button className="btn btn-primary" disabled={busy} type="submit">
          {busy ? 'רגע…' : mode === 'login' ? 'כניסה' : mode === 'register' ? 'הצטרפות' : 'הקמה וכניסה'}
        </button>
        {!state?.setupRequired && (
          <div className="subtle" style={{ textAlign: 'center' }}>
            {mode === 'login' ? (
              <>
                קיבלתם קוד הזמנה?{' '}
                <button type="button" className="btn-link" onClick={() => setMode('register')}>
                  הצטרפות
                </button>
              </>
            ) : (
              <button type="button" className="btn-link" onClick={() => setMode('login')}>
                כבר יש לי משתמש
              </button>
            )}
          </div>
        )}
      </form>
    </div>
  )
}
