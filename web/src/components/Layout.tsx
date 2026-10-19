import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import { useAuth, useMe } from '../lib/auth'
import { Avatar } from './ui'

interface BrandItem {
  id: string
  name: string
}

function readCollapsed() {
  try {
    return localStorage.getItem('sidebar-collapsed') === '1'
  } catch {
    return false
  }
}

export function Layout() {
  const me = useMe()
  const { refresh } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState(readCollapsed)
  const [mobileOpen, setMobileOpen] = useState(false)
  const [brands, setBrands] = useState<BrandItem[]>([])

  useEffect(() => {
    api.get('/home').then((d) => setBrands(d.brands)).catch(() => {})
  }, [location.pathname])
  useEffect(() => setMobileOpen(false), [location.pathname])

  const toggle = () => {
    setCollapsed((c) => {
      try {
        localStorage.setItem('sidebar-collapsed', c ? '0' : '1')
      } catch {}
      return !c
    })
  }

  const logout = async () => {
    await api.post('/auth/logout').catch(() => {})
    await refresh()
    navigate('/login')
  }

  return (
    <div className="shell">
      <aside className={`sidebar ${collapsed ? 'collapsed' : ''} ${mobileOpen ? 'mobile-open' : ''}`} aria-label="ניווט">
        <div className="sidebar-head">
          <Link to="/" className="logo" aria-label="בית">
            ✎
          </Link>
          <span className="ws-name">{me.workspace.name}</span>
          <span className="spacer" />
          <button className="icon-btn hide-mobile" onClick={toggle} aria-label={collapsed ? 'הרחבת סרגל' : 'קיפול סרגל'} title={collapsed ? 'הרחבה' : 'קיפול'}>
            {collapsed ? '«' : '»'}
          </button>
        </div>
        <nav>
          <NavLink to="/" end className="nav-item">
            <span className="nav-icon">⌂</span>
            <span className="nav-label">בית</span>
          </NavLink>
          <NavLink to="/preferences" className="nav-item">
            <span className="nav-icon">✦</span>
            <span className="nav-label">העדפות ושיטות עבודה</span>
          </NavLink>
          <NavLink to="/settings" className="nav-item">
            <span className="nav-icon">⚙</span>
            <span className="nav-label">הגדרות וחיבורים</span>
          </NavLink>
          <div className="nav-section">מותגים</div>
          {brands.map((b) => (
            <NavLink key={b.id} to={`/brands/${b.id}`} className="nav-item" title={b.name}>
              <span className="nav-icon">◆</span>
              <span className="nav-label bidi">{b.name}</span>
            </NavLink>
          ))}
          {!brands.length && !collapsed && <div className="subtle" style={{ padding: '2px 8px' }}>עדיין אין מותגים</div>}
        </nav>
        <div className="sidebar-foot">
          <Avatar name={me.user.name} color={me.user.color} />
          <div className="who" style={{ flex: 1, minWidth: 0 }}>
            <div className="small" style={{ fontWeight: 500 }}>{me.user.name}</div>
          </div>
          <button className="icon-btn" onClick={logout} title="התנתקות" aria-label="התנתקות">
            ⎋
          </button>
        </div>
      </aside>
      <div className="main">
        <div className="mobile-bar">
          <button className="icon-btn" onClick={() => setMobileOpen(true)} aria-label="פתיחת תפריט">
            ☰
          </button>
          <Link to="/" style={{ fontWeight: 600, color: 'var(--text)' }}>
            {me.workspace.name}
          </Link>
        </div>
        {mobileOpen && <div className="modal-backdrop" style={{ zIndex: 700 }} onClick={() => setMobileOpen(false)} />}
        <Outlet />
      </div>
    </div>
  )
}
