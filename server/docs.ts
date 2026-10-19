// Persistence and derived data for per-creative Yjs documents.
import { createHash } from 'node:crypto'
import type { Hocuspocus } from '@hocuspocus/server'
import type pg from 'pg'
import * as Y from 'yjs'
import { contentFingerprint, plainTextForSearch, scriptSnapshot, type ScriptSnapshot } from '../shared/script'
import { logActivity } from './activity'
import { config } from './config'
import { one, pool, q } from './db'

export const docName = (creativeId: string) => `creative:${creativeId}`
export const creativeIdFromDocName = (name: string) => (name.startsWith('creative:') ? name.slice('creative:'.length) : null)

let hocuspocus: Hocuspocus | null = null
export function setHocuspocus(h: Hocuspocus) {
  hocuspocus = h
}

export const hashSnapshot = (snap: ScriptSnapshot) => createHash('sha256').update(contentFingerprint(snap)).digest('hex').slice(0, 32)

export async function loadState(creativeId: string, client: pg.Pool | pg.PoolClient = pool): Promise<Uint8Array | null> {
  const res = await client.query('SELECT state FROM creative_docs WHERE creative_id = $1', [creativeId])
  return res.rows[0]?.state ?? null
}

/**
 * Returns the freshest version of a creative's document: the live in-memory document when
 * someone is editing it (includes changes not yet flushed to the database), otherwise the stored one.
 * Treat the result as read-only.
 */
export async function readCreativeDoc(creativeId: string): Promise<Y.Doc> {
  const live = hocuspocus?.documents.get(docName(creativeId))
  if (live && !live.isLoading) return live
  const doc = new Y.Doc()
  const state = await loadState(creativeId)
  if (state) Y.applyUpdate(doc, state)
  return doc
}

/** Applies a change to the live document so connected editors receive it as a normal CRDT update. */
export async function mutateCreativeDoc(creativeId: string, userId: string, fn: (doc: Y.Doc) => void) {
  if (!hocuspocus) throw new Error('collaboration server not ready')
  const conn = await hocuspocus.openDirectConnection(docName(creativeId), { user: { id: userId }, system: true })
  try {
    await conn.transact((doc) => fn(doc))
  } finally {
    await conn.disconnect()
  }
}

/** Stores a brand new document for a creative (used on create / duplicate / short version). */
export async function insertNewDoc(client: pg.PoolClient, creativeId: string, doc: Y.Doc, userId: string) {
  const state = Buffer.from(Y.encodeStateAsUpdate(doc))
  const snap = scriptSnapshot(doc)
  const hash = hashSnapshot(snap)
  await client.query('INSERT INTO creative_docs (creative_id, state) VALUES ($1, $2)', [creativeId, state])
  await client.query('UPDATE creatives SET plain_text = $2, content_hash = $3 WHERE id = $1', [creativeId, plainTextForSearch(snap), hash])
  await client.query(
    `INSERT INTO creative_versions (creative_id, state, snapshot, content_hash, reason, created_by) VALUES ($1, $2, $3, $4, 'created', $5)`,
    [creativeId, state, snap, hash, userId],
  )
}

export async function saveVersion(
  creativeId: string,
  doc: Y.Doc,
  reason: 'auto' | 'manual' | 'approval' | 'pre_restore' | 'restore' | 'ai_applied',
  userId: string | null,
  label?: string,
) {
  const snap = scriptSnapshot(doc)
  const row = await one<{ id: string }>(
    `INSERT INTO creative_versions (creative_id, state, snapshot, content_hash, reason, created_by, label)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [creativeId, Buffer.from(Y.encodeStateAsUpdate(doc)), snap, hashSnapshot(snap), reason, userId, label ?? null],
  )
  return { id: row!.id, snapshot: snap, hash: hashSnapshot(snap) }
}

/**
 * Called by the collaboration server whenever a document is persisted.
 * Updates the cached plain text, flags approved scripts that changed, and takes periodic snapshots.
 */
export async function storeDoc(creativeId: string, doc: Y.Doc, userId: string | null) {
  const state = Buffer.from(Y.encodeStateAsUpdate(doc))
  const snap = scriptSnapshot(doc)
  const hash = hashSnapshot(snap)

  const creative = await one<any>(
    `INSERT INTO creative_docs (creative_id, state, updated_at) VALUES ($1, $2, now())
       ON CONFLICT (creative_id) DO UPDATE SET state = EXCLUDED.state, updated_at = now()
     RETURNING (SELECT row_to_json(c) FROM creatives c WHERE c.id = $1) AS c`,
    [creativeId, state],
  ).then((r) => r?.c)
  if (!creative) return

  if (creative.content_hash !== hash) {
    const becameStale = Boolean(creative.approved_hash) && creative.approved_hash !== hash && !creative.needs_review
    const backToApproved = Boolean(creative.approved_hash) && creative.approved_hash === hash && creative.needs_review
    await q(
      `UPDATE creatives SET plain_text = $2, content_hash = $3, content_updated_at = now(),
              needs_review = CASE WHEN approved_hash IS NULL THEN false ELSE approved_hash <> $3 END
        WHERE id = $1`,
      [creativeId, plainTextForSearch(snap), hash],
    )
    if (becameStale) {
      await logActivity({
        workspaceId: creative.workspace_id,
        userId,
        creativeId,
        action: 'creative.needs_review',
        details: { reason: 'התוכן השתנה לאחר אישור' },
      })
    }
    if (backToApproved) {
      await logActivity({ workspaceId: creative.workspace_id, userId, creativeId, action: 'creative.matches_approved' })
    }
    const last = await one<{ content_hash: string; created_at: Date }>(
      'SELECT content_hash, created_at FROM creative_versions WHERE creative_id = $1 ORDER BY created_at DESC LIMIT 1',
      [creativeId],
    )
    const old = !last || Date.now() - new Date(last.created_at).getTime() > config.autoVersionMinutes * 60_000
    if (old && last?.content_hash !== hash) await saveVersion(creativeId, doc, 'auto', userId)
  }
}

/** Drops all live collaboration connections (clients reconnect automatically; used after removing a member). */
export function closeAllConnections() {
  hocuspocus?.closeConnections()
}
