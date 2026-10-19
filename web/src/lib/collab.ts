// Connection to the collaborative document of one creative, with an honest save indicator.
//
// "Saved" means the server confirmed that the database contains every change made in this tab:
// after each successful store the server broadcasts its state vector, and we compare it with our
// own client's clock. Anything else is shown as saving / offline / failed.
import { HocuspocusProvider } from '@hocuspocus/provider'
import { useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import { scriptSnapshot, type ScriptSnapshot } from '../../../shared/script'

export type SaveState = 'connecting' | 'saving' | 'saved' | 'slow' | 'failed' | 'offline' | 'offline_unsaved' | 'denied'

export const SAVE_LABELS: Record<SaveState, string> = {
  connecting: 'מתחבר…',
  saving: 'שומר…',
  saved: 'נשמר',
  slow: 'השמירה מתעכבת…',
  failed: 'השמירה נכשלה — מנסה שוב',
  offline: 'מנותק',
  offline_unsaved: 'מנותק — יש שינויים שעוד לא נשמרו',
  denied: 'אין גישה למסמך',
}

export interface PresenceUser {
  clientId: number
  id: string
  name: string
  color: string
  activeField?: string | null
  self: boolean
}

type NotifyListener = (msg: { scope: string; by?: string }) => void

export interface CreativeConnection {
  doc: Y.Doc
  provider: HocuspocusProvider
  synced: boolean
  saveState: SaveState
  presence: PresenceUser[]
  notify: (scope: string) => void
  onNotify: (fn: NotifyListener) => () => void
}

function ownClock(doc: Y.Doc) {
  return Y.decodeStateVector(Y.encodeStateVector(doc)).get(doc.clientID) ?? 0
}

export function useCreativeConnection(creativeId: string, user: { id: string; name: string; color: string }): CreativeConnection {
  const [synced, setSynced] = useState(false)
  const [status, setStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [denied, setDenied] = useState(false)
  const [pending, setPending] = useState(false) // local changes not yet confirmed as stored
  const [failed, setFailed] = useState(false)
  const [slow, setSlow] = useState(false)
  // The browser's own network signal. Closing a socket needs a handshake that can't happen offline,
  // so the indicator must not wait for the socket to report the disconnect.
  const [netOffline, setNetOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false)
  const [presence, setPresence] = useState<PresenceUser[]>([])
  const listeners = useRef(new Set<NotifyListener>())

  const conn = useMemo(() => {
    const doc = new Y.Doc()
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws'
    const provider = new HocuspocusProvider({
      url: `${scheme}://${location.host}/collab`,
      name: `creative:${creativeId}`,
      document: doc,
      token: 'session-cookie',
    })
    return { doc, provider }
  }, [creativeId])

  useEffect(() => {
    const { doc, provider } = conn
    let storedClock = 0
    let slowTimer: ReturnType<typeof setTimeout> | undefined

    const recompute = () => {
      const isPending = ownClock(doc) > storedClock
      setPending(isPending)
      if (isPending && !slowTimer) slowTimer = setTimeout(() => setSlow(true), 15000)
      if (!isPending) {
        clearTimeout(slowTimer)
        slowTimer = undefined
        setSlow(false)
      }
    }

    const onUpdate = (_u: Uint8Array, origin: unknown) => {
      if (origin !== provider) recompute()
    }
    doc.on('update', onUpdate)

    provider.on('status', ({ status }: { status: string }) => setStatus(status as any))
    provider.on('synced', ({ state }: { state: boolean }) => {
      setSynced((s) => s || state)
      if (state) provider.sendStateless(JSON.stringify({ type: 'query_stored' }))
    })
    provider.on('authenticationFailed', () => setDenied(true))
    provider.on('stateless', ({ payload }: { payload: string }) => {
      try {
        const msg = JSON.parse(payload)
        if (msg.type === 'stored') {
          storedClock = Math.max(storedClock, Number(msg.sv?.[doc.clientID] ?? 0))
          setFailed(false)
          recompute()
        } else if (msg.type === 'store_failed') {
          setFailed(true)
        } else if (msg.type === 'notify' && msg.clientId !== doc.clientID) {
          listeners.current.forEach((fn) => fn(msg))
        }
      } catch {}
    })

    provider.setAwarenessField('user', { id: user.id, name: user.name, color: user.color })
    const onAwareness = () => {
      const list: PresenceUser[] = []
      provider.awareness?.getStates().forEach((s: any, clientId: number) => {
        if (!s.user) return
        list.push({ clientId, id: s.user.id, name: s.user.name, color: s.user.color, activeField: s.activeField, self: clientId === doc.clientID })
      })
      setPresence(list)
    }
    provider.awareness?.on('change', onAwareness)
    onAwareness()

    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (ownClock(doc) > storedClock) {
        e.preventDefault()
        e.returnValue = ''
      }
    }
    window.addEventListener('beforeunload', beforeUnload)

    // React to the browser's own network signal immediately (otherwise a dead socket is only noticed
    // after the provider's message timeout). Local edits stay in the document and sync on reconnect.
    const socket = provider.configuration.websocketProvider
    const goOffline = () => {
      setNetOffline(true)
      socket.disconnect()
    }
    const goOnline = () => {
      setNetOffline(false)
      void socket.connect()
    }
    window.addEventListener('offline', goOffline)
    window.addEventListener('online', goOnline)

    return () => {
      window.removeEventListener('offline', goOffline)
      window.removeEventListener('online', goOnline)
      window.removeEventListener('beforeunload', beforeUnload)
      clearTimeout(slowTimer)
      doc.off('update', onUpdate)
      provider.destroy()
      doc.destroy()
    }
  }, [conn, user.id, user.name, user.color])

  let saveState: SaveState
  if (denied) saveState = 'denied'
  else if (netOffline) saveState = pending ? 'offline_unsaved' : 'offline'
  else if (status !== 'connected') saveState = !synced && status === 'connecting' ? 'connecting' : pending ? 'offline_unsaved' : 'offline'
  else if (failed) saveState = 'failed'
  else if (pending) saveState = slow ? 'slow' : 'saving'
  else saveState = 'saved'

  const notify = (scope: string) =>
    conn.provider.sendStateless(JSON.stringify({ type: 'notify', scope, by: user.name, clientId: conn.doc.clientID }))
  const onNotify = (fn: NotifyListener) => {
    listeners.current.add(fn)
    return () => void listeners.current.delete(fn)
  }

  return { doc: conn.doc, provider: conn.provider, synced, saveState, presence, notify, onNotify }
}

/** Re-renders whenever the shared document changes (throttled to one frame). */
export function useDocSnapshot(doc: Y.Doc): ScriptSnapshot {
  const [snap, setSnap] = useState(() => scriptSnapshot(doc))
  useEffect(() => {
    let frame = 0
    const update = () => {
      if (frame) return
      frame = requestAnimationFrame(() => {
        frame = 0
        setSnap(scriptSnapshot(doc))
      })
    }
    setSnap(scriptSnapshot(doc))
    doc.on('update', update)
    return () => {
      doc.off('update', update)
      cancelAnimationFrame(frame)
    }
  }, [doc])
  return snap
}

/** Re-renders on any change inside a shared type. */
export function useYObserve(type: Y.AbstractType<any> | null | undefined) {
  const [, setN] = useState(0)
  useEffect(() => {
    if (!type) return
    const fn = () => setN((n) => n + 1)
    type.observeDeep(fn)
    return () => type.unobserveDeep(fn)
  }, [type])
}
