// End-to-end acceptance tests: two real users in two separate browser contexts against a real
// server and Postgres. The AI provider is a local mock (tests/e2e/mock-openai.mjs).
import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test'
import { readFileSync, readdirSync } from 'node:fs'
import path from 'node:path'
import pg from 'pg'
import WS from 'ws'
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'

test.describe.configure({ mode: 'serial' })

const A = { name: 'יעל', email: 'yael@example.com', password: 'password-a-123' }
const B = { name: 'דני', email: 'dani@example.com', password: 'password-b-123' }
let ctxA: BrowserContext, ctxB: BrowserContext, pageA: Page, pageB: Page
let creativeUrl = ''
let productUrl = ''

const editor = (page: Page, field: string) => page.locator(`[data-field="${field}"]`)
const saved = (page: Page) => expect(page.getByTestId('save-state')).toHaveAttribute('data-state', 'saved', { timeout: 15000 })
async function typeIn(page: Page, field: string, text: string) {
  await editor(page, field).click()
  await page.keyboard.press('End')
  await page.keyboard.type(text, { delay: 5 })
}
async function connectDoc(creativeId: string, sessionToken: string): Promise<string> {
  class CookieWS extends WS {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers: { Cookie: `cw_session=${sessionToken}`, Origin: 'http://localhost:3100' } })
    }
  }
  const socket = new HocuspocusProviderWebsocket({ url: 'ws://localhost:3100/collab', WebSocketPolyfill: CookieWS })
  const result = await new Promise<string>((resolve) => {
    const provider = new HocuspocusProvider({
      websocketProvider: socket,
      name: `creative:${creativeId}`,
      token: 'cookie',
      onAuthenticationFailed: () => resolve('denied'),
      onSynced: () => resolve('synced'),
    })
    provider.attach()
    setTimeout(() => resolve('timeout'), 8000)
  })
  socket.destroy()
  return result
}
async function mockRequests(): Promise<any[]> {
  return (await fetch('http://localhost:3199/__requests')).json()
}

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  ctxA = await browser.newContext({ baseURL: 'http://localhost:3100' })
  ctxB = await browser.newContext({ baseURL: 'http://localhost:3100' })
  pageA = await ctxA.newPage()
  pageB = await ctxB.newPage()
})
test.afterAll(async () => {
  await ctxA?.close()
  await ctxB?.close()
})

test('first user sets up the workspace', async () => {
  await pageA.goto('/login')
  await expect(pageA.getByRole('heading', { name: 'הקמת סביבת העבודה' })).toBeVisible()
  await pageA.getByLabel('שם', { exact: true }).fill(A.name)
  await pageA.getByLabel('אימייל').fill(A.email)
  await pageA.getByLabel('סיסמה').fill(A.password)
  await pageA.getByRole('button', { name: 'הקמה וכניסה' }).click()
  await expect(pageA.getByRole('heading', { name: `שלום, ${A.name}` })).toBeVisible()
})

test('brand, product and creative persist after reload', async () => {
  await pageA.getByRole('button', { name: '+ מותג חדש' }).click()
  await pageA.getByLabel('שם המותג').fill('Glow Labs גלואו')
  await pageA.getByRole('dialog').getByRole('button', { name: 'יצירת מותג' }).click()
  await expect(pageA.getByRole('heading', { name: 'Glow Labs גלואו' })).toBeVisible()
  await pageA.getByRole('button', { name: '+ מוצר חדש' }).first().click()
  await pageA.getByLabel('שם המוצר').fill('סרום ויטמין C')
  await pageA.getByRole('dialog').getByRole('button', { name: 'יצירת מוצר' }).click()
  await expect(pageA.getByRole('heading', { name: 'סרום ויטמין C' })).toBeVisible()
  productUrl = pageA.url()

  // Product dossier is shared, editable and saved.
  await pageA.getByRole('button', { name: 'עריכה', exact: true }).click()
  await pageA.getByLabel('יתרונות').fill('עור זוהר תוך 14 יום לפי ניסוי פנימי. https://example.com/study')
  await pageA.getByRole('button', { name: 'שמירה', exact: true }).click()
  await expect(pageA.getByText('תיק המוצר נשמר')).toBeVisible()

  await pageA.getByRole('button', { name: '+ קריאייטיב חדש' }).first().click()
  await pageA.getByLabel('שם הקריאייטיב').fill('בוקר עייף')
  await pageA.getByRole('dialog').getByRole('button', { name: 'יצירה' }).click()
  await expect(editor(pageA, 'lead')).toBeVisible()
  creativeUrl = pageA.url()

  await typeIn(pageA, 'lead', 'כל בוקר אותו סיפור.')
  await saved(pageA)
  await pageA.reload()
  await expect(editor(pageA, 'lead')).toHaveText('כל בוקר אותו סיפור.')
  await pageA.goto(productUrl)
  await expect(pageA.getByText('בוקר עייף')).toBeVisible()
  await expect(pageA.getByRole('link', { name: 'https://example.com/study' })).toBeVisible()
})

