import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom'
import './styles.css'
import { Layout } from './components/Layout'
import { Loading } from './components/ui'
import { AuthProvider, useAuth } from './lib/auth'
import { ToastProvider } from './lib/toast'
import { BrandPage } from './pages/Brand'
import { CreativePage } from './pages/Creative'
import { HomePage } from './pages/Home'
import { LoginPage } from './pages/Login'
import { PreferencesPage } from './pages/Preferences'
import { ProductPage } from './pages/Product'
import { SettingsPage } from './pages/Settings'

function Protected() {
  const { me, loading } = useAuth()
  const location = useLocation()
  if (loading) return <Loading />
  if (!me) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return <Layout />
}

function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Protected />}>
        <Route path="/" element={<HomePage />} />
        <Route path="/brands/:id" element={<BrandPage />} />
        <Route path="/products/:id" element={<ProductPage />} />
        <Route path="/creatives/:id" element={<CreativePage />} />
        <Route path="/preferences" element={<PreferencesPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
