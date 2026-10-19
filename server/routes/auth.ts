import { Router } from 'express'
import { z } from 'zod'
import { createSession, destroySession, hashPassword, randomToken, requireAuth, sha256, verifyPassword } from '../auth'
import { logActivity } from '../activity'
import { config } from '../config'
import { one, q, tx } from '../db'
import { badRequest, conflict, forbidden, HttpError } from '../errors'
import { rateLimit } from '../rateLimit'

export const authRouter = Router()

const COLORS = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2']

const credentials = z.object({
  email: z.string().trim().toLowerCase().email('כתובת אימייל לא תקינה'),
  password: z.string().min(8, 'הסיסמה צריכה להכיל לפחות 8 תווים').max(200),
})
const newUser = credentials.extend({ name: z.string().trim().min(1, 'יש להזין שם').max(80) })

function limitAuth(ip: string | undefined) {
  const r = rateLimit(`auth:${ip}`, 20, 15 * 60_000)
  if (!r.ok) throw new HttpError(429, `יותר מדי ניסיונות. נסו שוב בעוד ${Math.ceil(r.retryAfterSec / 60)} דקות`, 'rate_limited')
}

authRouter.get('/auth/state', async (_req, res) => {
  const row = await one<{ n: number }>('SELECT count(*)::int AS n FROM users')
  res.json({
    setupRequired: row!.n === 0,
    setupTokenRequired: Boolean(config.setupToken) || config.isProd,
  })
})

/** Creates the first user and the shared workspace. Only possible while there are no users. */
authRouter.post('/auth/setup', async (req, res) => {
  limitAuth(req.ip)
  const body = newUser.extend({ workspaceName: z.string().trim().min(1).max(80), setupToken: z.string().optional() }).parse(req.body)
  if (config.isProd && !config.setupToken) throw new HttpError(503, 'יש להגדיר SETUP_TOKEN בשרת לפני יצירת המשתמש הראשון', 'setup_disabled')
  if (config.setupToken && body.setupToken !== config.setupToken) throw forbidden()
  const user = await tx(async (c) => {
    // Advisory lock so two simultaneous setups can't both succeed.
    await c.query('SELECT pg_advisory_xact_lock(42)')
    const n = (await c.query('SELECT count(*)::int AS n FROM users')).rows[0].n
    if (n > 0) throw conflict('סביבת העבודה כבר הוגדרה. יש להתחבר או להצטרף עם קוד הזמנה')
    const ws = (await c.query('INSERT INTO workspaces (name) VALUES ($1) RETURNING id', [body.workspaceName])).rows[0]
    const u = (
      await c.query('INSERT INTO users (email, name, password_hash, color) VALUES ($1, $2, $3, $4) RETURNING id', [
        body.email,
        body.name,
        await hashPassword(body.password),
        COLORS[0],
      ])
    ).rows[0]
    await c.query(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'owner')`, [ws.id, u.id])
    return { id: u.id, workspaceId: ws.id }
  })
  await logActivity({ workspaceId: user.workspaceId, userId: user.id, action: 'workspace.created' })
  await createSession(res, user.id)
  res.json({ ok: true })
})

/** Joins an existing workspace with a one-time invite code. */
authRouter.post('/auth/register', async (req, res) => {
  limitAuth(req.ip)
  const body = newUser.extend({ inviteCode: z.string().trim().min(6, 'יש להזין קוד הזמנה') }).parse(req.body)
  const result = await tx(async (c) => {
    const inv = (
      await c.query(
        'SELECT * FROM invites WHERE code_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE',
        [sha256(body.inviteCode)],
      )
    ).rows[0]
    if (!inv) throw badRequest('קוד ההזמנה לא תקין או שפג תוקפו')
    const exists = (await c.query('SELECT 1 FROM users WHERE email = $1', [body.email])).rows[0]
    if (exists) throw conflict('כבר קיים משתמש עם האימייל הזה')
    const count = (await c.query('SELECT count(*)::int AS n FROM memberships WHERE workspace_id = $1', [inv.workspace_id])).rows[0].n
    const u = (
      await c.query('INSERT INTO users (email, name, password_hash, color) VALUES ($1, $2, $3, $4) RETURNING id', [
        body.email,
        body.name,
        await hashPassword(body.password),
        COLORS[count % COLORS.length],
      ])
    ).rows[0]
    await c.query(`INSERT INTO memberships (workspace_id, user_id, role) VALUES ($1, $2, 'member')`, [inv.workspace_id, u.id])
    await c.query('UPDATE invites SET used_by = $2, used_at = now() WHERE id = $1', [inv.id, u.id])
    return { id: u.id, workspaceId: inv.workspace_id }
  })
  await logActivity({ workspaceId: result.workspaceId, userId: result.id, action: 'member.joined' })
  await createSession(res, result.id)
  res.json({ ok: true })
})

authRouter.post('/auth/login', async (req, res) => {
  limitAuth(req.ip)
  const body = credentials.parse(req.body)
  const u = await one<any>('SELECT id, password_hash FROM users WHERE email = $1', [body.email])
  if (!u || !(await verifyPassword(body.password, u.password_hash))) throw new HttpError(401, 'אימייל או סיסמה שגויים', 'bad_credentials')
  await createSession(res, u.id)
  res.json({ ok: true })
})

authRouter.post('/auth/logout', async (req, res) => {
  await destroySession(req, res)
  res.json({ ok: true })
})

authRouter.get('/me', requireAuth, async (req, res) => {
  const ws = await one('SELECT id, name FROM workspaces WHERE id = $1', [req.user!.workspaceId])
  res.json({ user: req.user, workspace: ws, aiConfigured: Boolean(config.openaiApiKey), aiModel: config.openaiModel })
})

authRouter.patch('/me', requireAuth, async (req, res) => {
  const body = z
    .object({ name: z.string().trim().min(1).max(80).optional(), color: z.string().regex(/^#[0-9a-f]{6}$/i).optional() })
    .parse(req.body)
  await q('UPDATE users SET name = COALESCE($2, name), color = COALESCE($3, color) WHERE id = $1', [
    req.user!.id,
    body.name ?? null,
    body.color ?? null,
  ])
  res.json({ ok: true })
})

authRouter.get('/workspace/members', requireAuth, async (req, res) => {
  const rows = await q(
    `SELECT u.id, u.name, u.email, u.color, m.role, m.created_at FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.workspace_id = $1 ORDER BY m.created_at`,
    [req.user!.workspaceId],
  )
  res.json(rows)
})

authRouter.post('/workspace/invites', requireAuth, async (req, res) => {
  const code = randomToken(9)
  const expires = new Date(Date.now() + 7 * 86400_000)
  await q('INSERT INTO invites (workspace_id, code_hash, created_by, expires_at) VALUES ($1, $2, $3, $4)', [
    req.user!.workspaceId,
    sha256(code),
    req.user!.id,
    expires,
  ])
  await logActivity({ workspaceId: req.user!.workspaceId, userId: req.user!.id, action: 'invite.created' })
  // The plain code is shown once and never stored.
  res.json({ code, expiresAt: expires })
})
