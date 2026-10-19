// Entry point of the browser-only demo: the real app, with an in-browser server and AI stand-in.
import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import '../styles.css'
import { AppWithProviders } from '../App'
import { installMockApi } from './mockApi'
import { resolveFileUrl, seed } from './store'

document.documentElement.lang = 'he'
document.documentElement.dir = 'rtl'
seed()
installMockApi()
;(globalThis as any).__cwFileUrl = resolveFileUrl
// The demo runs in a frame where native confirm/prompt dialogs are unavailable; accept by default.
window.confirm = () => true
window.prompt = (_m?: string, d?: string) => d ?? ''

function DemoBadge() {
  const [open, setOpen] = useState(false)
  return (
    <div className="demo-badge" role="note">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        הדגמה {open ? '×' : 'ⓘ'}
      </button>
      {open && (
        <p>
          זו גרסת הדגמה שרצה רק בדפדפן שלך. אפשר ללחוץ ולכתוב בכל מקום, אבל <strong>שום דבר לא נשמר</strong> — רענון הדף מחזיר את נתוני הדוגמה.
          תשובות ה־AI כאן <strong>מדומות</strong>, ואין עבודה משותפת עם אדם אחר. במערכת האמיתית כל אלה עובדים.
        </p>
      )}
    </div>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <MemoryRouter initialEntries={['/']}>
      <AppWithProviders />
    </MemoryRouter>
    <DemoBadge />
  </StrictMode>,
)
