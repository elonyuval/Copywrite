import pg from 'pg'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { config } from './config'

export const pool = new pg.Pool({
  connectionString: config.databaseUrl,
  max: 10,
  ssl: /sslmode=require|neon\.tech|supabase\.co/.test(config.databaseUrl) ? { rejectUnauthorized: false } : undefined,
})

export async function q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  const res = await pool.query(text, params as any[])
  return res.rows as T[]
}

export async function one<T = any>(text: string, params: unknown[] = []): Promise<T | undefined> {
  const rows = await q<T>(text, params)
  return rows[0]
}

export async function tx<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const out = await fn(client)
    await client.query('COMMIT')
    return out
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {})
    throw e
  } finally {
    client.release()
  }
}

function migrationsDir() {
  // Works both from source (server/) and from the bundled dist/server.js.
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [path.join(here, 'migrations'), path.join(here, '..', 'server', 'migrations')]
  return candidates
}

export async function migrate() {
  await q(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`)
  let dir = ''
  for (const c of migrationsDir()) {
    try {
      await readdir(c)
      dir = c
      break
    } catch {}
  }
  if (!dir) throw new Error('migrations directory not found')
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()
  const applied = new Set((await q<{ name: string }>('SELECT name FROM schema_migrations')).map((r) => r.name))
  for (const f of files) {
    if (applied.has(f)) continue
    const sql = await readFile(path.join(dir, f), 'utf8')
    await tx(async (c) => {
      await c.query(sql)
      await c.query('INSERT INTO schema_migrations(name) VALUES ($1)', [f])
    })
    console.log(`[db] applied migration ${f}`)
  }
}
