import { useEffect, useRef, type ReactNode } from 'react'
import { STATUS_LABELS, type CreativeStatus } from '../../../shared/constants'
import { initials } from '../lib/format'

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose: () => void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  // Runs once when the dialog opens. (Re-running on every parent render would steal focus mid-typing.)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current()
    window.addEventListener('keydown', onKey)
    const first = ref.current?.querySelector<HTMLElement>('input, textarea, select, button.btn-primary')
    first?.focus()
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title} ref={ref}>
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="סגירה">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  )
}

export function Loading({ text = 'טוען…' }: { text?: string }) {
  return (
    <div className="loading-block" role="status">
      <span className="spinner" /> {text}
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="alert alert-error row" role="alert">
      <span className="spacer">{error}</span>
      {onRetry && (
        <button className="btn btn-sm" onClick={onRetry}>
          נסו שוב
        </button>
      )}
    </div>
  )
}

export function Empty({ icon = '○', title, children }: { icon?: string; title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children && <div className="stack-sm" style={{ alignItems: 'center' }}>{children}</div>}
    </div>
  )
}

export function StatusBadge({ status }: { status: CreativeStatus }) {
  return <span className={`badge badge-${status}`}>{STATUS_LABELS[status]}</span>
}

export function Avatar({ name, color, title }: { name: string; color: string; title?: string }) {
  return (
    <span className="avatar" style={{ background: color }} title={title ?? name}>
      {initials(name)}
    </span>
  )
}

export function Spinner() {
  return <span className="spinner" aria-label="טוען" />
}
