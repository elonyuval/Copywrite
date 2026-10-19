// Owner-only operations: backups, AI connection check, member removal.
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { checkId } from '../access'
import { logActivity } from '../activity'
import { checkAi } from '../ai/client'
import { backupPath, backupStatus, createBackup, listBackups, pruneBackups } from '../backup'
import { config } from '../config'
import { one, q } from '../db'
import { closeAllConnections } from '../docs'
import { badRequest, conflict, forbidden, notFound } from '../errors'
import { rateLimit } from '../rateLimit'

export const adminRouter = Router()

function ownerOnly(req: Request, _res: Response, next: NextFunction) {
  if (req.user?.role !== 'owner') return next(forbidden())
  next()
}

// ---------- AI connection check (any member) ----------

adminRouter.post('/ai/check', async (req, res) => {
  const r = rateLimit(`ai-check:${req.user!.id}`, 5, 10 * 60_000)
  if (!r.ok) throw badRequest(`נסו שוב בעוד ${r.retryAfterSec} שניות`)
  res.json(await checkAi())
})

// ---------- backups ----------

let backupRunning = false

adminRouter.get('/backups', ownerOnly, async (_req, res) => {
  res.json({ enabled: config.backupEnabled, keep: config.backupKeep, status: backupStatus, backups: await listBackups() })
})

adminRouter.post('/backups', ownerOnly, async (req, res) => {
  const body = z.object({ kind: z.enum(['db', 'full']).default('db') }).parse(req.body ?? {})
  if (backupRunning) throw conflict('גיבוי אחר כבר רץ — רגע אחד')
  backupRunning = true
  try {
    const b = await createBackup(body.kind)
    await pruneBackups(config.backupKeep, 3)
    await logActivity({ workspaceId: req.user!.workspaceId, userId: req.user!.id, action: 'backup.created', details: { name: b.name, size: b.size } })
    res.status(201).json(b)
  } finally {
    backupRunning = false
  }
})

adminRouter.get('/backups/:name', ownerOnly, async (req, res) => {
  const p = backupPath(String(req.params.name))
  if (!p) throw notFound('הגיבוי')
  const s = await stat(p).catch(() => null)
  if (!s) throw notFound('הגיבוי')
  res.setHeader('Content-Type', 'application/gzip')
  res.setHeader('Content-Length', String(s.size))
  res.setHeader('Content-Disposition', `attachment; filename="${req.params.name}"`)
  createReadStream(p).pipe(res)
})

// ---------- members ----------

/** Removes a member's access (their comments and history stay, attributed to them). */
adminRouter.delete('/workspace/members/:uid', ownerOnly, async (req, res) => {
  checkId(String(req.params.uid), 'המשתמש')
  if (req.params.uid === req.user!.id) throw badRequest('אי אפשר להסיר את עצמך')
  const m = await one<{ name: string }>(
    `DELETE FROM memberships m USING users u WHERE m.user_id = u.id AND m.user_id = $1 AND m.workspace_id = $2 RETURNING u.name`,
    [req.params.uid, req.user!.workspaceId],
  )
  if (!m) throw notFound('המשתמש')
  await q('DELETE FROM sessions WHERE user_id = $1', [req.params.uid])
  closeAllConnections()
  await logActivity({ workspaceId: req.user!.workspaceId, userId: req.user!.id, action: 'member.removed', details: { name: m.name } })
  res.json({ ok: true })
})
