import { createHash, randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { NextFunction, Request, Response } from 'express'
import { config } from './config'
import { one, q } from './db'
import { HttpError } from './errors'

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>

export const SESSION_COOKIE = 'cw_session'

export interface AuthUser {
  id: string
  email: string
  name: string
  color: string
  workspaceId: string
  role: 'owner' | 'member'
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser
    }
  }
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scrypt(pw, salt, 64)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export async function verifyPassword(pw: string, stored: string): Promise<boolean> {
  const [algo, saltB64, hashB64] = stored.split('$')
  if (algo !== 'scrypt') return false
  const expected = Buffer.from(hashB64, 'base64')
  const actual = await scrypt(pw, Buffer.from(saltB64, 'base64'), expected.length)
  return timingSafeEqual(expected, actual)
}

export const sha256 = (s: string) => createHash('sha256').update(config.sessionSecret).update(s).digest('hex')
export const randomToken = (bytes = 32) => randomBytes(bytes).toString('base64url')

export async function createSession(res: Response, userId: string) {
  const token = randomToken()
  const expires = new Date(Date.now() + config.sessionDays * 86400_000)
  await q('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)', [sha256(token), userId, expires])
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProd,
    expires,
    path: '/',
  })
}

export async function destroySession(req: Request, res: Response) {
  const token = req.cookies?.[SESSION_COOKIE]
  if (token) await q('DELETE FROM sessions WHERE token_hash = $1', [sha256(token)])
  res.clearCookie(SESSION_COOKIE, { path: '/' })
}

/** Resolves a session token to the user and their workspace membership. */
export async function userFromToken(token: string | undefined): Promise<AuthUser | null> {
  if (!token) return null
  const row = await one<any>(
    `SELECT u.id, u.email, u.name, u.color, m.workspace_id, m.role
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN memberships m ON m.user_id = u.id
      WHERE s.token_hash = $1 AND s.expires_at > now()
      ORDER BY m.created_at LIMIT 1`,
    [sha256(token)],
  )
  if (!row) return null
  return { id: row.id, email: row.email, name: row.name, color: row.color, workspaceId: row.workspace_id, role: row.role }
}

export function parseCookieHeader(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!header) return out
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i === -1) continue
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const user = await userFromToken(req.cookies?.[SESSION_COOKIE])
    if (!user) throw new HttpError(401, 'יש להתחבר מחדש', 'unauthenticated')
    req.user = user
    next()
  } catch (e) {
    next(e)
  }
}

/**
 * Same-origin check for state-changing requests and websocket upgrades.
 * Cookies are SameSite=Lax; this is an extra layer against cross-site requests.
 */
export function originAllowed(origin: string | null | undefined, host: string | null | undefined): boolean {
  if (!origin) return true // non-browser clients (no cookies sent cross-site anyway)
  try {
    const o = new URL(origin)
    if (host && o.host === host) return true
    if (config.publicUrl && o.origin === new URL(config.publicUrl).origin) return true
    if (!config.isProd && (o.hostname === 'localhost' || o.hostname === '127.0.0.1')) return true
  } catch {}
  return false
}
