import { PACES, countWords, estimateSeconds, formatDuration, type Pace } from '../../../../shared/readingTime'

/**
 * Estimated read time for: selected hook + lead + body + CTA.
 * Computed locally on every change — no AI request. Shooting notes, research, comments and
 * non-selected hooks are not counted.
 */
export function ScriptStats({ text, pace, onPace, hookIndex }: { text: string; pace: Pace; onPace: (p: Pace) => void; hookIndex: number }) {
  const words = countWords(text)
  const seconds = estimateSeconds(words, pace)
  return (
    <>
      <span title="הערכה בלבד: הוק נבחר + ליד + גוף + קריאה לפעולה">
        זמן הקראה משוער <span className="time" data-testid="read-time">{formatDuration(seconds)}</span>
      </span>
      <span className="muted" data-testid="word-count">{words} מילים</span>
      <span className="seg" role="group" aria-label="קצב הקראה">
        {(Object.keys(PACES) as Pace[]).map((p) => (
          <button key={p} className={p === pace ? 'active' : ''} onClick={() => onPace(p)} aria-pressed={p === pace}>
            {PACES[p].label}
          </button>
        ))}
      </span>
      <span className="subtle hide-mobile">הערכה · לפי הוק {hookIndex + 1} + ליד + גוף + קריאה לפעולה</span>
    </>
  )
}