test('second user joins with an invite and sees the same workspace', async () => {
  await pageA.goto('/settings')
  await pageA.getByRole('button', { name: 'יצירת קוד הזמנה' }).click()
  const code = (await pageA.getByTestId('invite-code').textContent())!.trim()
  await pageB.goto('/login')
  await pageB.getByRole('button', { name: 'הצטרפות' }).click()
  await pageB.getByLabel('שם', { exact: true }).fill(B.name)
  await pageB.getByLabel('אימייל').fill(B.email)
  await pageB.getByLabel('סיסמה').fill(B.password)
  await pageB.getByLabel('קוד הזמנה').fill(code)
  await pageB.getByRole('button', { name: 'הצטרפות' }).click()
  await expect(pageB.getByRole('heading', { name: `שלום, ${B.name}` })).toBeVisible()
  await expect(pageB.getByRole('link', { name: /Glow Labs/ }).first()).toBeVisible()
  // Invite codes are single-use.
  const res = await pageB.request.post('/api/auth/register', { data: { name: 'x', email: 'x@example.com', password: '12345678', inviteCode: code } })
  expect(res.status()).toBe(400)
})

test('a blocked dossier save keeps the local draft and never overwrites untouched fields', async () => {
  await pageA.goto(productUrl)
  await pageB.goto(productUrl)
  await pageA.getByRole('button', { name: 'עריכה', exact: true }).click()
  await pageB.getByRole('button', { name: 'עריכה', exact: true }).click()
  // B saves first: changes features (A won't touch it) and offer (A will also change it).
  await pageB.getByLabel('מאפיינים').fill('30ml, ויטמין C 15%')
  await pageB.getByLabel('הצעה מסחרית').fill('ההצעה של דני')
  await pageB.getByRole('button', { name: 'שמירה', exact: true }).click()
  await expect(pageB.getByText('תיק המוצר נשמר')).toBeVisible()
  // A edits from the older version.
  await pageA.getByLabel('הצעה מסחרית').fill('ההצעה של יעל')
  await pageA.getByLabel('קהלים').fill('אמהות עובדות')
  await pageA.getByRole('button', { name: 'שמירה', exact: true }).click()
  await expect(pageA.getByTestId('dossier-conflict')).toContainText('הטיוטה שלכם לא נמחקה')
  await expect(pageA.getByLabel('הצעה מסחרית')).toHaveValue('ההצעה של יעל')
  await expect(pageA.getByLabel('קהלים')).toHaveValue('אמהות עובדות')
  await expect(pageA.getByLabel('מאפיינים')).toHaveValue('30ml, ויטמין C 15%')
  await expect(pageA.getByTestId('dossier-both-offer')).toContainText('ההצעה של דני')
  await pageA.getByRole('button', { name: 'שמירה', exact: true }).click()
  await expect(pageA.getByText('תיק המוצר נשמר')).toBeVisible()
  const id = productUrl.split('/').pop()
  const saved = await (await pageA.request.get(`/api/products/${id}`)).json()
  expect(saved.product.dossier.offer).toBe('ההצעה של יעל')
  expect(saved.product.dossier.audiences).toBe('אמהות עובדות')
  expect(saved.product.dossier.features).toBe('30ml, ויטמין C 15%')
  expect(saved.product.dossier.benefits).toContain('עור זוהר')
  await pageB.goto('/')
})

