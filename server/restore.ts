// Restores a backup archive created by server/backup.ts.
//
//   npm run restore -- <archive.tar.gz> [--files] [--force]
//
// - Restores the database into the database at DATABASE_URL. It must be empty (no users) unless --force,
//   in which case ALL existing application data there is deleted first.
// - --files also copies uploaded files into UPLOAD_DIR (only "full-…" archives contain files).
// - Sessions are not part of backups: everyone logs in again afterwards.
import { cp, mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as tar from 'tar'
import { BACKUP_FORMAT, BACKUP_TABLES } from './backup'
import { config } from './config'
import { migrate, pool, tx } from './db'

const args = process.argv.slice(2)
const archive = args.find((a) => !a.startsWith('--'))
const withFiles = args.includes('--files')
const force = args.includes('--force')

function decode(v: unknown): unknown {
  if (v && typeof v === 'object' && '$b64' in (v as any)) return Buffer.from((v as any).$b64, 'base64')
  return v
}

async function main() {
  if (!archive) throw new Error('usage: npm run restore -- <archive.tar.gz> [--files] [--force]')
  const work = await mkdtemp(path.join(os.tmpdir(), 'cw-restore-'))
  try {
    await tar.x({ file: archive, cwd: work })
    const data = JSON.parse(await readFile(path.join(work, 'backup.json'), 'utf8'))
    if (data.format !== BACKUP_FORMAT) throw new Error(`unsupported backup format ${data.format}`)
    await migrate()
    const known = (await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name)
    const missing = (data.migrations as string[]).filter((m) => !known.includes(m))
    if (missing.length) throw new Error(`backup is from a newer version (missing migrations: ${missing.join(', ')}). Deploy that version first.`)

    const users = (await pool.query('SELECT count(*)::int AS n FROM users')).rows[0].n
    if (users > 0 && !force) throw new Error('target database is not empty. Re-run with --force to replace ALL its data.')

    await tx(async (c) => {
      if (force) await c.query(`TRUNCATE ${[...BACKUP_TABLES, 'sessions'].join(', ')} RESTART IDENTITY CASCADE`)
      for (const table of BACKUP_TABLES) {
        const rows: Record<string, unknown>[] = data.tables[table] ?? []
        for (const raw of rows) {
          const row = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, decode(v)]))
          // Creatives can reference other creatives; link them in a second pass.
          if (table === 'creatives') row.source_creative_id = null
          const cols = Object.keys(row)
          const values = cols.map((k) => {
            const v = row[k]
            return v !== null && typeof v === 'object' && !Buffer.isBuffer(v) && !(v instanceof Date) && !Array.isArray(v) ? JSON.stringify(v) : v
          })
          await c.query(
            `INSERT INTO ${table} (${cols.map((k) => `"${k}"`).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})`,
            values,
          )
        }
        if (table === 'creatives') {
          for (const raw of rows) {
            if (raw.source_creative_id) await c.query('UPDATE creatives SET source_creative_id = $2 WHERE id = $1', [raw.id, raw.source_creative_id])
          }
        }
        console.log(`[restore] ${table}: ${rows.length}`)
      }
      await c.query(`SELECT setval(pg_get_serial_sequence('activity', 'id'), GREATEST((SELECT max(id) FROM activity), 1))`)
    })

    if (withFiles) {
      const src = path.join(work, 'uploads')
      const exists = await stat(src).then(() => true, () => false)
      if (!exists) console.log('[restore] this archive has no files (db-only backup). Files were not changed.')
      else {
        await cp(src, path.resolve(config.uploadDir), { recursive: true, force: true })
        console.log(`[restore] files copied to ${path.resolve(config.uploadDir)}`)
      }
    }
    console.log(`[restore] done. Backup created at ${data.createdAt}.`)
  } finally {
    await rm(work, { recursive: true, force: true })
    await pool.end()
  }
}

main().catch((e) => {
  console.error(`[restore] FAILED: ${e.message}`)
  process.exit(1)
})
