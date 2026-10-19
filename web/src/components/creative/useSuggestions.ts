import { useCallback, useEffect, useRef, useState } from 'react'
import { combinedScript, type ScriptSnapshot } from '../../../../shared/script'
import { countWords } from '../../../../shared/readingTime'
import { api } from '../../lib/api'
import type { CreativeConnection } from '../../lib/collab'

/** Idle time after typing before a proactive check, and the minimum gap between checks. */
const IDLE_MS = 12_000
const MIN_GAP_MS = 90_000
const MIN_CHANGE_CHARS = 60

export function useSuggestions(creativeId: string, conn: CreativeConnection) {
  const [items, setItems] = useState<any[]>([])
  const [reviewing, setReviewing] = useState(false)
  const reload = useCallback(async () => {
    try {
      setItems(await api.get(`/creatives/${creativeId}/suggestions`))
    } catch {}
  }, [creativeId])
  useEffect(() => {
    reload()
    return conn.onNotify((m) => m.scope === 'suggestions' && reload())
  }, [reload, conn])
  const changed = useCallback(() => {
    reload()
    conn.notify('suggestions')
  }, [reload, conn])
  return { items, reload, changed, reviewing, setReviewing }
}

/**
 * Proactive review: runs only after a pause in typing AND a meaningful change, at most once per
 * MIN_GAP_MS, never twice for the same text (the server also de-duplicates by content hash).
 */
export function useProactiveReview(opts: {
  enabled: boolean
  creativeId: string
  snap: ScriptSnapshot
  selectedHookId: string | null
  onResult: () => void
  setReviewing: (b: boolean) => void
}) {
  const { enabled, creativeId, snap, selectedHookId, onResult, setReviewing } = opts
  const lastText = useRef<string | null>(null)
  const lastAt = useRef(0)
  const inFlight = useRef(false)
  const text = combinedScript(snap, selectedHookId)

  useEffect(() => {
    if (!enabled) return
    if (lastText.current === null) {
      lastText.current = text // baseline: don't review just because the page opened
      return
    }
    const timer = setTimeout(async () => {
      const diff = Math.abs(text.length - (lastText.current ?? '').length) + (text === lastText.current ? 0 : 1)
      const significant = diff >= MIN_CHANGE_CHARS || (text !== lastText.current && countWords(text) >= 25 && Date.now() - lastAt.current > 5 * 60_000)
      if (!significant || inFlight.current || Date.now() - lastAt.current < MIN_GAP_MS || countWords(text) < 25) return
      inFlight.current = true
      lastAt.current = Date.now()
      lastText.current = text
      setReviewing(true)
      try {
        const r = await api.post(`/creatives/${creativeId}/ai-review`, { hookId: selectedHookId })
        if (r.suggestions) onResult()
      } catch {
        // Proactive checks fail quietly; on-demand requests show errors.
      } finally {
        inFlight.current = false
        setReviewing(false)
      }
    }, IDLE_MS)
    return () => clearTimeout(timer)
  }, [enabled, text, creativeId, selectedHookId, onResult, setReviewing])
}
