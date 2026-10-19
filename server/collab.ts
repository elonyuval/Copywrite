// Real-time collaboration (Yjs over websockets) via Hocuspocus.
// Auth: the browser's session cookie is checked on connect, and the user must belong to the
// creative's workspace. Persistence: Yjs binary state in Postgres (creative_docs).
import { Server, type Document } from '@hocuspocus/server'
import * as Y from 'yjs'
import type { Express } from 'express'
import { originAllowed, parseCookieHeader, SESSION_COOKIE, userFromToken, type AuthUser } from './auth'
import { config } from './config'
import { one } from './db'
import { creativeIdFromDocName, loadState, setHocuspocus, storeDoc } from './docs'

interface Ctx {
  user?: Pick<AuthUser, 'id'> & Partial<AuthUser>
  system?: boolean
}

/** Tells connected clients exactly which edits are durably stored, via the Yjs state vector. */
function broadcastStored(document: Document) {
  const sv = Y.decodeStateVector(Y.encodeStateVector(document))
  document.broadcastStateless(JSON.stringify({ type: 'stored', sv: Object.fromEntries(sv), at: Date.now() }))
}

export function createServer(app: Express) {
  const server = new Server<Ctx>({
    port: config.port,
    quiet: true,
    debounce: 1200,
    maxDebounce: 8000,
    timeout: 30000,
    stopOnSignals: true,

    // Plain HTTP requests go to the Express app; only /collab upgrades become websockets.
    async onRequest({ request, response }) {
      app(request as any, response as any)
      // Throwing null tells Hocuspocus the request was handled.
      throw null
    },

    async onUpgrade({ request }) {
      const url = new URL(request.url ?? '/', 'http://x')
      if (!url.pathname.startsWith('/collab')) throw new Error('not a collaboration socket')
      if (!originAllowed(request.headers.origin, request.headers.host)) throw new Error('origin not allowed')
    },

    async onAuthenticate({ requestHeaders, documentName }) {
      const cookies = parseCookieHeader(requestHeaders.get('cookie'))
      const user = await userFromToken(cookies[SESSION_COOKIE])
      if (!user) throw new Error('unauthenticated')
      const creativeId = creativeIdFromDocName(documentName)
      if (!creativeId || !/^[0-9a-f-]{36}$/.test(creativeId)) throw new Error('bad document')
      const row = await one('SELECT 1 FROM creatives WHERE id = $1 AND workspace_id = $2', [creativeId, user.workspaceId])
      if (!row) throw new Error('forbidden')
      return { user }
    },

    async onLoadDocument({ documentName, document }) {
      const creativeId = creativeIdFromDocName(documentName)
      if (!creativeId) return
      const state = await loadState(creativeId)
      if (state) Y.applyUpdate(document, state)
      return document
    },

    async onStoreDocument({ documentName, document, lastContext }) {
      const creativeId = creativeIdFromDocName(documentName)
      if (!creativeId) return
      try {
        await storeDoc(creativeId, document, lastContext?.user?.id ?? null)
        broadcastStored(document)
      } catch (e) {
        console.error('[collab] store failed', documentName, e)
        document.broadcastStateless(JSON.stringify({ type: 'store_failed', at: Date.now() }))
        throw e
      }
    },

    async onStateless({ payload, document, connection }) {
      // 'query_stored': the client asks whether its latest change is stored (after reconnecting).
      try {
        const msg = JSON.parse(payload)
        if (msg.type === 'notify' && typeof msg.scope === 'string') {
          // Lightweight "something changed, refresh" signal between collaborators (comments, status, files…).
          document.broadcastStateless(
            JSON.stringify({ type: 'notify', scope: msg.scope.slice(0, 40), by: connection.context?.user?.name, clientId: msg.clientId }),
          )
        } else if (msg.type === 'query_stored') {
          const sv = Y.decodeStateVector(Y.encodeStateVector(document))
          // Only report what is in the database: if a store is pending, it will broadcast when done.
          const key = `onStoreDocument-${document.name}`
          const pending = server.hocuspocus.debouncer.isDebounced(key) || server.hocuspocus.debouncer.isCurrentlyExecuting(key)
          if (!pending) connection.sendStateless(JSON.stringify({ type: 'stored', sv: Object.fromEntries(sv), at: Date.now() }))
        }
      } catch {}
    },
  })
  setHocuspocus(server.hocuspocus)
  return server
}
