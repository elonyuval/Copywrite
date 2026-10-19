// Live AI acceptance check against a running deployment (real OpenAI calls happen on the server;
// the API key is never needed here).
//
//   SMOKE_URL=https://… SMOKE_EMAIL=… SMOKE_PASSWORD=… npx tsx scripts/smoke-live.ts
//   (or SMOKE_INVITE=<code> instead of an existing account: registers a "בדיקת AI" user)
//
// Creates a throwaway brand with two products whose facts differ, writes a script into one creative
// through the real collaboration socket, then checks:
//   1. research conversation — Hebrew, structured proposals, nothing written to the research by itself
//   2. hook suggestions — Hebrew, about the right product, script unchanged until approved
//   3. short version — new linked creative, source unchanged, draft status, not approved
// The test brand is archived at the end (pass --keep to leave it).
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider'
import WS from 'ws'
import * as Y from 'yjs'
import { RESEARCH_KEYS } from '../shared/constants'
import { countWords } from '../shared/readingTime'
import { combinedScript, fullSnapshot, scriptSnapshot, setFragmentText, hookFragment, listHooks } from '../shared/script'

const base = (process.env.SMOKE_URL ?? '').replace(/\/$/, '')
if (!base) throw new Error('SMOKE_URL is required')
const keep = process.argv.includes('--keep')
let cookie = ''
const results: { name: string; ok: boolean; detail: string }[] = []
const check = (name: string, ok: boolean, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
}

