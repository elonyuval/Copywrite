// Brands -> products -> creatives, home page and search.
import { Router } from 'express'
import * as Y from 'yjs'
import { z } from 'zod'
import { STATUSES, STATUS_LABELS, DOSSIER_FIELDS } from '../../shared/constants'
import { copyScript, initDoc } from '../../shared/script'
import { getBrand, getCreative, getProduct } from '../access'
import { logActivity } from '../activity'
import { one, q, tx } from '../db'
import { insertNewDoc, readCreativeDoc } from '../docs'
import { badRequest } from '../errors'

export const catalogRouter = Router()

const name = z.string().trim().min(1, 'יש להזין שם').max(160)
const optFileId = z.string().uuid().nullable().optional()

async function assertFileInWorkspace(fileId: string | null | undefined, workspaceId: string) {
  if (!fileId) return
  const f = await one('SELECT 1 FROM files WHERE id = $1 AND workspace_id = $2', [fileId, workspaceId])
  if (!f) throw badRequest('הקובץ לא נמצא')
}

// ---------- home & search ----------

catalogRouter.get('/home', async (req, res) => {
  const ws = req.user!.workspaceId
  const [brands, recent, mine] = await Promise.all([
    q(
      `SELECT b.id, b.name, b.logo_file_id,
              (SELECT count(*)::int FROM products p WHERE p.brand_id = b.id AND p.archived_at IS NULL) AS product_count,
              (SELECT count(*)::int FROM creatives c JOIN products p ON p.id = c.product_id
                WHERE p.brand_id = b.id AND c.archived_at IS NULL AND p.archived_at IS NULL) AS creative_count
         FROM brands b WHERE b.workspace_id = $1 AND b.archived_at IS NULL ORDER BY b.name`,
      [ws],
    ),
    q(
      `SELECT c.id, c.name, c.status, c.needs_review, c.content_updated_at, p.id AS product_id, p.name AS product_name, b.name AS brand_name
         FROM creatives c JOIN products p ON p.id = c.product_id JOIN brands b ON b.id = p.brand_id
        WHERE c.workspace_id = $1 AND c.archived_at IS NULL AND p.archived_at IS NULL AND b.archived_at IS NULL
        ORDER BY c.content_updated_at DESC LIMIT 12`,
      [ws],
    ),
    q(
      `SELECT c.id, c.name, c.status, v.visited_at, p.name AS product_name, b.name AS brand_name
         FROM creative_visits v JOIN creatives c ON c.id = v.creative_id
         JOIN products p ON p.id = c.product_id JOIN brands b ON b.id = p.brand_id
        WHERE v.user_id = $1 AND c.workspace_id = $2 AND c.archived_at IS NULL AND p.archived_at IS NULL AND b.archived_at IS NULL
        ORDER BY v.visited_at DESC LIMIT 5`,
      [req.user!.id, ws],
    ),
  ])
  res.json({ brands, recent, continue: mine })
})

catalogRouter.get('/search', async (req, res) => {
  const term = String(req.query.q ?? '').trim()
  if (!term) return void res.json({ brands: [], products: [], creatives: [] })
  const like = `%${term.replace(/[\\%_]/g, (m) => '\\' + m)}%`
  const ws = req.user!.workspaceId
  const [brands, products, creatives] = await Promise.all([
    q(`SELECT id, name FROM brands WHERE workspace_id = $1 AND archived_at IS NULL AND name ILIKE $2 ORDER BY name LIMIT 10`, [ws, like]),
    q(
      `SELECT p.id, p.name, b.name AS brand_name FROM products p JOIN brands b ON b.id = p.brand_id
        WHERE p.workspace_id = $1 AND p.archived_at IS NULL AND b.archived_at IS NULL AND p.name ILIKE $2 ORDER BY p.name LIMIT 10`,
      [ws, like],
    ),
    q(
      `SELECT c.id, c.name, c.status, p.name AS product_name, b.name AS brand_name,
              (c.name ILIKE $2) AS name_match
         FROM creatives c JOIN products p ON p.id = c.product_id JOIN brands b ON b.id = p.brand_id
        WHERE c.workspace_id = $1 AND c.archived_at IS NULL AND p.archived_at IS NULL AND b.archived_at IS NULL
          AND (c.name ILIKE $2 OR c.angle ILIKE $2 OR c.plain_text ILIKE $2 OR p.name ILIKE $2 OR b.name ILIKE $2)
        ORDER BY name_match DESC, c.content_updated_at DESC LIMIT 20`,
      [ws, like],
    ),
  ])
  res.json({ brands, products, creatives })
})

