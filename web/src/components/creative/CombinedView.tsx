import { combinedScript, type ScriptSnapshot } from '../../../../shared/script'
import { useToast } from '../../lib/toast'

/** Full script for the selected hook. Copy gives clean spoken text only (no labels, no shooting notes). */
export function CombinedView({ snap, selectedHookId, onSelect }: { snap: ScriptSnapshot; selectedHookId: string | null; onSelect: (id: string) => void }) {
  const toast = useToast()
  const hook = snap.hooks.find((h) => h.id === selectedHookId) ?? snap.hooks[0]
  const text = combinedScript(snap, hook?.id)
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      toast.show('success', 'התסריט הועתק')
    } catch {
      toast.show('error', 'ההעתקה נכשלה — סמנו את הטקסט והעתיקו ידנית')
    }
  }
  const parts: [string, string, boolean][] = [
    ['הוק', hook?.text ?? '', true],
    ['ליד', snap.lead, false],
    ['גוף', snap.body, false],
    ['קריאה לפעולה', snap.cta, false],
  ]
  return (
    <div className="stack" style={{ marginTop: 18 }}>
      <div className="row-wrap">
        <span className="small muted">הוק:</span>
        <div className="chips">
          {snap.hooks.map((h, i) => (
            <button key={h.id} className={`chip ${h.id === hook?.id ? 'active' : ''}`} onClick={() => onSelect(h.id)} title={h.text}>
              {i + 1}
            </button>
          ))}
        </div>
        <span className="spacer" />
        <button className="btn btn-primary btn-sm" onClick={copy} disabled={!text}>העתקת התסריט</button>
      </div>
      <div className="combined bidi" data-testid="combined">
        {!text && <span className="subtle">התסריט עדיין ריק</span>}
        {parts.map(([label, value, isHook]) =>
          value ? (
            <div key={label}>
              <span className="combined-label" aria-hidden>{label}</span>
              <span className={isHook ? 'part-hook' : ''}>{value}</span>
            </div>
          ) : null,
        )}
      </div>
      <div className="subtle">ההעתקה כוללת רק את הטקסט המוקרא — בלי כותרות, כפתורים או הוראות צילום.</div>
    </div>
  )
}