async function api(method: string, path: string, body?: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', Origin: base, ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const set = res.headers.get('set-cookie')
  if (set) cookie = set.split(';')[0]
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${data?.error ?? text}`)
  return data
}

const hebrewRatio = (t: string) => {
  const letters = t.match(/\p{L}/gu) ?? []
  return letters.length ? letters.filter((c) => /[֐-׿]/.test(c)).length / letters.length : 0
}

async function openDoc(creativeId: string) {
  const wsUrl = base.replace(/^http/, 'ws') + '/collab'
  const sessionCookie = cookie
  class CookieWS extends WS {
    constructor(url: string, protocols?: string | string[]) {
      super(url, protocols, { headers: { Cookie: sessionCookie, Origin: base } })
    }
  }
  const socket = new HocuspocusProviderWebsocket({ url: wsUrl, WebSocketPolyfill: CookieWS })
  const doc = new Y.Doc()
  const provider = new HocuspocusProvider({ websocketProvider: socket, name: `creative:${creativeId}`, document: doc, token: 'cookie' })
  provider.attach()
  await new Promise<void>((resolve, reject) => {
    provider.on('synced', () => resolve())
    provider.on('authenticationFailed', () => reject(new Error('collaboration auth failed')))
    setTimeout(() => reject(new Error('collaboration sync timeout')), 15000)
  })
  return {
    doc,
    close: () => {
      provider.destroy()
      socket.destroy()
    },
  }
}

async function main() {
  console.log(`Live AI check against ${base}\n`)
  if (process.env.SMOKE_INVITE) {
    await api('POST', '/auth/register', {
      name: 'בדיקת AI',
      email: process.env.SMOKE_EMAIL ?? `ai-check-${Date.now()}@example.invalid`,
      password: process.env.SMOKE_PASSWORD ?? `pw-${Date.now()}-${Math.random()}`,
      inviteCode: process.env.SMOKE_INVITE,
    })
  } else {
    await api('POST', '/auth/login', { email: process.env.SMOKE_EMAIL, password: process.env.SMOKE_PASSWORD })
  }
  const me = await api('GET', '/me')
  check('AI מוגדר בשרת', me.aiConfigured, `מודל: ${me.aiModel}`)
  if (!me.aiConfigured) return
  const ai = await api('POST', '/ai/check')
  check('המודל זמין לחשבון ועונה', true, `${ai.model}, ${(ai.ms / 1000).toFixed(1)} שנ׳: "${ai.sample}"`)

  const brand = await api('POST', '/brands', { name: `בדיקת AI ${new Date().toISOString().slice(0, 16)} (אפשר למחוק)` })
  try {
    // Two products with clearly different facts — the AI must use only the right one.
    const serum = await api('POST', `/brands/${brand.id}/products`, { name: 'סרום ויטמין C', description: 'סרום פנים בבקבוק טפטפת כחול' })
    await api('PATCH', `/products/${serum.id}`, {
      revision: serum.revision,
      dossier: {
        benefits: 'עור זוהר ואחיד יותר אחרי שבועיים של שימוש יומי (לפי משובי לקוחות שנאספו בחנות)',
        features: '30 מ״ל, 15% ויטמין C, מרקם קליל שנספג מהר',
        offer: '1+1 עד סוף החודש',
      },
    })
    const shoes = await api('POST', `/brands/${brand.id}/products`, { name: 'נעלי ריצה', description: 'נעליים עם סוליית קצף' })
    await api('PATCH', `/products/${shoes.id}`, { revision: shoes.revision, dossier: { features: 'סוליית קצף, משקל 210 גרם' } })
    const creative = await api('POST', `/products/${serum.id}/creatives`, { name: 'בוקר עייף', angle: 'אמהות עייפות שרוצות להיראות ערניות' })
    await api('POST', `/products/${shoes.id}/creatives`, { name: 'ריצת בוקר' })

    const { doc, close } = await openDoc(creative.id)
    doc.transact(() => {
      setFragmentText(hookFragment(doc, listHooks(doc)[0].id), 'אם את קמה כל בוקר עם פנים עייפות — תעצרי שנייה.')
      setFragmentText(doc.getXmlFragment('lead'), 'שלושה ילדים, ארבע שעות שינה, ועור שנראה בדיוק ככה.')
      setFragmentText(
        doc.getXmlFragment('body'),
        'ניסיתי קרמים יקרים ומסכות. ואז חברה שלחה לי את הסרום הזה עם 15% ויטמין C. אני שמה שתי טיפות כל בוקר, והוא נספג תוך שניות. אחרי שבועיים חברות שאלו אם נחתי.',
      )
      setFragmentText(doc.getXmlFragment('cta'), 'לחצי על הקישור — עכשיו 1+1 עד סוף החודש.')
    })
    // Wait until the server has stored it.
    for (let i = 0; i < 20; i++) {
      const v = await api('GET', `/creatives/${creative.id}/versions`)
      const c = await api('GET', `/creatives/${creative.id}`)
      if (c.creative.plain_text.includes('15% ויטמין C')) break
      await new Promise((r) => setTimeout(r, 500))
      if (i === 19) throw new Error(`script did not reach the server (${v.length} versions)`)
    }
    const before = fullSnapshot(doc)
    const researchBefore = JSON.stringify(before.research)

    // 1. Research conversation
    const r1 = await api('POST', `/creatives/${creative.id}/ai/research`, {
      message: 'הקהל: אמהות לילדים קטנים שישנות מעט ומרגישות שהעור שלהן נראה עייף. הן כבר ניסו קרמי לחות יקרים.',
    })
    const reply1 = r1.message.content as string
    const updates = r1.message.payload?.updates ?? []
    check('חקר: התשובה בעברית', hebrewRatio(reply1) > 0.7, `${Math.round(hebrewRatio(reply1) * 100)}% אותיות עבריות`)
    check('חקר: שאלת המשך אחת או יותר', reply1.includes('?'), reply1.slice(0, 160).replace(/\n/g, ' '))
    check('חקר: הצעות מובנות לשדות', updates.length > 0 && updates.every((u: any) => RESEARCH_KEYS.includes(u.section)), `${updates.length} פריטים`)
    check('חקר: סימון מקור לכל פריט', updates.every((u: any) => ['user', 'sourced', 'hypothesis', 'ai_example'].includes(u.provenance)), updates.map((u: any) => u.provenance).join(', '))
    await new Promise((r) => setTimeout(r, 1000))
    check('חקר: שום דבר לא נכתב למחקר בלי אישור', JSON.stringify(fullSnapshot(doc).research) === researchBefore)

    // 2. Hook suggestions
    const r2 = await api('POST', `/creatives/${creative.id}/ai/assistant`, { message: 'הצע 3 הוקים חדשים', hookId: listHooks(doc)[0].id })
    const sugg = (await api('GET', `/creatives/${creative.id}/suggestions`)).filter((s: any) => s.message_id === r2.message.id)
    const hooks = sugg.filter((s: any) => s.kind === 'new_hook')
    const allText = [r2.message.content, ...sugg.map((s: any) => `${s.text} ${s.reason}`)].join('\n')
    check('הוקים: התקבלו הצעות להוקים', hooks.length >= 1, hooks.map((h: any) => `«${h.text}»`).join(' | ').slice(0, 300))
    check('הוקים: בעברית', hebrewRatio(allText) > 0.7, `${Math.round(hebrewRatio(allText) * 100)}%`)
    check('הוקים: לא מערבב את המוצר האחר (נעלי ריצה)', !/ריצה|סוליי?ת|קצף|210/.test(allText))
    check('הוקים: קשור למוצר ולקהל הנכונים', /ויטמין|סרום|עור|עייפ|בוקר|זוהר/.test(allText))
    await new Promise((r) => setTimeout(r, 1000))
    const afterHooks = scriptSnapshot(doc)
    const { research: _r, ...scriptBefore } = before
    check('הוקים: התסריט לא השתנה בלי אישור', JSON.stringify(afterHooks) === JSON.stringify(scriptBefore))

    // 3. Short version
    const sourceText = combinedScript(scriptSnapshot(doc), listHooks(doc)[0].id)
    const r3 = await api('POST', `/creatives/${creative.id}/short`, { targetSeconds: 15, pace: 'normal', hookId: listHooks(doc)[0].id, includeOtherHooks: false })
    const short = await openDoc(r3.creative.id)
    const shortSnap = scriptSnapshot(short.doc)
    const shortText = combinedScript(shortSnap, shortSnap.hooks[0]?.id)
    short.close()
    check('קצר: נוצר קריאייטיב חדש ומקושר', r3.creative.source_creative_id === creative.id && r3.creative.id !== creative.id)
    check('קצר: בסטטוס בכתיבה וללא אישור', r3.creative.status === 'writing' && !r3.creative.approved_at)
    check('קצר: בעברית', hebrewRatio(shortText) > 0.7, `${Math.round(hebrewRatio(shortText) * 100)}%`)
    check('קצר: קצר יותר מהמקור', countWords(shortText) < countWords(sourceText), `${countWords(sourceText)} → ${countWords(shortText)} מילים (יעד ≈ 38)`)
    check('קצר: לא מערבב את המוצר האחר', !/ריצה|סוליי?ת|קצף/.test(shortText), shortText.slice(0, 200).replace(/\n/g, ' '))
    await new Promise((r) => setTimeout(r, 1000))
    check('קצר: המקור לא השתנה', combinedScript(scriptSnapshot(doc), listHooks(doc)[0].id) === sourceText)
    close()
  } finally {
    if (!keep) await api('DELETE', `/brands/${brand.id}`).catch(() => {})
  }
}

main()
  .then(() => {
    const failed = results.filter((r) => !r.ok)
    console.log(`\n${results.length - failed.length}/${results.length} בדיקות עברו`)
    process.exit(failed.length ? 1 : 0)
  })
  .catch((e) => {
    console.error(`\n✗ הבדיקה נעצרה: ${e.message}`)
    process.exit(1)
  })