// ---------- brands ----------

catalogRouter.post('/brands', async (req, res) => {
  const body = z.object({ name, logoFileId: optFileId }).parse(req.body)
  await assertFileInWorkspace(body.logoFileId, req.user!.workspaceId)
  const b = await one(
    'INSERT INTO brands (workspace_id, name, logo_file_id, created_by) VALUES ($1, $2, $3, $4) RETURNING *',
    [req.user!.workspaceId, body.name, body.logoFileId ?? null, req.user!.id],
  )
  await logActivity({ workspaceId: req.user!.workspaceId, userId: req.user!.id, brandId: b.id, action: 'brand.created', details: { name: body.name } })
  res.status(201).json(b)
})

catalogRouter.get('/brands/:id', async (req, res) => {
  const brand = await getBrand(req.user!, req.params.id)
  const products = await q(
    `SELECT p.id, p.name, p.description, p.image_file_id, p.updated_at,
            (SELECT count(*)::int FROM creatives c WHERE c.product_id = p.id AND c.archived_at IS NULL) AS creative_count
       FROM products p WHERE p.brand_id = $1 AND p.archived_at IS NULL ORDER BY p.name`,
    [brand.id],
  )
  res.json({ brand, products })
})

catalogRouter.patch('/brands/:id', async (req, res) => {
  const brand = await getBrand(req.user!, req.params.id)
  const body = z.object({ name: name.optional(), logoFileId: optFileId }).parse(req.body)
  await assertFileInWorkspace(body.logoFileId, req.user!.workspaceId)
  const b = await one(
    `UPDATE brands SET name = COALESCE($2, name),
            logo_file_id = CASE WHEN $4 THEN $3::uuid ELSE logo_file_id END, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [brand.id, body.name ?? null, body.logoFileId ?? null, body.logoFileId !== undefined],
  )
  await logActivity({ workspaceId: req.user!.workspaceId, userId: req.user!.id, brandId: brand.id, action: 'brand.updated', details: body })
  res.json(b)
})

catalogRouter.delete('/brands/:id', async (req, res) => {
  const brand = await getBrand(req.user!, req.params.id)
  await q('UPDATE brands SET archived_at = now() WHERE id = $1', [brand.id])
  await logActivity({ workspaceId: req.user!.workspaceId, userId: req.user!.id, brandId: brand.id, action: 'brand.archived' })
  res.json({ ok: true })
})

// ---------- products ----------

const dossierSchema = z.object(Object.fromEntries(DOSSIER_FIELDS.map((f) => [f.key, z.string().max(20000).optional()]))).partial()

catalogRouter.post('/brands/:id/products', async (req, res) => {
  const brand = await getBrand(req.user!, req.params.id)
  const body = z.object({ name, description: z.string().max(5000).optional(), imageFileId: optFileId }).parse(req.body)
  await assertFileInWorkspace(body.imageFileId, req.user!.workspaceId)
  const p = await one(
    `INSERT INTO products (workspace_id, brand_id, name, description, image_file_id, created_by)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [req.user!.workspaceId, brand.id, body.name, body.description ?? '', body.imageFileId ?? null, req.user!.id],
  )
  await logActivity({ workspaceId: req.user!.workspaceId, userId: req.user!.id, brandId: brand.id, productId: p.id, action: 'product.created', details: { name: body.name } })
  res.status(201).json(p)
})

catalogRouter.get('/products/:id', async (req, res) => {
  const product = await getProduct(req.user!, req.params.id)
  const brand = await one('SELECT id, name, logo_file_id FROM brands WHERE id = $1', [product.brand_id])
  const creatives = await q(
    `SELECT c.id, c.name, c.angle, c.status, c.needs_review, c.approved_at, c.source_kind, c.source_creative_id,
            c.content_updated_at, c.created_at, u.name AS created_by_name
       FROM creatives c LEFT JOIN users u ON u.id = c.created_by
      WHERE c.product_id = $1 AND c.archived_at IS NULL ORDER BY c.content_updated_at DESC`,
    [product.id],
  )
  res.json({ product, brand, creatives })
})

