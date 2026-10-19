// Estimated read-aloud time. All pace values live here so they can be tuned in one place.
// Values are words per minute for spoken Hebrew/English ad copy. These are estimates, not guarantees.

export type Pace = 'slow' | 'normal' | 'fast'

export const PACES: Record<Pace, { label: string; wpm: number }> = {
  slow: { label: 'איטי', wpm: 120 },
  normal: { label: 'רגיל', wpm: 150 },
  fast: { label: 'מהיר', wpm: 180 },
}

export const DEFAULT_PACE: Pace = 'normal'

/** Counts spoken words. Numbers, English words and Hebrew words each count as one word. */
export function countWords(text: string): number {
  const matches = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’"״׳\-.,%]*/gu)
  return matches ? matches.length : 0
}

export function estimateSeconds(words: number, pace: Pace = DEFAULT_PACE): number {
  return Math.round((words / PACES[pace].wpm) * 60)
}

export function formatDuration(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

/** Approximate word budget for a target duration — used to brief the AI when shortening. */
export function wordsForSeconds(seconds: number, pace: Pace = DEFAULT_PACE): number {
  return Math.round((seconds / 60) * PACES[pace].wpm)
}
