// Read-only external API, prepared for a future integration (e.g. an MCP server or automation).
// Auth: "Authorization: Bearer <token>" with a workspace API token created in Settings.
// Tokens can only read data of their own workspace. Nothing here can modify data.
import { Router, type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { combinedScript, scriptSnapshot } from '../../shared/script'
import { getCreative, getProduct } from '../access'
import { logActivity } from '../activity'
import { randomToken, sha256 } from '../auth'
import { checkId } from '../access'
import { one, q } from '../db'
import { readCreativeDoc } from '../docs'
import { HttpError, notFound } from '../errors'
import { rateLimit } from '../rateLimit'

// ----- token management (session-authenticated, mounted under /api) -----
export const tokensRouter = Router()

tokensRouter.get('/api-tokens', async (req, res) => {
  const rows = await q(
    `SELECT t.id, t.name, t.scopes, t.created_at, t.last_used_at, t.revoked_at, u.name AS created_by_name
       FROM api_tokens t LEFT JOIN users u ON u.id = t.created_by WHERE t.workspace_id = $1 ORDER BY t.created_at DESC`,
    [req.user!.workspaceId],
  )
  res.json(rows)
})

tokensRouter.post('/api-tokens', async (req, res) => {
  const body = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body)
  const token = `cw_${randomToken(24)}`
  await q(`INSERT INTO api_tokens (workspace_id, name, token_hash, scopes, created_by) VALUES ($1, $2, $3, ARRAY['read'], $4)`, [
    req.user!.workspaceId,
    body.name,
    sha256(token),
    req.user!.id,
  ])
  await logActivity({ workspaceId: req.user!.workspaceId, userId: req.user!.id, action: 'api_token.created', details: { name: body.name } })
  res.status(201).json({ token })
})

tokensRouter.delete('/api-tokens/:tid', async (req, res) => {
  checkId(req.params.tid, 'הטוקן')
  const row = await one('UPDATE api_tokens SET revoked_at = now() WHERE id = $1 AND workspace_id = $2 RETURNING id', [req.params.tid, req.user!.workspaceId])
  if (!row) throw notFound('הטוקן')
  await logActivity({ workspaceId: req.user!.workspaceId, userId: req.user!.id, action: 'api_token.revoked' })
  res.json({ ok: true })
})

// ----- external read API (token-authenticated, mounted under /api/ext/v1) -----
export const externalRouter = Router()

async function requireToken(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  if (!token) return next(new HttpError(401, 'missing bearer token'))
  const r = rateLimit(`ext:${token.slice(0, 12)}`, 120, 60_000)
  if (!r.ok) return next(new HttpError(429, 'rate limited'))
  const row = await one<any>('SELECT id, workspace_id, scopes FROM api_tokens WHERE token_hash = $1 AND revoked_at IS NULL', [sha256(token)])
  if (!row || !row.scopes.includes('read')) return next(new HttpError(401, 'invalid token'))
  await q('UPDATE api_tokens SET last_used_at = now() WHERE id = $1', [row.id])
  // Read-only principal scoped to one workspace.
  req.user = { id: '', email: '', name: `api:${row.id}`, color: '', workspaceId: row.workspace_id, role: 'member' }
  next()
}

externalRouter.use(requireToken)

externalRouter.get('/brands', async (req, res) => {
  res.json(await q('SELECT id, name, created_at FROM brands WHERE workspace_id = $1 AND archived_at IS NULL ORDER BY name', [req.user!.workspaceId]))
})

externalRouter.get('/products', async (req, res) => {
  res.json(
    await q(
      `SELECT p.id, p.brand_id, p.name, p.description, p.dossier, p.updated_at FROM products p
        WHERE p.workspace_id = $1 AND p.archived_at IS NULL ORDER BY p.name`,
      [req.user!.workspaceId],
    ),
  )
})

externalRouter.get('/products/:id/creatives', async (req, res) => {
  const p = await getProduct(req.user!, req.params.id)
  res.json(
    await q(
      `SELECT id, name, angle, status, needs_review, approved_at, source_creative_id, source_kind, content_updated_at
         FROM creatives WHERE product_id = $1 AND archived_at IS NULL ORDER BY content_updated_at DESC`,
      [p.id],
    ),
  )
})

externalRouter.get('/creatives/:id', async (req, res) => {
  const c = await getCreative(req.user!, req.params.id)
  const snap = scriptSnapshot(await readCreativeDoc(c.id))
  res.json({
    id: c.id,
    name: c.name,
    angle: c.angle,
    status: c.status,
    approved_at: c.approved_at,
    needs_review: c.needs_review,
    script: snap,
    combined: snap.hooks.map((h) => ({ hookId: h.id, text: combinedScript(snap, h.id) })),
  })
})

externalRouter.get('/creatives/:id/history', async (req, res) => {
  const c = await getCreative(req.user!, req.params.id)
  const [activity, versions] = await Promise.all([
    q(
      `SELECT a.action, a.details, a.created_at, u.name AS user_name FROM activity a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.creative_id = $1 ORDER BY a.created_at DESC LIMIT 200`,
      [c.id],
    ),
    q('SELECT id, reason, label, created_at FROM creative_versions WHERE creative_id = $1 ORDER BY created_at DESC LIMIT 100', [c.id]),
  ])
  res.json({ activity, versions })
})