/**
 * Product details and dossier. Uses a revision number: if someone else saved in the meantime the
 * request is rejected (409) instead of silently overwriting their text.
 */
catalogRouter.patch('/products/:id', async (req, res) => {
  const product = await getProduct(req.user!, req.params.id)
  const body = z
    .object({
      revision: z.number().int(),
      name: name.optional(),
      description: z.string().max(5000).optional(),
      imageFileId: optFileId,
      dossier: dossierSchema.optional(),
    })
    .parse(req.body)
  await assertFileInWorkspace(body.imageFileId, req.user!.workspaceId)
  const updated = await one(
    `UPDATE products SET name = COALESCE($3, name), description = COALESCE($4, description),
            image_file_id = CASE WHEN $6 THEN $5::uuid ELSE image_file_id END,
            dossier = CASE WHEN $7::jsonb IS NULL THEN dossier ELSE dossier || $7::jsonb END,
            revision = revision + 1, updated_at = now()
      WHERE id = $1 AND revision = $2 RETURNING *`,
    [
      product.id,
      body.revision,
      body.name ?? null,
      body.description ?? null,
      body.imageFileId ?? null,
      body.imageFileId !== undefined,
      body.dossier ? JSON.stringify(body.dossier) : null,
    ],
  )
  if (!updated) {
    const current = await one('SELECT * FROM products WHERE id = $1', [product.id])
    res.status(409).json({ error: 'המוצר עודכן בינתיים על ידי משתמש אחר. הנתונים העדכניים נטענו — בדקו ושמרו שוב.', code: 'conflict', current })
    return
  }
  const changed = [
    ...(body.name !== undefined ? ['name'] : []),
    ...(body.description !== undefined ? ['description'] : []),
    ...(body.imageFileId !== undefined ? ['image'] : []),
    ...Object.keys(body.dossier ?? {}).map((k) => `dossier.${k}`),
  ]
  await logActivity({ workspaceId: req.user!.workspaceId, userId: req.user!.id, productId: product.id, brandId: product.brand_id, action: 'product.updated', details: { fields: changed } })
  res.json(updated)
})

catalogRouter.delete('/products/:id', async (req, res) => {
  const product = await getProduct(req.user!, req.params.id)
  await q('UPDATE products SET archived_at = now() WHERE id = $1', [product.id])
  await logActivity({ workspaceId: req.user!.workspaceId, userId: req.user!.id, productId: product.id, action: 'product.archived' })
  res.json({ ok: true })
})

// ---------- creatives ----------

