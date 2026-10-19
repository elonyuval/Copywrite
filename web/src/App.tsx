import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
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

export function App() {
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


/** The whole app inside the auth and toast providers. The router is supplied by the entry point. */
export function AppWithProviders() {
  return (
    <AuthProvider>
      <ToastProvider>
        <App />
      </ToastProvider>
    </AuthProvider>
  )
}