test('simultaneous editing of the same field merges without losing text', async () => {
  await pageA.goto(creativeUrl)
  await pageB.goto(creativeUrl)
  await expect(editor(pageA, 'body')).toBeVisible()
  await expect(editor(pageB, 'body')).toBeVisible()
  await expect(pageA.getByTestId('presence')).toContainText(B.name)
  await expect(pageB.getByTestId('presence')).toContainText(A.name)

  const sortChars = (t: string) => [...t.replace(/\s/g, '')].sort().join('')

  // 1) Both type at the very same spot of an empty field at the same time: nothing may be lost,
  //    and both users must converge to the same text.
  const textA = 'טקסט של יעל אחת שתיים שלוש.'
  const textB = 'טקסט של דני ארבע חמש שש.'
  await editor(pageA, 'body').click()
  await editor(pageB, 'body').click()
  await Promise.all([pageA.keyboard.type(textA, { delay: 15 }), pageB.keyboard.type(textB, { delay: 15 })])
  await saved(pageA)
  await saved(pageB)
  await expect.poll(async () => (await editor(pageA, 'body').textContent()) === (await editor(pageB, 'body').textContent())).toBe(true)
  expect(sortChars((await editor(pageA, 'body').textContent())!)).toBe(sortChars(textA + textB))

  // 2) Realistic co-editing: same field (and paragraph), different positions, simultaneously.
  await pageA.keyboard.press('Control+a')
  await pageA.keyboard.type('שורה משותפת באמצע')
  await saved(pageA)
  await expect(editor(pageB, 'body')).toHaveText('שורה משותפת באמצע')
  await editor(pageA, 'body').click()
  await pageA.keyboard.press('Home')
  await editor(pageB, 'body').click()
  await pageB.keyboard.press('End')
  await Promise.all([pageA.keyboard.type('פתיחה של יעל ', { delay: 15 }), pageB.keyboard.type(' וסיום של דני', { delay: 15 })])
  await saved(pageA)
  await saved(pageB)
  for (const p of [pageA, pageB]) await expect(editor(p, 'body')).toHaveText('פתיחה של יעל שורה משותפת באמצע וסיום של דני')
  await pageB.reload()
  await expect(editor(pageB, 'body')).toHaveText('פתיחה של יעל שורה משותפת באמצע וסיום של דני')
  await pageA.keyboard.press('Control+a')
  await pageA.keyboard.type('טקסט של יעל. טקסט של דני.')
  await saved(pageA)
})

test('switching hooks changes only the hook; read time ignores shooting notes and other hooks', async () => {
  await pageA.goto(creativeUrl)
  const firstHook = pageA.locator('[data-field^="hook:"]').first()
  await firstHook.click()
  await pageA.keyboard.type('הוק ראשון קצר')
  await pageA.getByRole('button', { name: '+ הוק' }).click()
  await expect(pageA.locator('[data-field^="hook:"]')).toHaveCount(2)
  await pageA.locator('[data-field^="hook:"]').nth(1).click()
  await pageA.keyboard.type('הוק שני ארוך יותר עם עוד כמה מילים נוספות')
  await typeIn(pageA, 'cta', 'הזמינו עכשיו')
  await saved(pageA)

  const words = async () => Number((await pageA.getByTestId('word-count').textContent())!.match(/\d+/)![0])
  await pageA.getByRole('button', { name: '○ בחירה' }).first().click() // select hook 1
  const withHook1 = await words()
  await pageA.locator('[data-hook-id]').nth(1).getByRole('button', { name: '○ בחירה' }).click()
  const withHook2 = await words()
  expect(withHook2 - withHook1).toBe(9 - 3)

  await typeIn(pageA, 'shooting', 'צילום במטבח עם אור בוקר ועוד הרבה מילים שלא אמורות להיספר')
  await saved(pageA)
  expect(await words()).toBe(withHook2)

  await pageA.getByRole('button', { name: 'תסריט מלא' }).click()
  const combined = pageA.getByTestId('combined')
  await expect(combined).toContainText('הוק שני ארוך')
  await expect(combined).not.toContainText('הוק ראשון קצר')
  await expect(combined).not.toContainText('צילום במטבח')
  await pageA.getByRole('button', { name: '1', exact: true }).click()
  await expect(combined).toContainText('הוק ראשון קצר')
  await expect(combined).not.toContainText('הוק שני ארוך')
  await expect(combined).toContainText('כל בוקר אותו סיפור.')
  await expect(combined).toContainText('הזמינו עכשיו')
  await pageA.getByRole('button', { name: 'עריכה', exact: true }).click()
})

