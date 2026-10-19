import { q } from './db'

export interface ActivityInput {
  workspaceId: string
  userId?: string | null
  action: string
  creativeId?: string | null
  productId?: string | null
  brandId?: string | null
  details?: Record<string, unknown>
}

/** Logs meaningful actions (create, change, approve, status, accepted AI actions). Not keystrokes. */
export async function logActivity(a: ActivityInput) {
  await q(
    `INSERT INTO activity (workspace_id, user_id, action, creative_id, product_id, brand_id, details)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [a.workspaceId, a.userId ?? null, a.action, a.creativeId ?? null, a.productId ?? null, a.brandId ?? null, a.details ?? {}],
  )
}
