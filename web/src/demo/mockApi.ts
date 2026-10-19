// Demo-only: answers the app's /api requests inside the browser, mirroring the real server's
// behaviour (including the safety rules: stale AI suggestions are refused, short versions create a
// new linked creative, product saves detect conflicts). AI replies are canned and labelled as a demo.
import * as Y from 'yjs'
import { countWords } from '../../../shared/readingTime'
import {
  addHook, addResearchItem, combinedScript, copyScript, fragmentToText, hookFragment, hooksMap, scriptSnapshot, setFragmentText,
} from '../../../shared/script'
import { addUploadedFile, db, hashOf, log, ME, newCreative, now, PARTNER, saveVersion, serverDoc, uid, USERS } from './store'

const DEMO = '[הדגמה — לא תשובת AI אמיתית]'
class Res {
  constructor(public status: number, public data: unknown) {}
}
const ok = (data: unknown, status = 200) => new Res(status, data)
const fail = (status: number, error: string, extra: Record<string, unknown> = {}) => new Res(status, { error, ...extra })
const live = <T extends { archived_at?: string | null }>(rows: T[]) => rows.filter((r) => !r.archived_at)
const by = (id: string) => USERS[id] ?? { name: 'מערכת', color: '#a8a29e' }
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function brandOf(productId: string) {
  const p = db.products.find((x) => x.id === productId)
  return { p, b: db.brands.find((x) => x.id === p?.brand_id) }
}
function creativeRow(c: any) {
  const { p, b } = brandOf(c.product_id)
  return { ...c, product_name: p?.name, brand_name: b?.name, created_by_name: by(c.created_by).name }
}
const isLive = (c: any) => {
  const { p, b } = brandOf(c.product_id)
  return c && !c.archived_at && p && !p.archived_at && b && !b.archived_at
}

type Handler = (m: RegExpMatchArray, body: any, query: URLSearchParams) => Res | Promise<Res>
const routes: [string, RegExp, Handler][] = []
const route = (method: string, path: string, h: Handler) => routes.push([method, new RegExp(`^${path.replace(/:\w+/g, '([^/]+)')}$`), h])

// ---------- auth / workspace ----------
route('GET', '/me', () => ok({ user: ME, workspace: { id: 'ws', name: 'סביבת הדגמה' }, aiConfigured: true, aiModel: 'הדגמה (AI מדומה)' }))
route('GET', '/auth/state', () => ok({ setupRequired: false, setupTokenRequired: false }))
route('POST', '/auth/logout', () => ok({ ok: true }))
route('PATCH', '/me', (_m, b) => {
  if (b.name) ME.name = b.name
  if (b.color) ME.color = b.color
  return ok({ ok: true })
})
route('GET', '/workspace/members', () => ok([{ ...ME, role: 'owner' }, { ...PARTNER, role: 'member' }]))
route('POST', '/workspace/invites', () => ok({ code: 'DEMO-INVITE', expiresAt: new Date(Date.now() + 7 * 864e5).toISOString() }))
route('DELETE', '/workspace/members/:id', () => fail(400, 'בהדגמה אי אפשר להסיר משתמשים'))
route('GET', '/api-tokens', () => ok([]))
route('POST', '/api-tokens', () => ok({ token: 'cw_demo_token_not_real' }))
route('GET', '/backups', () => ok({ enabled: true, keep: 14, status: {}, backups: [] }))
route('POST', '/backups', () => fail(400, 'בהדגמה אין גיבויים — הנתונים כאן לא נשמרים בכלל'))
route('POST', '/ai/check', async () => {
  await sleep(500)
  return ok({ model: 'הדגמה', ms: 500, sample: `${DEMO} החיבור עובד.`, hebrew: true })
})