test('deleting a hook can be undone', async () => {
  await pageA.locator('[data-hook-id]').nth(1).getByRole('button', { name: 'מחיקת הוק' }).click()
  await expect(pageA.locator('[data-field^="hook:"]')).toHaveCount(1)
  await pageA.getByRole('button', { name: 'ביטול' }).click()
  await expect(pageA.locator('[data-field^="hook:"]')).toHaveCount(2)
})

test('research is saved in the right creative', async () => {
  await pageA.getByRole('tab', { name: 'חקר לקוח' }).click()
  await expect(pageA.getByTestId('research-overwrite-note')).toContainText('עלול לדרוס')
  await pageA.getByRole('button', { name: 'הוספה לכאבים, פחדים ותסכולים' }).click()
  await pageA.keyboard.type('מתעוררים עייפים')
  await saved(pageA)
  await pageB.getByRole('tab', { name: 'חקר לקוח' }).click()
  await expect(pageB.locator('[data-section="pains"] textarea').first()).toHaveValue('מתעוררים עייפים', { timeout: 10000 })

  // A second creative has its own, empty research.
  await pageA.goto(productUrl)
  await pageA.getByRole('button', { name: '+ קריאייטיב חדש' }).first().click()
  await pageA.getByLabel('שם הקריאייטיב').fill('קריאייטיב שני')
  await pageA.getByRole('dialog').getByRole('button', { name: 'יצירה' }).click()
  await expect(editor(pageA, 'lead')).toBeVisible()
  await pageA.getByRole('tab', { name: 'חקר לקוח' }).click()
  await expect(pageA.locator('[data-section="pains"] textarea')).toHaveCount(0)
  await pageA.goto(creativeUrl)
  await pageA.getByRole('tab', { name: 'חקר לקוח' }).click()
  await expect(pageA.locator('[data-section="pains"] textarea').first()).toHaveValue('מתעוררים עייפים')
})

test('AI assistant receives the right product and script; suggestions need approval and never overwrite newer text', async () => {
  await pageA.goto(creativeUrl)
  await pageA.getByRole('tab', { name: 'עוזר AI' }).click()
  await pageA.getByLabel('הודעה לעוזר').fill('שפר את הגוף')
  await pageA.getByRole('button', { name: 'שליחה' }).click()
  await expect(pageA.getByText('גוף משופר מהעוזר')).toBeVisible()

  const reqs = await mockRequests()
  const last = reqs.filter((r) => r.body.text.format.name === 'assistant_reply').at(-1)
  expect(last.auth).toBe('Bearer test-key-not-real')
  expect(last.body.instructions).toContain('סרום ויטמין C')
  expect(last.body.instructions).toContain('עור זוהר תוך 14 יום')
  expect(last.body.instructions).toContain('טקסט של יעל')
  expect(last.body.instructions).toContain('מתעוררים עייפים')
  expect(last.body.instructions).not.toContain('קריאייטיב שני')
  expect(JSON.stringify(last.body.input)).toContain(`${A.name}: שפר את הגוף`)

  // Nothing changed yet.
  await expect(editor(pageA, 'body')).not.toContainText('גוף משופר מהעוזר')

  // B edits the body after the suggestion was created -> applying must be blocked.
  await typeIn(pageB, 'body', ' תוספת חדשה של דני')
  await saved(pageB)
  const card = pageA.getByTestId('suggestion').filter({ hasText: 'גוף משופר מהעוזר' })
  await expect(card.getByText('הטקסט השתנה מאז שההצעה נוצרה')).toBeVisible()
  await expect(card.getByRole('button', { name: 'החלה על הטקסט' })).toBeDisabled()
  // The server enforces it too, even if a client tries.
  const sug = (await (await pageA.request.get(creativeUrl.replace('/creatives/', '/api/creatives/') + '/suggestions')).json()).find((s: any) => s.text === 'גוף משופר מהעוזר')
  const apply = await pageA.request.post(`/api/suggestions/${sug.id}/apply`, { headers: { Origin: 'http://localhost:3100' } })
  expect(apply.status()).toBe(409)
  await expect(editor(pageA, 'body')).toContainText('תוספת חדשה של דני')

  // "Add as new hook" works and syncs to the partner.
  await pageA.getByTestId('suggestion').filter({ hasText: 'הוק חדש מהעוזר' }).getByRole('button', { name: 'הוספה כהוק חדש' }).click()
  await expect(pageB.locator('[data-field^="hook:"]').filter({ hasText: 'הוק חדש מהעוזר' })).toBeVisible()
})

