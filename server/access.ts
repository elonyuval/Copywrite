// Every lookup is scoped to the caller's workspace; anything outside it is reported as "not found".
import type { AuthUser } from './auth'
import { one } from './db'
import { notFound } from './errors'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const checkId = (id: string, what: string) => {
  if (!UUID.test(id)) throw notFound(what)
}

export async function getBrand(user: Pick<AuthUser, 'workspaceId'>, id: string) {
  checkId(id, 'המותג')
  const b = await one('SELECT * FROM brands WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL', [id, user.workspaceId])
  if (!b) throw notFound('המותג')
  return b
}

export async function getProduct(user: Pick<AuthUser, 'workspaceId'>, id: string) {
  checkId(id, 'המוצר')
  const p = await one('SELECT * FROM products WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL', [id, user.workspaceId])
  if (!p) throw notFound('המוצר')
  return p
}

export async function getCreative(user: Pick<AuthUser, 'workspaceId'>, id: string) {
  checkId(id, 'הקריאייטיב')
  const c = await one('SELECT * FROM creatives WHERE id = $1 AND workspace_id = $2 AND archived_at IS NULL', [id, user.workspaceId])
  if (!c) throw notFound('הקריאייטיב')
  return c
}

export { checkId }