catalogRouter.post('/products/:id/creatives', async (req, res) => {
  const product = await getProduct(req.user!, req.params.id)
  const body = z.object({ name, angle: z.string().max(500).optional(), mode: z.enum(['free', 'ai']).default('free') }).parse(req.body)
  const created = await tx(async (c) => {
    const row = (
      await c.query(
        `INSERT INTO creatives (workspace_id, product_id, name, angle, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [req.user!.workspaceId, product.id, body.name, body.angle ?? '', req.user!.id],
      )
    ).rows[0]
    const doc = new Y.Doc()
    initDoc(doc)
    await insertNewDoc(c, row.id, doc, req.user!.id)
    return row
  })
  await logActivity({
    workspaceId: req.user!.workspaceId,
    userId: req.user!.id,
    productId: product.id,
    creativeId: created.id,
    action: 'creative.created',
    details: { name: body.name, mode: body.mode },
  })
  res.status(201).json(created)
})

catalogRouter.get('/creatives/:id', async (req, res) => {
  const creative = await getCreative(req.user!, req.params.id)
  const [product, source, approver, derived] = await Promise.all([
    one(
      `SELECT p.id, p.name, p.brand_id, b.name AS brand_name FROM products p JOIN brands b ON b.id = p.brand_id WHERE p.id = $1`,
      [creative.product_id],
    ),
    creative.source_creative_id
      ? one('SELECT id, name, archived_at FROM creatives WHERE id = $1 AND workspace_id = $2', [creative.source_creative_id, req.user!.workspaceId])
      : null,
    creative.approved_by ? one('SELECT id, name FROM users WHERE id = $1', [creative.approved_by]) : null,
    q(`SELECT id, name, source_kind, status FROM creatives WHERE source_creative_id = $1 AND archived_at IS NULL ORDER BY created_at`, [creative.id]),
  ])
  await q(
    `INSERT INTO creative_visits (user_id, creative_id) VALUES ($1, $2)
       ON CONFLICT (user_id, creative_id) DO UPDATE SET visited_at = now()`,
    [req.user!.id, creative.id],
  )
  res.json({ creative, product, source, approver, derived })
})

catalogRouter.patch('/creatives/:id', async (req, res) => {
  const creative = await getCreative(req.user!, req.params.id)
  const body = z
    .object({ name: name.optional(), angle: z.string().max(500).optional(), status: z.enum(STATUSES).optional() })
    .parse(req.body)
  const updated = await one(
    `UPDATE creatives SET name = COALESCE($2, name), angle = COALESCE($3, angle), status = COALESCE($4, status),
            revision = revision + 1, updated_at = now()
      WHERE id = $1 RETURNING *`,
    [creative.id, body.name ?? null, body.angle ?? null, body.status ?? null],
  )
  const base = { workspaceId: req.user!.workspaceId, userId: req.user!.id, creativeId: creative.id, productId: creative.product_id }
  if (body.status && body.status !== creative.status) {
    await logActivity({
      ...base,
      action: 'creative.status',
      details: { from: creative.status, to: body.status, label: STATUS_LABELS[body.status] },
    })
  }
  if ((body.name && body.name !== creative.name) || (body.angle !== undefined && body.angle !== creative.angle)) {
    await logActivity({ ...base, action: 'creative.renamed', details: { name: body.name, angle: body.angle } })
  }
  res.json(updated)
})

catalogRouter.delete('/creatives/:id', async (req, res) => {
  const creative = await getCreative(req.user!, req.params.id)
  await q('UPDATE creatives SET archived_at = now() WHERE id = $1', [creative.id])
  await logActivity({ workspaceId: req.user!.workspaceId, userId: req.user!.id, creativeId: creative.id, productId: creative.product_id, action: 'creative.archived' })
  res.json({ ok: true })
})

/**
 * Duplicate: a new identity with the same script and research. Approvals, comments, files and
 * AI conversations are intentionally NOT copied. Keeps a link to the source.
 */
catalogRouter.post('/creatives/:id/duplicate', async (req, res) => {
  const source = await getCreative(req.user!, req.params.id)
  const body = z.object({ name: name.optional(), productId: z.string().uuid().optional() }).parse(req.body ?? {})
  const targetProduct = body.productId ? await getProduct(req.user!, body.productId) : { id: source.product_id }
  const srcDoc = await readCreativeDoc(source.id)
  const doc = new Y.Doc()
  copyScript(srcDoc, doc, { includeResearch: true })
  const created = await tx(async (c) => {
    const row = (
      await c.query(
        `INSERT INTO creatives (workspace_id, product_id, name, angle, created_by, source_creative_id, source_kind)
         VALUES ($1, $2, $3, $4, $5, $6, 'duplicate') RETURNING *`,
        [req.user!.workspaceId, targetProduct.id, body.name ?? `${source.name} (עותק)`, source.angle, req.user!.id, source.id],
      )
    ).rows[0]
    await insertNewDoc(c, row.id, doc, req.user!.id)
    return row
  })
  await logActivity({
    workspaceId: req.user!.workspaceId,
    userId: req.user!.id,
    creativeId: created.id,
    productId: created.product_id,
    action: 'creative.duplicated',
    details: { sourceId: source.id, sourceName: source.name },
  })
  res.status(201).json(created)
})

catalogRouter.get('/creatives/:id/activity', async (req, res) => {
  const creative = await getCreative(req.user!, req.params.id)
  const rows = await q(
    `SELECT a.id, a.action, a.details, a.created_at, u.name AS user_name, u.color AS user_color
       FROM activity a LEFT JOIN users u ON u.id = a.user_id
      WHERE a.creative_id = $1 ORDER BY a.created_at DESC LIMIT 200`,
    [creative.id],
  )
  res.json(rows)
})