// ---------- home & search ----------
route('GET', '/home', () => {
  const brands = live(db.brands)
    .map((b) => {
      const products = live(db.products).filter((p) => p.brand_id === b.id)
      const creative_count = db.creatives.filter((c) => isLive(c) && products.some((p) => p.id === c.product_id)).length
      return { id: b.id, name: b.name, logo_file_id: b.logo_file_id, product_count: products.length, creative_count }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
  const recent = db.creatives.filter(isLive).sort((a, b) => b.content_updated_at.localeCompare(a.content_updated_at)).slice(0, 12).map(creativeRow)
  const cont = [...db.visits.entries()]
    .map(([id, visited_at]) => ({ c: db.creatives.find((x) => x.id === id), visited_at }))
    .filter((x) => x.c && isLive(x.c))
    .sort((a, b) => b.visited_at.localeCompare(a.visited_at))
    .slice(0, 5)
    .map((x) => ({ ...creativeRow(x.c), visited_at: x.visited_at }))
  return ok({ brands, recent, continue: cont })
})
route('GET', '/search', (_m, _b, q) => {
  const t = (q.get('q') ?? '').trim().toLowerCase()
  if (!t) return ok({ brands: [], products: [], creatives: [] })
  const has = (s: string) => (s ?? '').toLowerCase().includes(t)
  return ok({
    brands: live(db.brands).filter((b) => has(b.name)),
    products: live(db.products).filter((p) => has(p.name)).map((p) => ({ ...p, brand_name: brandOf(p.id).b?.name })),
    creatives: db.creatives.filter((c) => isLive(c) && [c.name, c.angle, c.plain_text, creativeRow(c).product_name, creativeRow(c).brand_name].some(has)).map(creativeRow),
  })
})

// ---------- brands & products ----------
route('POST', '/brands', (_m, b) => {
  if (!b.name?.trim()) return fail(400, 'יש להזין שם')
  const row = { id: uid('b'), workspace_id: 'ws', name: b.name.trim(), logo_file_id: b.logoFileId ?? null, created_at: now(), updated_at: now(), archived_at: null }
  db.brands.push(row)
  return ok(row, 201)
})
route('GET', '/brands/:id', (m) => {
  const brand = db.brands.find((b) => b.id === m[1] && !b.archived_at)
  if (!brand) return fail(404, 'המותג לא נמצא')
  const products = live(db.products)
    .filter((p) => p.brand_id === brand.id)
    .map((p) => ({ ...p, creative_count: live(db.creatives).filter((c) => c.product_id === p.id).length }))
  return ok({ brand, products })
})
route('PATCH', '/brands/:id', (m, b) => {
  const brand = db.brands.find((x) => x.id === m[1])
  if (!brand) return fail(404, 'המותג לא נמצא')
  if (b.name) brand.name = b.name
  if (b.logoFileId !== undefined) brand.logo_file_id = b.logoFileId
  return ok(brand)
})
route('POST', '/brands/:id/products', (m, b) => {
  if (!b.name?.trim()) return fail(400, 'יש להזין שם')
  const row = { id: uid('p'), workspace_id: 'ws', brand_id: m[1], name: b.name.trim(), description: b.description ?? '', image_file_id: b.imageFileId ?? null, dossier: {}, revision: 1, created_at: now(), updated_at: now(), archived_at: null }
  db.products.push(row)
  return ok(row, 201)
})
route('GET', '/products/:id', (m) => {
  const product = db.products.find((p) => p.id === m[1] && !p.archived_at)
  if (!product) return fail(404, 'המוצר לא נמצא')
  const brand = db.brands.find((b) => b.id === product.brand_id)
  const creatives = live(db.creatives).filter((c) => c.product_id === product.id).sort((a, b) => b.content_updated_at.localeCompare(a.content_updated_at)).map(creativeRow)
  return ok({ product, brand, creatives })
})
route('PATCH', '/products/:id', (m, b) => {
  const p = db.products.find((x) => x.id === m[1])
  if (!p) return fail(404, 'המוצר לא נמצא')
  if (b.revision !== p.revision) return fail(409, 'המוצר עודכן בינתיים על ידי משתמש אחר.', { code: 'conflict', current: p })
  if (b.name !== undefined) p.name = b.name
  if (b.description !== undefined) p.description = b.description
  if (b.imageFileId !== undefined) p.image_file_id = b.imageFileId
  if (b.dossier) p.dossier = { ...p.dossier, ...b.dossier }
  p.revision++
  p.updated_at = now()
  return ok({ ...p })
})

// ---------- creatives ----------
route('POST', '/products/:id/creatives', (m, b) => {
  if (!b.name?.trim()) return fail(400, 'יש להזין שם')
  const c = newCreative({ product_id: m[1], name: b.name.trim(), angle: b.angle ?? '' })
  log(c.id, 'creative.created', { name: c.name })
  return ok(c, 201)
})
route('GET', '/creatives/:id', (m) => {
  const c = db.creatives.find((x) => x.id === m[1] && !x.archived_at)
  if (!c) return fail(404, 'הקריאייטיב לא נמצא')
  const { p, b } = brandOf(c.product_id)
  db.visits.set(c.id, now())
  const source = c.source_creative_id ? db.creatives.find((x) => x.id === c.source_creative_id) : null
  return ok({
    creative: c,
    product: { id: p.id, name: p.name, brand_id: b.id, brand_name: b.name },
    source: source ? { id: source.id, name: source.name } : null,
    approver: c.approved_by ? { id: c.approved_by, name: by(c.approved_by).name } : null,
    derived: live(db.creatives).filter((x) => x.source_creative_id === c.id).map((x) => ({ id: x.id, name: x.name, source_kind: x.source_kind, status: x.status })),
  })
})
route('PATCH', '/creatives/:id', (m, b) => {
  const c = db.creatives.find((x) => x.id === m[1])
  if (!c) return fail(404, 'הקריאייטיב לא נמצא')
  if (b.status && b.status !== c.status) log(c.id, 'creative.status', { from: c.status, to: b.status })
  if (b.name) c.name = b.name
  if (b.angle !== undefined) c.angle = b.angle
  if (b.status) c.status = b.status
  c.updated_at = now()
  return ok(c)
})
route('DELETE', '/creatives/:id', (m) => {
  const c = db.creatives.find((x) => x.id === m[1])
  if (c) c.archived_at = now()
  return ok({ ok: true })
})
route('POST', '/creatives/:id/duplicate', (m) => {
  const src = db.creatives.find((x) => x.id === m[1])
  const doc = new Y.Doc()
  copyScript(serverDoc(src.id), doc, { includeResearch: true })
  const c = newCreative({ product_id: src.product_id, name: `${src.name} (עותק)`, angle: src.angle, source_creative_id: src.id, source_kind: 'duplicate' }, undefined, doc)
  log(c.id, 'creative.duplicated', { sourceName: src.name })
  return ok(c, 201)
})
route('GET', '/creatives/:id/activity', (m) =>
  ok(db.activity.filter((a) => a.creative_id === m[1]).map((a) => ({ ...a, user_name: by(a.user_id).name, user_color: by(a.user_id).color }))),
)

// ---------- versions & approval ----------
route('GET', '/creatives/:id/versions', (m) => {
  const c = db.creatives.find((x) => x.id === m[1])
  return ok(db.versions.filter((v) => v.creative_id === m[1]).map((v) => ({ ...v, state: undefined, user_name: by(v.created_by).name, is_approved: v.id === c?.approved_version_id })))
})
route('GET', '/versions/:id', (m) => {
  const v = db.versions.find((x) => x.id === m[1])
  return v ? ok({ ...v, state: undefined, user_name: by(v.created_by).name }) : fail(404, 'הגרסה לא נמצאה')
})
route('POST', '/creatives/:id/versions', (m, b) => {
  const v = saveVersion(m[1], 'manual', b.label || null)
  log(m[1], 'version.saved', { label: b.label })
  return ok({ id: v.id }, 201)
})
route('POST', '/creatives/:id/versions/:vid/restore', (m) => {
  const v = db.versions.find((x) => x.id === m[2])
  if (!v) return fail(404, 'הגרסה לא נמצאה')
  saveVersion(m[1], 'pre_restore', 'לפני שחזור')
  const old = new Y.Doc()
  Y.applyUpdate(old, v.state)
  copyScript(old, serverDoc(m[1]))
  log(m[1], 'version.restored', { versionDate: v.created_at })
  return ok({ ok: true })
})
route('POST', '/creatives/:id/approve', (m) => {
  const c = db.creatives.find((x) => x.id === m[1])
  const v = saveVersion(c.id, 'approval', 'גרסה שאושרה')
  Object.assign(c, { approved_version_id: v.id, approved_hash: v.content_hash, content_hash: v.content_hash, approved_by: ME.id, approved_at: now(), needs_review: false })
  log(c.id, 'creative.approved')
  return ok(c)
})
route('DELETE', '/creatives/:id/approve', (m) => {
  const c = db.creatives.find((x) => x.id === m[1])
  Object.assign(c, { approved_version_id: null, approved_hash: null, approved_by: null, approved_at: null, needs_review: false })
  log(c.id, 'creative.approval_revoked')
  return ok(c)
})

// ---------- comments, files, assets ----------
route('GET', '/creatives/:id/comments', (m) =>
  ok(db.comments.filter((c) => c.creative_id === m[1] && !c.deleted_at).map((c) => ({ ...c, user_name: by(c.user_id).name, user_color: by(c.user_id).color }))),
)
route('POST', '/creatives/:id/comments', (m, b) => {
  if (!b.body?.trim()) return fail(400, 'התגובה ריקה')
  const row = { id: uid('cm'), creative_id: m[1], user_id: ME.id, body: b.body.trim(), created_at: now() }
  db.comments.push(row)
  log(m[1], 'comment.added')
  return ok(row, 201)
})
route('DELETE', '/comments/:id', (m) => {
  const c = db.comments.find((x) => x.id === m[1])
  if (c) c.deleted_at = now()
  return ok({ ok: true })
})
route('POST', '/files', (_m, form: FormData) => {
  const f = form.get('file') as File | null
  return f ? ok(addUploadedFile(f), 201) : fail(400, 'לא נבחר קובץ')
})
route('GET', '/creatives/:id/assets', (m) =>
  ok(
    db.assets
      .filter((a) => a.creative_id === m[1] && !a.deleted_at)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((a) => {
        const f = a.file_id ? db.files.get(a.file_id) : null
        return { ...a, user_name: by(a.created_by).name, original_name: f?.name, mime: f?.mime, size: f?.size }
      }),
  ),
)
route('POST', '/creatives/:id/assets/file', (m, form: FormData) => {
  const f = form.get('file') as File | null
  if (!f) return fail(400, 'לא נבחר קובץ')
  const file = addUploadedFile(f)
  const row = { id: uid('as'), creative_id: m[1], kind: 'file', name: (form.get('name') as string) || f.name, description: (form.get('description') as string) ?? '', file_id: file.id, url: null, created_by: ME.id, created_at: now() }
  db.assets.push(row)
  log(m[1], 'asset.added', { kind: 'file', name: row.name })
  return ok(row, 201)
})
route('POST', '/creatives/:id/assets/link', (m, b) => {
  if (!/^https?:\/\//i.test(b.url ?? '')) return fail(400, 'הקישור חייב להתחיל ב-http או https')
  if (!b.name?.trim()) return fail(400, 'יש להזין שם')
  const row = { id: uid('as'), creative_id: m[1], kind: 'link', name: b.name, description: b.description ?? '', url: b.url, file_id: null, created_by: ME.id, created_at: now() }
  db.assets.push(row)
  log(m[1], 'asset.added', { kind: 'link', name: b.name })
  return ok(row, 201)
})
route('DELETE', '/assets/:id', (m) => {
  const a = db.assets.find((x) => x.id === m[1])
  if (a) {
    a.deleted_at = now()
    log(a.creative_id, 'asset.removed', { name: a.name })
  }
  return ok({ ok: true })
})

// ---------- preferences ----------
const prefRow = (p: any) => ({ ...p, brand_name: db.brands.find((b) => b.id === p.brand_id)?.name ?? null, created_by_name: by(p.created_by).name })
route('GET', '/preferences', () => ok(db.preferences.map(prefRow)))
route('POST', '/preferences', (_m, b) => {
  const row = { id: uid('pr'), workspace_id: 'ws', brand_id: b.brandId ?? null, category: b.category, title: b.title, content: b.content, active: b.active ?? true, created_by: ME.id, created_at: now(), updated_at: now() }
  db.preferences.push(row)
  return ok(row, 201)
})
route('PUT', '/preferences/:id', (m, b) => {
  const p = db.preferences.find((x) => x.id === m[1])
  Object.assign(p, { category: b.category, title: b.title, content: b.content, brand_id: b.brandId ?? null, active: b.active ?? p.active, updated_at: now() })
  return ok(p)
})
route('DELETE', '/preferences/:id', (m) => {
  db.preferences = db.preferences.filter((p) => p.id !== m[1])
  return ok({ ok: true })
})

// ---------- AI (canned demo answers, clearly labelled) ----------
const msgRow = (x: any) => ({ ...x, user_name: x.user_id ? by(x.user_id).name : null, user_color: x.user_id ? by(x.user_id).color : null })
route('GET', '/creatives/:id/ai/:kind', (m) => ok({ messages: db.messages.filter((x) => x.creative_id === m[1] && x.kind === m[2]).map(msgRow) }))
route('POST', '/creatives/:id/ai/:kind', async (m, b) => {
  const [, creativeId, kind] = m
  if (!b.message?.trim()) return fail(400, 'ההודעה ריקה')
  db.messages.push({ id: uid('m'), creative_id: creativeId, kind, role: 'user', user_id: ME.id, content: b.message, created_at: now() })
  await sleep(900)
  const c = db.creatives.find((x) => x.id === creativeId)
  const product = brandOf(c.product_id).p
  if (kind === 'research') {
    const updates = [
      { section: 'audience', text: b.message.slice(0, 200), provenance: 'user', source: '' },
      { section: 'objections', text: `חשש שהמחיר של ${product.name} לא מצדיק את התוצאה`, provenance: 'hypothesis', source: '' },
      { section: 'language', text: '"כבר ניסיתי הכול ושום דבר לא עבד"', provenance: 'ai_example', source: '' },
      { section: 'open_questions', text: 'מה הן הכי מפחדות שיחשבו עליהן?', provenance: 'hypothesis', source: '' },
    ].map((u, index) => ({ ...u, index, applied: false }))
    const msg = { id: uid('m'), creative_id: creativeId, kind, role: 'assistant', content: `${DEMO} הבנתי. שתי שאלות כדי לדייק: מה הן כבר ניסו ולמה זה לא עבד? ומה הרגע ביום שבו הבעיה הכי מורגשת?`, payload: { updates, suggested_angle: c.angle || 'התוצאה שרואים בלי להשקיע זמן' }, created_at: now() }
    db.messages.push(msg)
    return ok({ message: msg })
  }
  const snap = scriptSnapshot(serverDoc(creativeId))
  const msg = { id: uid('m'), creative_id: creativeId, kind, role: 'assistant', content: `${DEMO} הנה שתי הצעות להוקים והצעה לקריאה לפעולה. שום דבר לא ישתנה עד שתאשרו.`, payload: {}, created_at: now() }
  db.messages.push(msg)
  const suggestions = [
    { kind: 'new_hook', target: null, base_text: null, text: `הדבר שאף אחד לא סיפר לי על ${product.name}.`, reason: 'פותח לופ: מה לא סיפרו?' },
    { kind: 'new_hook', target: null, base_text: null, text: 'שלושה ילדים, ארבע שעות שינה — ואף אחד לא שאל אותי אם אני עייפה.', reason: 'סתירה שמעוררת סקרנות.' },
    { kind: 'rewrite', target: 'cta', base_text: snap.cta, text: `${(snap.cta || 'הקישור למטה').replace(/[.!]+$/, '')} — רק עד סוף החודש.`, reason: 'מוסיף דחיפות שמופיעה בתיק המוצר.' },
  ].map((s) => ({ ...s, id: uid('s'), creative_id: creativeId, message_id: msg.id, origin: 'chat', status: 'pending', created_at: now() }))
  db.suggestions.unshift(...suggestions)
  return ok({ message: msg, suggestions })
})
route('POST', '/ai/messages/:id/research-applied', (m, b) => {
  const msg = db.messages.find((x) => x.id === m[1])
  for (const i of b.indexes ?? []) if (msg?.payload?.updates?.[i]) msg.payload.updates[i].applied = true
  if (msg) log(msg.creative_id, 'ai.research_applied', { count: b.indexes.length })
  return ok({ ok: true, payload: msg?.payload })
})
route('POST', '/creatives/:id/research-items', (m, b) => {
  const doc = serverDoc(m[1])
  for (const it of b.items) addResearchItem(doc, it.section, it)
  return ok({ ok: true })
})
route('GET', '/creatives/:id/suggestions', (m) => ok(db.suggestions.filter((s) => s.creative_id === m[1]).map((s) => ({ ...s, resolved_by_name: s.resolved_by ? by(s.resolved_by).name : null }))))

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
function pendingSuggestion(id: string) {
  const s = db.suggestions.find((x) => x.id === id)
  if (!s) return { error: fail(404, 'ההצעה לא נמצאה') }
  if (s.status !== 'pending') return { error: fail(409, 'ההצעה כבר טופלה') }
  return { s }
}
route('POST', '/suggestions/:id/apply', (m) => {
  const { s, error } = pendingSuggestion(m[1])
  if (error) return error
  const doc = serverDoc(s.creative_id)
  let frag: Y.XmlFragment | null = null
  if (s.target.startsWith('hook:')) {
    const id = s.target.slice(5)
    const meta = hooksMap(doc).get(id)
    frag = meta && !meta.get('deleted') ? hookFragment(doc, id) : null
  } else frag = doc.getXmlFragment(s.target)
  if (!frag) return fail(409, 'החלק שאליו ההצעה מתייחסת כבר לא קיים.', { code: 'missing' })
  if (norm(fragmentToText(frag)) !== norm(s.base_text ?? ''))
    return fail(409, 'הטקסט השתנה מאז שההצעה נוצרה, ולכן היא לא הוחלה. אפשר להעתיק אותה או לבקש הצעה חדשה.', { code: 'stale' })
  saveVersion(s.creative_id, 'ai_applied', 'לפני החלת הצעת AI')
  doc.transact(() => setFragmentText(frag!, s.text))
  Object.assign(s, { status: 'applied', resolved_by: ME.id, resolved_at: now() })
  log(s.creative_id, 'ai.suggestion_applied')
  return ok({ ok: true })
})
route('POST', '/suggestions/:id/add-as-hook', (m, b) => {
  const { s, error } = pendingSuggestion(m[1])
  if (error) return error
  addHook(serverDoc(s.creative_id), { text: s.text, afterId: b.afterHookId ?? undefined, createdBy: ME.id })
  Object.assign(s, { status: 'added_as_hook', resolved_by: ME.id, resolved_at: now() })
  log(s.creative_id, 'ai.hook_added')
  return ok({ ok: true })
})
route('POST', '/suggestions/:id/reject', (m) => {
  const { s, error } = pendingSuggestion(m[1])
  if (error) return error
  Object.assign(s, { status: 'rejected', resolved_by: ME.id, resolved_at: now() })
  return ok({ ok: true })
})
const lastReview = new Map<string, string>()
route('POST', '/creatives/:id/ai-review', async (m, b) => {
  const snap = scriptSnapshot(serverDoc(m[1]))
  const text = combinedScript(snap, b.hookId)
  if (countWords(text) < 25) return ok({ skipped: 'too_short' })
  const h = hashOf(serverDoc(m[1])) + b.hookId
  if (lastReview.get(m[1]) === h) return ok({ skipped: 'unchanged' })
  lastReview.set(m[1], h)
  await sleep(700)
  for (const s of db.suggestions) if (s.creative_id === m[1] && s.origin === 'proactive' && s.status === 'pending') s.status = 'dismissed'
  const s = { id: uid('s'), creative_id: m[1], message_id: null, origin: 'proactive', kind: 'note', target: null, base_text: null, text: `${DEMO} שווה לבדוק אם יש בגוף משפט שחוזר על מה שהליד כבר אמר.`, reason: 'חזרות מאריכות את הסרטון בלי להוסיף.', status: 'pending', created_at: now() }
  db.suggestions.unshift(s)
  return ok({ suggestions: [s] })
})
route('POST', '/creatives/:id/short', async (m, b) => {
  const src = db.creatives.find((x) => x.id === m[1])
  const snap = scriptSnapshot(serverDoc(src.id))
  const firstSentences = (t: string, n: number) => (t.match(/[^.!?]+[.!?]?/g) ?? [t]).slice(0, n).join('').trim()
  const selected = snap.hooks.find((h) => h.id === b.hookId) ?? snap.hooks[0]
  const others = b.includeOtherHooks ? snap.hooks.filter((h) => h.id !== selected?.id).map((h) => h.text) : []
  await sleep(1200)
  const label = b.targetSeconds ? `${b.targetSeconds} שנ׳` : b.freeTarget
  const c = newCreative(
    { product_id: src.product_id, name: `${src.name} — גרסה קצרה (${label})`, angle: src.angle, source_creative_id: src.id, source_kind: 'short', short_target: label },
    { hooks: [selected?.text ?? '', ...others], lead: firstSentences(snap.lead, 1), body: firstSentences(snap.body, 2), cta: snap.cta, shooting: snap.shooting },
  )
  log(c.id, 'ai.short_version_created', { target: label })
  log(src.id, 'creative.short_version_derived', { target: label })
  return ok({ creative: c, notes: `${DEMO} קיצור פשוט: נשמרו המשפטים הראשונים. AI אמיתי יקצר בצורה חכמה יותר.` }, 201)
})

/** Routes every /api request made by the app to the handlers above. */
export function installMockApi() {
  const realFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const u = new URL(url, location.href)
    if (!u.pathname.startsWith('/api/')) return realFetch(input, init)
    const path = u.pathname.slice(4)
    const method = (init?.method ?? 'GET').toUpperCase()
    let body: any = undefined
    if (init?.body instanceof FormData) body = init.body
    else if (typeof init?.body === 'string') body = JSON.parse(init.body || '{}')
    let res: Res = fail(404, 'נתיב לא קיים בהדגמה')
    for (const [m, re, h] of routes) {
      const match = method === m ? path.match(re) : null
      if (match) {
        try {
          res = await h(match, body ?? {}, u.searchParams)
        } catch (e) {
          console.error('[demo]', e)
          res = fail(500, 'שגיאה בהדגמה')
        }
        break
      }
    }
    await sleep(60)
    return new Response(JSON.stringify(res.data), { status: res.status, headers: { 'Content-Type': 'application/json' } })
  }
}
