// History & restore, approval, comments, files and links.
import { Router } from 'express'
import multer from 'multer'
import * as Y from 'yjs'
import { z } from 'zod'
import { copyScript } from '../../shared/script'
import { checkId, getCreative } from '../access'
import { logActivity } from '../activity'
import { config } from '../config'
import { one, q } from '../db'
import { mutateCreativeDoc, readCreativeDoc, saveVersion } from '../docs'
import { badRequest, forbidden, notFound } from '../errors'
import { openFile, storeUploadedFile, tmpDir } from '../storage'

export const productionRouter = Router()

// ---------- versions ----------

productionRouter.get('/creatives/:id/versions', async (req, res) => {
  const creative = await getCreative(req.user!, req.params.id)
  const rows = await q(
    `SELECT v.id, v.reason, v.label, v.content_hash, v.created_at, u.name AS user_name,
            (v.id = $2::uuid) AS is_approved
       FROM creative_versions v LEFT JOIN users u ON u.id = v.created_by
      WHERE v.creative_id = $1 ORDER BY v.created_at DESC LIMIT 200`,
    [creative.id, creative.approved_version_id],
  )
  res.json(rows)
})

productionRouter.get('/versions/:vid', async (req, res) => {
  checkId(req.params.vid, 'הגרסה')
  const v = await one<any>(
    `SELECT v.id, v.creative_id, v.snapshot, v.reason, v.label, v.created_at, u.name AS user_name
       FROM creative_versions v JOIN creatives c ON c.id = v.creative_id LEFT JOIN users u ON u.id = v.created_by
      WHERE v.id = $1 AND c.workspace_id = $2`,
    [req.params.vid, req.user!.workspaceId],
  )
  if (!v) throw notFound('הגרסה')
  res.json(v)
})

productionRouter.post('/creatives/:id/versions', async (req, res) => {
  const creative = await getCreative(req.user!, req.params.id)
  const body = z.object({ label: z.string().trim().max(120).optional() }).parse(req.body ?? {})
  const doc = await readCreativeDoc(creative.id)
  const v = await saveVersion(creative.id, doc, 'manual', req.user!.id, body.label)
  await logActivity({ workspaceId: req.user!.workspaceId, userId: req.user!.id, creativeId: creative.id, action: 'version.saved', details: { label: body.label } })
  res.status(201).json({ id: v.id })
})

/**
 * Restores a version by applying its content to the live document as new CRDT changes, so
 * connected editors see it immediately. The current state is snapshotted first, so a restore
 * can itself be undone from history.
 */
productionRouter.post('/creatives/:id/versions/:vid/restore', async (req, res) => {
  const creative = await getCreative(req.user!, req.params.id)
  checkId(req.params.vid, 'הגרסה')
  const v = await one<any>('SELECT id, state, created_at FROM creative_versions WHERE id = $1 AND creative_id = $2', [req.params.vid, creative.id])
  if (!v) throw notFound('הגרסה')
  const current = await readCreativeDoc(creative.id)
  await saveVersion(creative.id, current, 'pre_restore', req.user!.id, 'לפני שחזור')
  const old = new Y.Doc()
  Y.applyUpdate(old, v.state)
  await mutateCreativeDoc(creative.id, req.user!.id, (doc) => copyScript(old, doc))
  await logActivity({
    workspaceId: req.user!.workspaceId,
    userId: req.user!.id,
    creativeId: creative.id,
    action: 'version.restored',
    details: { versionId: v.id, versionDate: v.created_at },
  })
  res.json({ ok: true })
})

// ---------- approval ----------

