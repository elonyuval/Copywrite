import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

type Kind = 'success' | 'error' | 'info'
interface Toast {
  id: number
  kind: Kind
  text: string
  action?: { label: string; onClick: () => void }
}

const Ctx = createContext<{ show: (kind: Kind, text: string, opts?: { action?: Toast['action']; ms?: number }) => void }>({ show: () => {} })

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const show = useCallback((kind: Kind, text: string, opts: { action?: Toast['action']; ms?: number } = {}) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-3), { id, kind, text, action: opts.action }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts.ms ?? (kind === 'error' ? 7000 : 4000))
  }, [])
  return (
    <Ctx.Provider value={{ show }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <span>{t.text}</span>
            {t.action && (
              <button
                className="btn btn-link"
                onClick={() => {
                  t.action!.onClick()
                  setToasts((all) => all.filter((x) => x.id !== t.id))
                }}
              >
                {t.action.label}
              </button>
            )}
            <button className="toast-x" aria-label="סגירה" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}>
              ×
            </button>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  )
}

export const useToast = () => useContext(Ctx)
