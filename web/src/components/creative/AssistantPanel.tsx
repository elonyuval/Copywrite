import type { ScriptSnapshot } from '../../../../shared/script'
import type { CreativeConnection } from '../../lib/collab'
import { AiChat } from './AiChat'
import { SuggestionCard } from './Suggestions'

interface Props {
  conn: CreativeConnection
  creativeId: string
  snap: ScriptSnapshot
  selectedHookId: string | null
  suggestions: { items: any[]; changed: () => void; reviewing: boolean }
  proactive: boolean
  onProactive: (v: boolean) => void
}

const QUICK = ['הצע 3 הוקים חדשים', 'שפר את הליד', 'מצא חזרות וקפיצות בהיגיון', 'אילו טענות לא מבוססות?', 'הצע פתיחת לופ וסגירה שלו']

export function AssistantPanel({ conn, creativeId, snap, selectedHookId, suggestions, proactive, onProactive }: Props) {
  const pendingProactive = suggestions.items.filter((s) => s.origin === 'proactive' && s.status === 'pending')
  return (
    <div className="stack" style={{ height: '100%' }}>
      <div className="row small">
        <label className="checkbox">
          <input type="checkbox" checked={proactive} onChange={(e) => onProactive(e.target.checked)} />
          הצעות יזומות בזמן הכתיבה
        </label>
        {suggestions.reviewing && <span className="subtle"><span className="spinner" style={{ width: 12, height: 12 }} /> בודק…</span>}
      </div>
      {proactive && <div className="subtle">בודק אחרי הפסקה בכתיבה ושינוי משמעותי, לכל היותר פעם בדקה וחצי. שום דבר לא משתנה בלי אישור.</div>}
      {pendingProactive.length > 0 && (
        <div className="stack-sm">
          <strong className="small">הצעות יזומות</strong>
          {pendingProactive.map((s) => (
            <SuggestionCard key={s.id} s={s} snap={snap} selectedHookId={selectedHookId} onResolved={suggestions.changed} />
          ))}
        </div>
      )}
      <div style={{ flex: 1, minHeight: 320 }}>
        <AiChat
          conn={conn}
          creativeId={creativeId}
          kind="assistant"
          hookId={selectedHookId}
          intro="אני מכיר את תיק המוצר, המחקר והתסריט הנוכחי. אפשר לבקש הוקים, שיפורים, בדיקת היגיון או רעיונות לזוויות. כל הצעה לשינוי תחכה לאישור שלכם."
          quickPrompts={QUICK}
          onReply={suggestions.changed}
          renderExtras={(m) => {
            const linked = suggestions.items.filter((s) => s.message_id === m.id)
            if (!linked.length) return null
            return (
              <div className="stack-sm">
                {linked.map((s) => (
                  <SuggestionCard key={s.id} s={s} snap={snap} selectedHookId={selectedHookId} onResolved={suggestions.changed} />
                ))}
              </div>
            )
          }}
        />
      </div>
    </div>
  )
}