productionRouter.post('/creatives/:id/approve', async (req, res) => {
  const creative = await getCreative(req.user!, req.params.id)
  const body = z.object({ note: z.string().trim().max(1000).optional() }).parse(req.body ?? {})
  const doc = await readCreativeDoc(creative.id)
  const v = await saveVersion(creative.id, doc, 'approval', req.user!.id, 'גרסה שאושרה')
  await q('INSERT INTO approvals (creative_id, version_id, content_hash, approved_by, note) VALUES ($1, $2, $3, $4, $5)', [
    creative.id,
    v.id,
    v.hash,
    req.user!.id,
    body.note ?? null,
  ])
  const updated = await one(
    `UPDATE creatives SET approved_version_id = $2, approved_hash = $3, content_hash = $3, approved_by = $4,
            approved_at = now(), needs_review = false, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [creative.id, v.id, v.hash, req.user!.id],
  )
  await logActivity({ workspaceId: req.user!.workspaceId, userId: req.user!.id, creativeId: creative.id, action: 'creative.approved', details: { versionId: v.id, note: body.note } })
  res.json(updated)
})

productionRouter.delete('/creatives/:id/approve', async (req, res) => {
  const creative = await getCreative(req.user!, req.params.id)
  const updated = await one(
    `UPDATE creatives SET approved_version_id = NULL, approved_hash = NULL, approved_by = NULL, approved_at = NULL,
            needs_review = false, updated_at = now() WHERE id = $1 RETURNING *`,
    [creative.id],
  )
  await logActivity({ workspaceId: req.user!.workspaceId, userId: req.user!.id, creativeId: creative.id, action: 'creative.approval_revoked' })
  res.json(updated)
})

productionRouter.get('/creatives/:id/approvals', async (req, res) => {
  const creative = await getCreative(req.user!, req.params.id)
  const rows = await q(
    `SELECT a.id, a.version_id, a.note, a.created_at, u.name AS user_name
       FROM approvals a JOIN users u ON u.id = a.approved_by WHERE a.creative_id = $1 ORDER BY a.created_at DESC`,
    [creative.id],
  )
  res.json(rows)
})

// ---------- comments ----------

productionRouter.get('/creatives/:id/comments', async (req, res) => {
  const creative = await getCreative(req.user!, req.params.id)
  const rows = await q(
    `SELECT c.id, c.body, c.created_at, c.edited_at, c.user_id, u.name AS user_name, u.color AS user_color
       FROM comments c JOIN users u ON u.id = c.user_id
      WHERE c.creative_id = $1 AND c.deleted_at IS NULL ORDER BY c.created_at`,
    [creative.id],
  )
  res.json(rows)
})

productionRouter.post('/creatives/:id/comments', async (req, res) => {
  const creative = await getCreative(req.user!, req.params.id)
  const body = z.object({ body: z.string().trim().min(1, 'התגובה ריקה').max(10000) }).parse(req.body)
  const row = await one('INSERT INTO comments (creative_id, user_id, body) VALUES ($1, $2, $3) RETURNING *', [creative.id, req.user!.id, body.body])
  await logActivity({ workspaceId: req.user!.workspaceId, userId: req.user!.id, creativeId: creative.id, action: 'comment.added' })
  res.status(201).json(row)
})

productionRouter.delete('/comments/:cid', async (req, res) => {
  checkId(req.params.cid, 'התגובה')
  const c = await one<any>(
    `SELECT cm.* FROM comments cm JOIN creatives c ON c.id = cm.creative_id WHERE cm.id = $1 AND c.workspace_id = $2 AND cm.deleted_at IS NULL`,
    [req.params.cid, req.user!.workspaceId],
  )
  if (!c) throw notFound('התגובה')
  if (c.user_id !== req.user!.id) throw forbidden()
  await q('UPDATE comments SET deleted_at = now() WHERE id = $1', [c.id])
  res.json({ ok: true })
})

// ---------- files ----------

const upload = multer({ dest: tmpDir(), limits: { fileSize: config.maxUploadBytes, files: 1 } })

async function saveFileRow(file: Express.Multer.File, workspaceId: string, userId: string) {
  const key = await storeUploadedFile(file.path, workspaceId)
  // Multer gives latin1-decoded names; restore UTF-8 so Hebrew file names survive.
  const original = Buffer.from(file.originalname, 'latin1').toString('utf8')
  return one(
    `INSERT INTO files (workspace_id, storage_key, original_name, mime, size, uploaded_by) VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, original_name, mime, size`,
    [workspaceId, key, original, file.mimetype || 'application/octet-stream', file.size, userId],
  )
}

/** Generic upload (brand logos, product images). */
productionRouter.post('/files', upload.single('file'), async (req, res) => {
  if (!req.file) throw badRequest('לא נבחר קובץ')
  const row = await saveFileRow(req.file, req.user!.workspaceId, req.user!.id)
  res.status(201).json(row)
})

const INLINE_TYPES = /^(image\/(png|jpe?g|gif|webp|avif)|video\/|audio\/|application\/pdf)/

productionRouter.get('/files/:fid', async (req, res) => {
  checkId(req.params.fid, 'הקובץ')
  const f = await one<any>('SELECT * FROM files WHERE id = $1 AND workspace_id = $2', [req.params.fid, req.user!.workspaceId])
  if (!f) throw notFound('הקובץ')
  const { stream, size } = await openFile(f.storage_key)
  const inline = INLINE_TYPES.test(f.mime) && req.query.download === undefined
  res.setHeader('Content-Type', inline ? f.mime : 'application/octet-stream')
  res.setHeader('Content-Length', String(size))
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'private, max-age=3600')
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.original_name)}`)
  stream.pipe(res)
})

