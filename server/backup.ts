// Application-level backups: a .tar.gz with every table as JSON (backup.json) and, optionally, all
// uploaded files (uploads/...). Independent of the Postgres version, restorable with
// `npm run restore` (server/restore.ts) into an empty database.
//
// Nightly: a database-only archive is written to BACKUP_DIR (on the persistent disk), keeping the
// last BACKUP_KEEP. Full archives (with files) are created on demand from Settings for off-site copies.
import { mkdir, readdir, rename, rm, stat, symlink, writeFile } from 'node:fs/promises'
import { mkdtempSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as tar from 'tar'
import { config } from './config'
import { q } from './db'

/** Tables in foreign-key order. Sessions are deliberately excluded (everyone logs in again after a restore). */
export const BACKUP_TABLES = [
  'workspaces',
  'users',
  'memberships',
  'invites',
  'files',
  'brands',
  'products',
  'creatives',
  'creative_docs',
  'creative_versions',
  'approvals',
  'comments',
  'assets',
  'ai_threads',
  'ai_messages',
  'ai_suggestions',
  'ai_checks',
  'preferences',
  'activity',
  'api_tokens',
  'creative_visits',
] as const

export const BACKUP_FORMAT = 1
const NAME_RE = /^(db|full)-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z\.tar\.gz$/

export const backupDir = () => path.resolve(config.backupDir)

function encode(value: unknown): unknown {
  if (Buffer.isBuffer(value)) return { $b64: value.toString('base64') }
  return value
}

export async function exportDatabase() {
  const migrations = (await q<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name')).map((r) => r.name)
  const tables: Record<string, Record<string, unknown>[]> = {}
  for (const t of BACKUP_TABLES) {
    const rows = await q(`SELECT * FROM ${t}`)
    tables[t] = rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, encode(v)])))
  }
  return { format: BACKUP_FORMAT, createdAt: new Date().toISOString(), migrations, tables }
}

/** Writes a backup archive into BACKUP_DIR and returns its file name. */
export async function createBackup(kind: 'db' | 'full'): Promise<{ name: string; size: number }> {
  await mkdir(backupDir(), { recursive: true })
  const stamp = new Date().toISOString().replace(/\.\d+Z$/, 'Z').replace(/:/g, '-')
  const name = `${kind}-${stamp}.tar.gz`
  const work = mkdtempSync(path.join(os.tmpdir(), 'cw-backup-'))
  try {
    const data = await exportDatabase()
    await writeFile(path.join(work, 'backup.json'), JSON.stringify(data))
    const entries = ['backup.json']
    if (kind === 'full') {
      await mkdir(path.resolve(config.uploadDir), { recursive: true })
      await symlink(path.resolve(config.uploadDir), path.join(work, 'uploads'))
      entries.push('uploads')
    }
    const target = path.join(backupDir(), name)
    await tar.c(
      {
        gzip: true,
        file: `${target}.partial`,
        cwd: work,
        follow: true,
        // Skip in-progress uploads.
        filter: (p) => !p.startsWith('uploads/tmp'),
      },
      entries,
    )
    await rename(`${target}.partial`, target)
    const { size } = await stat(target)
    return { name, size }
  } finally {
    await rm(work, { recursive: true, force: true })
  }
}

export async function listBackups() {
  try {
    const names = (await readdir(backupDir())).filter((n) => NAME_RE.test(n))
    const out = await Promise.all(
      names.map(async (name) => {
        const s = await stat(path.join(backupDir(), name))
        return { name, size: s.size, createdAt: s.mtime.toISOString(), kind: name.startsWith('full') ? 'full' : 'db' }
      }),
    )
    return out.sort((a, b) => b.name.localeCompare(a.name))
  } catch {
    return []
  }
}

export function backupPath(name: string): string | null {
  if (!NAME_RE.test(name)) return null
  return path.join(backupDir(), name)
}

/** Keeps the newest `keep` archives of each kind. */
export async function pruneBackups(keepDb: number, keepFull: number) {
  const all = await listBackups()
  const drop = [...all.filter((b) => b.kind === 'db').slice(keepDb), ...all.filter((b) => b.kind === 'full').slice(keepFull)]
  for (const b of drop) await rm(path.join(backupDir(), b.name), { force: true })
}

export const backupStatus = { lastSuccessAt: null as string | null, lastError: null as string | null, lastErrorAt: null as string | null }

/** Daily database backup at ~01:00 UTC (≈ 03:00–04:00 Israel time). */
export function startBackupSchedule() {
  if (!config.backupEnabled) return
  const tick = async () => {
    const now = new Date()
    if (now.getUTCHours() < 1) return
    const today = now.toISOString().slice(0, 10)
    const existing = await listBackups()
    if (existing.some((b) => b.kind === 'db' && b.name.startsWith(`db-${today}`))) return
    try {
      const b = await createBackup('db')
      await pruneBackups(config.backupKeep, 3)
      backupStatus.lastSuccessAt = new Date().toISOString()
      console.log(`[backup] created ${b.name} (${b.size} bytes)`)
    } catch (e) {
      backupStatus.lastError = e instanceof Error ? e.message : String(e)
      backupStatus.lastErrorAt = new Date().toISOString()
      console.error('[backup] failed', e)
    }
  }
  setTimeout(tick, 60_000).unref()
  setInterval(tick, 30 * 60_000).unref()
}