test('a fresh rewrite suggestion applies only after approval', async () => {
  await pageA.getByLabel('הודעה לעוזר').fill('עוד פעם')
  await pageA.getByRole('button', { name: 'שליחה' }).click()
  const card = pageA.getByTestId('suggestion').filter({ hasText: 'גוף משופר מהעוזר' }).last()
  await expect(card.getByRole('button', { name: 'החלה על הטקסט' })).toBeEnabled()
  await card.getByRole('button', { name: 'החלה על הטקסט' }).click()
  await expect(editor(pageA, 'body')).toHaveText('גוף משופר מהעוזר')
  await expect(editor(pageB, 'body')).toHaveText('גוף משופר מהעוזר')
  await saved(pageA)
})

test('short version creates a new linked creative and leaves the source unchanged', async () => {
  await pageA.goto(creativeUrl)
  await expect(editor(pageA, 'body')).toBeVisible()
  const sourceBody = await editor(pageA, 'body').textContent()
  const sourceHooks = await pageA.locator('[data-field^="hook:"]').count()
  await pageA.getByRole('button', { name: /צור גרסה קצרה/ }).click()
  await pageA.getByRole('button', { name: '30 שנ׳' }).click()
  await pageA.getByRole('dialog').getByRole('button', { name: 'יצירת גרסה קצרה' }).click()
  await expect(pageA.getByText('גרסה קצרה של')).toBeVisible()
  await expect(editor(pageA, 'body')).toHaveText('גוף מקוצר')
  await expect(pageA.getByLabel('סטטוס')).toHaveValue('writing')
  await expect(pageA.getByText('✓ מאושר')).toHaveCount(0)
  const shortReq = (await mockRequests()).filter((r) => r.body.text.format.name === 'short_version').at(-1)
  expect(JSON.stringify(shortReq.body.input)).toContain('30 שניות')
  await pageA.goto(creativeUrl)
  await expect(editor(pageA, 'body')).toHaveText(sourceBody!)
  await expect(pageA.locator('[data-field^="hook:"]')).toHaveCount(sourceHooks)
})