// ---------- production assets (files + links) per creative ----------

productionRouter.get('/creatives/:id/assets', async (req, res) => {
  const creative = await getCreative(req.user!, req.params.id)
  const rows = await q(
    `SELECT a.id, a.kind, a.name, a.description, a.url, a.file_id, a.created_at, u.name AS user_name,
            f.original_name, f.mime, f.size
       FROM assets a LEFT JOIN users u ON u.id = a.created_by LEFT JOIN files f ON f.id = a.file_id
      WHERE a.creative_id = $1 AND a.deleted_at IS NULL ORDER BY a.created_at DESC`,
    [creative.id],
  )
  res.json(rows)
})

// Authorize before accepting the upload body.
productionRouter.post(
  '/creatives/:id/assets/file',
  async (req, res, next) => {
    res.locals.creative = await getCreative(req.user!, String(req.params.id))
    next()
  },
  upload.single('file'),
  async (req, res) => {
  const creative = res.locals.creative
  if (!req.file) throw badRequest('לא נבחר קובץ')
  const meta = z.object({ name: z.string().trim().max(200).optional(), description: z.string().max(2000).optional() }).parse(req.body ?? {})
  const file = await saveFileRow(req.file, req.user!.workspaceId, req.user!.id)
  const row = await one(
    `INSERT INTO assets (creative_id, kind, name, description, file_id, created_by) VALUES ($1, 'file', $2, $3, $4, $5) RETURNING *`,
    [creative.id, meta.name || file.original_name, meta.description ?? '', file.id, req.user!.id],
  )
  await logActivity({ workspaceId: req.user!.workspaceId, userId: req.user!.id, creativeId: creative.id, action: 'asset.added', details: { kind: 'file', name: row.name } })
  res.status(201).json(row)
  },
)

productionRouter.post('/creatives/:id/assets/link', async (req, res) => {
  const creative = await getCreative(req.user!, req.params.id)
  const body = z
    .object({
      url: z.string().trim().url('קישור לא תקין').refine((u) => /^https?:\/\//i.test(u), 'הקישור חייב להתחיל ב-http או https'),
      name: z.string().trim().min(1, 'יש להזין שם').max(200),
      description: z.string().max(2000).optional(),
    })
    .parse(req.body)
  const row = await one(
    `INSERT INTO assets (creative_id, kind, name, description, url, created_by) VALUES ($1, 'link', $2, $3, $4, $5) RETURNING *`,
    [creative.id, body.name, body.description ?? '', body.url, req.user!.id],
  )
  await logActivity({ workspaceId: req.user!.workspaceId, userId: req.user!.id, creativeId: creative.id, action: 'asset.added', details: { kind: 'link', name: body.name } })
  res.status(201).json(row)
})

productionRouter.delete('/assets/:aid', async (req, res) => {
  checkId(req.params.aid, 'הקובץ')
  const a = await one<any>(
    `SELECT a.* FROM assets a JOIN creatives c ON c.id = a.creative_id WHERE a.id = $1 AND c.workspace_id = $2 AND a.deleted_at IS NULL`,
    [req.params.aid, req.user!.workspaceId],
  )
  if (!a) throw notFound('הקובץ')
  await q('UPDATE assets SET deleted_at = now() WHERE id = $1', [a.id])
  await logActivity({ workspaceId: req.user!.workspaceId, userId: req.user!.id, creativeId: a.creative_id, action: 'asset.removed', details: { name: a.name } })
  res.json({ ok: true })
})

