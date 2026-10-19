import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { api } from './api'

export interface Me {
  user: { id: string; name: string; email: string; color: string; workspaceId: string; role: string }
  workspace: { id: string; name: string }
  aiConfigured: boolean
  aiModel: string
}

const Ctx = createContext<{ me: Me | null; loading: boolean; refresh: () => Promise<void> }>({ me: null, loading: true, refresh: async () => {} })

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const refresh = useCallback(async () => {
    try {
      setMe(await api.get<Me>('/me'))
    } catch {
      setMe(null)
    } finally {
      setLoading(false)
    }
  }, [])
  useEffect(() => {
    refresh()
    const lost = () => setMe(null)
    window.addEventListener('auth:lost', lost)
    return () => window.removeEventListener('auth:lost', lost)
  }, [refresh])
  return <Ctx.Provider value={{ me, loading, refresh }}>{children}</Ctx.Provider>
}

export const useAuth = () => useContext(Ctx)
export const useMe = () => useContext(Ctx).me!