test('comments, links, files and approvals are saved and attributed', async () => {
  await pageA.goto(creativeUrl)
  await pageA.getByRole('tab', { name: 'תגובות והפקה' }).click()
  await pageA.getByLabel('תגובה חדשה').fill('נראה מעולה, לצלם השבוע https://example.com/ref')
  await pageA.getByRole('button', { name: 'הוספת תגובה' }).click()
  await expect(pageA.getByTestId('comment').filter({ hasText: 'נראה מעולה' })).toContainText(A.name)

  await pageA.getByRole('button', { name: '+ הוספה' }).click()
  await pageA.getByRole('button', { name: 'קישור (למשל לסרטון)' }).click()
  await pageA.getByRole('dialog').getByLabel('קישור').fill('https://drive.example.com/video.mp4')
  await pageA.getByRole('dialog').getByLabel('שם', { exact: true }).fill('צילום גולמי')
  await pageA.getByRole('dialog').getByRole('button', { name: 'הוספה', exact: true }).click()
  await expect(pageA.getByTestId('asset').filter({ hasText: 'צילום גולמי' })).toBeVisible()

  await pageA.getByRole('button', { name: '+ הוספה' }).click()
  await pageA.locator('input[type=file]').setInputFiles({ name: 'תסריט-סופי.txt', mimeType: 'text/plain', buffer: Buffer.from('final script') })
  await pageA.getByRole('dialog').getByRole('button', { name: 'הוספה', exact: true }).click()
  const fileAsset = pageA.getByTestId('asset').filter({ hasText: 'תסריט-סופי.txt' })
  await expect(fileAsset).toBeVisible()
  const href = await fileAsset.getByRole('link', { name: 'תסריט-סופי.txt' }).getAttribute('href')
  const dl = await pageA.request.get(href!)
  expect(await dl.text()).toBe('final script')
  // Files are not reachable without a session.
  const anon = await fetch(`http://localhost:3100${href}`)
  expect(anon.status).toBe(401)

  // B sees the comment and asset.
  await pageB.goto(creativeUrl)
  await pageB.getByRole('tab', { name: 'תגובות והפקה' }).click()
  await expect(pageB.getByTestId('comment').filter({ hasText: 'נראה מעולה' })).toBeVisible()
  await expect(pageB.getByTestId('asset').filter({ hasText: 'צילום גולמי' })).toBeVisible()

  // Approval, then a substantive change flags re-review.
  await saved(pageB)
  await pageB.getByRole('button', { name: 'אישור התסריט' }).click()
  await expect(pageB.getByTestId('approval')).toContainText(`אושר על ידי ${B.name}`)
  await expect(pageA.getByText('✓ מאושר')).toBeVisible({ timeout: 10000 })
  await typeIn(pageA, 'cta', ' ותקבלו מתנה')
  await saved(pageA)
  await expect(pageA.getByRole('button', { name: 'נדרשת בדיקה מחודשת' })).toBeVisible({ timeout: 10000 })
  await pageA.getByRole('tab', { name: 'היסטוריה' }).click()
  await expect(pageA.getByText('גרסה שאושרה').first()).toBeVisible()
  await expect(pageA.getByText(/אישר\/ה את התסריט/)).toBeVisible()
})

test('version restore brings back an older script for both users', async () => {
  pageA.once('dialog', (d) => d.accept())
  await pageA.getByTestId('version').filter({ hasText: 'גרסה שאושרה' }).first().getByRole('button', { name: 'שחזור' }).click()
  await expect(editor(pageA, 'cta')).not.toContainText('ותקבלו מתנה', { timeout: 10000 })
  await expect(editor(pageB, 'cta')).not.toContainText('ותקבלו מתנה', { timeout: 10000 })
})

test('duplicate gets a new identity without approvals, comments or files', async () => {
  await pageA.goto(creativeUrl)
  pageA.once('dialog', (d) => d.accept())
  await pageA.getByRole('button', { name: 'שכפול', exact: true }).click()
  await expect(pageA.getByText('שוכפל מ')).toBeVisible()
  expect(pageA.url()).not.toBe(creativeUrl)
  await expect(editor(pageA, 'body')).toContainText('גוף משופר מהעוזר')
  await expect(pageA.getByText('✓ מאושר')).toHaveCount(0)
  await pageA.getByRole('tab', { name: 'תגובות והפקה' }).click()
  await expect(pageA.getByText('אין תגובות עדיין')).toBeVisible()
  await expect(pageA.getByText('אין עדיין חומרי הפקה')).toBeVisible()
})

