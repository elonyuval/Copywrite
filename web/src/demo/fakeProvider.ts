// Demo-only stand-in for @hocuspocus/provider (swapped in by vite.demo.config.ts).
// Each creative has one "server" Y.Doc in memory (see store.ts); this provider keeps the editor's
// document in sync with it exactly like the real websocket would, and confirms saves.
import { Awareness } from 'y-protocols/awareness'
import * as Y from 'yjs'
import { serverDoc } from './store'

type Handler = (data: any) => void

export class HocuspocusProvider {
  document: Y.Doc
  awareness: Awareness
  configuration: { websocketProvider: { connect: () => Promise<void>; disconnect: () => void } }
  private handlers = new Map<string, Set<Handler>>()
  private server: Y.Doc
  private offServer: () => void
  private online = true
  private storeTimer: ReturnType<typeof setTimeout> | undefined

  constructor(opts: { name: string; document: Y.Doc }) {
    this.document = opts.document
    this.awareness = new Awareness(this.document)
    const creativeId = opts.name.replace(/^creative:/, '')
    this.server = serverDoc(creativeId)
    Y.applyUpdate(this.document, Y.encodeStateAsUpdate(this.server), this)

    const onLocal = (update: Uint8Array, origin: unknown) => {
      if (origin === this || !this.online) return
      Y.applyUpdate(this.server, update, this)
      this.scheduleStored()
    }
    const onServer = (update: Uint8Array, origin: unknown) => {
      if (origin === this || !this.online) return
      Y.applyUpdate(this.document, update, this)
    }
    this.document.on('update', onLocal)
    this.server.on('update', onServer)
    this.offServer = () => {
      this.document.off('update', onLocal)
      this.server.off('update', onServer)
    }

    this.configuration = {
      websocketProvider: {
        connect: async () => {
          this.online = true
          // Exchange whatever happened while "offline", like a real reconnect.
          Y.applyUpdate(this.server, Y.encodeStateAsUpdate(this.document, Y.encodeStateVector(this.server)), this)
          Y.applyUpdate(this.document, Y.encodeStateAsUpdate(this.server, Y.encodeStateVector(this.document)), this)
          this.emit('status', { status: 'connected' })
          this.scheduleStored()
        },
        disconnect: () => {
          this.online = false
          this.emit('status', { status: 'disconnected' })
        },
      },
    }
    setTimeout(() => {
      this.emit('status', { status: 'connected' })
      this.emit('synced', { state: true })
    }, 120)
  }

  private scheduleStored() {
    clearTimeout(this.storeTimer)
    this.storeTimer = setTimeout(() => {
      const sv = Y.decodeStateVector(Y.encodeStateVector(this.server))
      this.emit('stateless', { payload: JSON.stringify({ type: 'stored', sv: Object.fromEntries(sv), at: Date.now() }) })
    }, 450)
  }

  on(event: string, fn: Handler) {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set())
    this.handlers.get(event)!.add(fn)
    return this
  }
  off(event: string, fn: Handler) {
    this.handlers.get(event)?.delete(fn)
    return this
  }
  private emit(event: string, data: unknown) {
    this.handlers.get(event)?.forEach((fn) => fn(data))
  }

  setAwarenessField(key: string, value: unknown) {
    this.awareness.setLocalStateField(key, value)
  }

  sendStateless(payload: string) {
    try {
      const msg = JSON.parse(payload)
      if (msg.type === 'query_stored') this.scheduleStored()
    } catch {}
  }

  destroy() {
    clearTimeout(this.storeTimer)
    this.offServer()
    this.awareness.destroy()
    this.handlers.clear()
  }
}
