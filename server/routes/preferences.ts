// "Preferences & working methods": the team's long-term memory for the assistant.
import { Router } from 'express'
import { z } from 'zod'
import { PREFERENCE_CATEGORIES } from '../../shared/constants'
import { checkId, getBrand } from '../access'
import { logActivity } from '../activity'
import { one, q } from '../db'
import { notFound } from '../errors'

export const preferencesRouter = Router()

const categories = Object.keys(PREFERENCE_CATEGORIES) as [keyof typeof PREFERENCE_CATEGORIES, ...(keyof typeof PREFERENCE_CATEGORIES)[]]
const prefBody = z.object({
  category: z.enum(categories),
  title: z.string().trim().min(1, 'יש להזין כותרת').max(200),
  content: z.string().trim().min(1, 'יש להזין תוכן').max(20000),
  brandId: z.string().uuid().nullable().optional(),
  active: z.boolean().optional(),
})

preferencesRouter.get('/preferences', async (req, res) => {
  const rows = await q(
    `SELECT p.*, b.name AS brand_name, u.name AS created_by_name FROM preferences p
       LEFT JOIN brands b ON b.id = p.brand_id LEFT JOIN users u ON u.id = p.created_by
      WHERE p.workspace_id = $1 ORDER BY p.category, p.created_at`,
    [req.user!.workspaceId],
  )
  res.json(rows)
})

preferencesRouter.post('/preferences', async (req, res) => {
  const body = prefBody.parse(req.body)
  if (body.brandId) await getBrand(req.user!, body.brandId)
  const row = await one(
    `INSERT INTO preferences (workspace_id, brand_id, category, title, content, active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [req.user!.workspaceId, body.brandId ?? null, body.category, body.title, body.content, body.active ?? true, req.user!.id],
  )
  await logActivity({ workspaceId: req.user!.workspaceId, userId: req.user!.id, action: 'preference.created', details: { title: body.title } })
  res.status(201).json(row)
})

preferencesRouter.put('/preferences/:pid', async (req, res) => {
  checkId(req.params.pid, 'ההעדפה')
  const body = prefBody.parse(req.body)
  if (body.brandId) await getBrand(req.user!, body.brandId)
  const row = await one(
    `UPDATE preferences SET category = $3, title = $4, content = $5, brand_id = $6, active = COALESCE($7, active), updated_at = now()
      WHERE id = $1 AND workspace_id = $2 RETURNING *`,
    [req.params.pid, req.user!.workspaceId, body.category, body.title, body.content, body.brandId ?? null, body.active ?? null],
  )
  if (!row) throw notFound('ההעדפה')
  res.json(row)
})

preferencesRouter.delete('/preferences/:pid', async (req, res) => {
  checkId(req.params.pid, 'ההעדפה')
  const row = await one('DELETE FROM preferences WHERE id = $1 AND workspace_id = $2 RETURNING title', [req.params.pid, req.user!.workspaceId])
  if (!row) throw notFound('ההעדפה')
  await logActivity({ workspaceId: req.user!.workspaceId, userId: req.user!.id, action: 'preference.deleted', details: { title: row.title } })
  res.json({ ok: true })
})