test('no access without permission, across workspaces, or to secrets', async ({ request }) => {
  // Unauthenticated
  expect((await request.get('/api/home')).status()).toBe(401)
  const id = creativeUrl.split('/').pop()
  expect((await request.get(`/api/creatives/${id}`)).status()).toBe(401)

  // A user from another workspace gets "not found" for our data.
  const db = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? 'postgres://copywrite:copywrite@localhost:5432/copywrite_test' })
  await db.connect()
  const ws = (await db.query(`INSERT INTO workspaces (name) VALUES ('other') RETURNING id`)).rows[0].id
  const u = (await db.query(`INSERT INTO users (email, name, password_hash) VALUES ('eve@example.com', 'Eve', 'x') RETURNING id`)).rows[0].id
  await db.query(`INSERT INTO memberships (workspace_id, user_id) VALUES ($1, $2)`, [ws, u])
  await db.end()
  const { createHash } = await import('node:crypto')
  const token = 'eve-session-token'
  const db2 = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? 'postgres://copywrite:copywrite@localhost:5432/copywrite_test' })
  await db2.connect()
  await db2.query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 day')`, [
    createHash('sha256').update('test-secret').update(token).digest('hex'),
    u,
  ])
  await db2.end()
  const eve = { headers: { Cookie: `cw_session=${token}`, Origin: 'http://localhost:3100' } }
  expect((await request.get('/api/home', eve)).status()).toBe(200)
  expect((await (await request.get('/api/home', eve)).json()).brands).toHaveLength(0)
  expect((await request.get(`/api/creatives/${id}`, eve)).status()).toBe(404)
  expect((await request.post(`/api/creatives/${id}/ai/assistant`, { ...eve, data: { message: 'hi' } })).status()).toBe(404)
  expect(await (await request.get(`/api/search?q=${encodeURIComponent('בוקר')}`, eve)).json()).toMatchObject({ creatives: [] })

  // Eve cannot open the collaborative document; A (same workspace) can. Real Hocuspocus client.
  const cookieA = (await ctxA.cookies()).find((c) => c.name === 'cw_session')!.value
  expect(await connectDoc(id!, token)).toBe('denied')
  expect(await connectDoc(id!, cookieA)).toBe('synced')
  const evePage = await (await pageA.context().browser()!.newContext()).newPage()
  await evePage.context().addCookies([{ name: 'cw_session', value: token, url: 'http://localhost:3100' }])
  await evePage.goto(creativeUrl)
  await expect(evePage.getByRole('alert')).toContainText('לא נמצא')

  // Cross-site POST is rejected.
  const cs = await request.post('/api/brands', { headers: { Cookie: `cw_session=${token}`, Origin: 'https://evil.example' }, data: { name: 'x' } })
  expect(cs.status()).toBe(403)

  // The API key never reaches the browser.
  const me = await (await pageA.request.get('/api/me')).text()
  expect(me).not.toContain('test-key-not-real')
  const assets = path.join('dist', 'web', 'assets')
  for (const f of readdirSync(assets).filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(path.join(assets, f), 'utf8')
    expect(src).not.toContain('test-key-not-real')
  }
})

test('disconnect is shown clearly and edits made offline are saved after reconnecting', async () => {
  await pageA.goto(creativeUrl)
  await saved(pageA)
  await ctxA.setOffline(true)
  await expect(pageA.getByTestId('save-state')).toHaveAttribute('data-state', /offline/, { timeout: 20000 })
  await typeIn(pageA, 'lead', ' נכתב בלי חיבור')
  await expect(pageA.getByTestId('save-state')).toHaveAttribute('data-state', 'offline_unsaved')
  await expect(pageA.getByRole('alert').filter({ hasText: 'אין חיבור לשרת' })).toBeVisible()
  await ctxA.setOffline(false)
  await saved(pageA)
  await pageB.goto(creativeUrl)
  await expect(editor(pageB, 'lead')).toContainText('נכתב בלי חיבור')
})

test('Hebrew UI handles English, numbers and links', async () => {
  await pageA.goto(creativeUrl)
  await typeIn(pageA, 'body', ' Vitamin C 15% — https://glow.example.com/serum')
  await saved(pageA)
  await expect(pageA.locator('html')).toHaveAttribute('dir', 'rtl')
  await expect(editor(pageA, 'body')).toContainText('Vitamin C 15%')
  await pageA.screenshot({ path: 'test-results/creative-screen.png', fullPage: false })
})

