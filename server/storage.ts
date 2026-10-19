// File storage. Files are written to UPLOAD_DIR (use a persistent volume in production) and only
// ever served through an authenticated route that checks workspace membership.
// To move to S3/R2 later, implement the same three functions against the bucket.
import { createReadStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { config } from './config'

const root = () => path.resolve(config.uploadDir)

export async function ensureStorage() {
  await mkdir(path.join(root(), 'tmp'), { recursive: true })
}

export const tmpDir = () => path.join(root(), 'tmp')

/** Moves an uploaded temp file into permanent storage; returns its storage key. */
export async function storeUploadedFile(tmpPath: string, workspaceId: string): Promise<string> {
  const key = `${workspaceId}/${randomUUID()}`
  const dest = path.join(root(), key)
  await mkdir(path.dirname(dest), { recursive: true })
  await rename(tmpPath, dest)
  return key
}

function safePath(key: string) {
  const p = path.resolve(root(), key)
  if (!p.startsWith(root() + path.sep)) throw new Error('bad storage key')
  return p
}

export async function openFile(key: string) {
  const p = safePath(key)
  const s = await stat(p)
  return { stream: createReadStream(p), size: s.size }
}

export async function deleteFile(key: string) {
  await rm(safePath(key), { force: true })
}
