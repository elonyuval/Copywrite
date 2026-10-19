import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from './api'

/** Loads data with explicit loading / error states and a reload function. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const seq = useRef(0)
  const load = useCallback(async (silent = false) => {
    const n = ++seq.current
    if (!silent) setLoading(true)
    try {
      const d = await fn()
      if (n === seq.current) {
        setData(d)
        setError(null)
      }
    } catch (e) {
      if (n === seq.current) setError(errorMessage(e))
    } finally {
      if (n === seq.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => {
    load()
  }, [load])
  return { data, setData, error, loading, reload: load }
}