test('AI connection check reports model availability', async () => {
  await pageA.goto('/settings')
  await pageA.getByRole('button', { name: 'בדיקת חיבור אמיתית' }).click()
  await expect(pageA.getByTestId('ai-check')).toContainText('gpt-test')
  await expect(pageA.getByTestId('ai-check')).toContainText('החיבור עובד')
})

test('backup + restore round trip reproduces the data and files', async () => {
  test.setTimeout(120_000)
  await pageA.goto('/settings')
  await pageA.getByRole('button', { name: 'גיבוי מלא כולל קבצים' }).click()
  await expect(pageA.getByTestId('backup').first()).toContainText('מלא')
  // Non-owners can't list or download backups.
  expect((await pageB.request.get('/api/backups')).status()).toBe(403)
  const href = await pageA.getByTestId('backup').first().getByRole('link', { name: 'הורדה' }).getAttribute('href')
  const res = await pageA.request.get(href!)
  expect(res.status()).toBe(200)
  const { mkdtempSync, writeFileSync, readdirSync: rd } = await import('node:fs')
  const os = await import('node:os')
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cw-rt-'))
  const file = path.join(dir, 'backup.tar.gz')
  writeFileSync(file, await res.body())

  const restoreUrl = (process.env.TEST_DATABASE_URL ?? 'postgres://copywrite:copywrite@localhost:5432/copywrite_test').replace(/\/[^/]+$/, '/copywrite_restore')
  const reset = new pg.Client({ connectionString: restoreUrl })
  await reset.connect()
  await reset.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await reset.end()
  const { execFileSync } = await import('node:child_process')
  const uploads = path.join(dir, 'uploads')
  execFileSync('node', ['dist/restore.js', file, '--files'], {
    env: { ...process.env, DATABASE_URL: restoreUrl, SESSION_SECRET: 'x', UPLOAD_DIR: uploads },
    stdio: 'pipe',
  })
  const src = new pg.Client({ connectionString: process.env.TEST_DATABASE_URL ?? 'postgres://copywrite:copywrite@localhost:5432/copywrite_test' })
  const dst = new pg.Client({ connectionString: restoreUrl })
  await src.connect()
  await dst.connect()
  for (const t of ['brands', 'products', 'creatives', 'creative_docs', 'creative_versions', 'comments', 'assets', 'approvals', 'ai_messages', 'activity']) {
    const a = (await src.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n
    const b = (await dst.query(`SELECT count(*)::int n FROM ${t}`)).rows[0].n
    // The 'backup.created' activity row is written after the archive, so the source has one more.
    expect(b, t).toBe(t === 'activity' ? a - 1 : a)
  }
  const docA = (await src.query('SELECT creative_id, state FROM creative_docs ORDER BY creative_id')).rows
  const docB = (await dst.query('SELECT creative_id, state FROM creative_docs ORDER BY creative_id')).rows
  expect(docB.map((r) => r.state.toString('base64'))).toEqual(docA.map((r) => r.state.toString('base64')))
  await src.end()
  await dst.end()
  // The uploaded file came back too.
  const ws = rd(uploads)[0]
  expect(rd(path.join(uploads, ws)).length).toBeGreaterThan(0)
})

test('owner can remove a member, who immediately loses access', async () => {
  await pageA.goto('/settings')
  pageA.once('dialog', (d) => d.accept())
  await pageA.getByRole('button', { name: 'הסרת גישה' }).click()
  await expect(pageA.getByText('הגישה הוסרה')).toBeVisible()
  expect((await pageB.request.get('/api/home')).status()).toBe(401)
  // Open registration is not possible without a valid invite.
  const r = await pageB.request.post('/api/auth/register', { headers: { Origin: 'http://localhost:3100' }, data: { name: 'x', email: 'new@example.com', password: '12345678', inviteCode: 'guess-guess' } })
  expect(r.status()).toBe(400)
  const setup = await pageB.request.post('/api/auth/setup', { headers: { Origin: 'http://localhost:3100' }, data: { name: 'x', email: 'n2@example.com', password: '12345678', workspaceName: 'w' } })
  expect(setup.status()).toBe(409)
})
