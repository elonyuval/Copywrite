// Builds the context the assistant receives. Everything is read on the server from the database
// and the live document — the browser cannot inject a different product or script.
import { DOSSIER_FIELDS, PREFERENCE_CATEGORIES, PROVENANCE_LABELS, RESEARCH_SECTIONS, STATUS_LABELS } from '../../shared/constants'
import { fullSnapshot, type FullSnapshot } from '../../shared/script'
import { one, q } from '../db'
import { readCreativeDoc } from '../docs'

export interface CreativeContext {
  creative: any
  product: any
  brand: any
  snapshot: FullSnapshot
  selectedHookId: string | null
  preferences: any[]
}

export async function loadCreativeContext(creative: any, selectedHookId?: string | null): Promise<CreativeContext> {
  const [product, doc] = await Promise.all([
    one('SELECT * FROM products WHERE id = $1', [creative.product_id]),
    readCreativeDoc(creative.id),
  ])
  const brand = await one('SELECT id, name FROM brands WHERE id = $1', [product.brand_id])
  const preferences = await q(
    `SELECT category, title, content, brand_id FROM preferences
      WHERE workspace_id = $1 AND active AND (brand_id IS NULL OR brand_id = $2) ORDER BY category, created_at`,
    [creative.workspace_id, product.brand_id],
  )
  const snapshot = fullSnapshot(doc)
  const sel = snapshot.hooks.find((h) => h.id === selectedHookId)?.id ?? snapshot.hooks[0]?.id ?? null
  return { creative, product, brand, snapshot, selectedHookId: sel, preferences }
}

const block = (title: string, body: string) => `### ${title}\n${body.trim() || '(ריק)'}`

export function renderContext(ctx: CreativeContext, opts: { includeResearch?: boolean; includeScript?: boolean } = {}) {
  const { product, brand, creative, snapshot } = ctx
  const parts: string[] = []
  parts.push(`## מותג: ${brand.name}\n## מוצר: ${product.name}`)
  if (product.description) parts.push(block('תיאור המוצר', product.description))
  const dossier = DOSSIER_FIELDS.map((f) => (product.dossier?.[f.key] ? `**${f.label}:**\n${product.dossier[f.key]}` : null))
    .filter(Boolean)
    .join('\n\n')
  parts.push(block('תיק מוצר (המידע המאומת היחיד על המוצר)', dossier || 'תיק המוצר ריק — אין מידע מאומת על המוצר.'))

  if (ctx.preferences.length) {
    const prefs = ctx.preferences
      .map((p) => `- [${PREFERENCE_CATEGORIES[p.category as keyof typeof PREFERENCE_CATEGORIES]}${p.brand_id ? ' · למותג זה' : ''}] ${p.title}: ${p.content}`)
      .join('\n')
    parts.push(block('העדפות ושיטות העבודה שלנו', prefs))
  }

  parts.push(
    block(
      'הקריאייטיב',
      `שם: ${creative.name}\nזווית: ${creative.angle || '(לא הוגדרה)'}\nסטטוס: ${STATUS_LABELS[creative.status as keyof typeof STATUS_LABELS]}`,
    ),
  )

  if (opts.includeResearch !== false) {
    const research = RESEARCH_SECTIONS.map((s) => {
      const items = snapshot.research[s.key] ?? []
      if (!items.length) return `**${s.label}:** (ריק)`
      return `**${s.label}:**\n${items.map((i) => `- [${PROVENANCE_LABELS[i.provenance]}] ${i.text}${i.source ? ` (מקור: ${i.source})` : ''}`).join('\n')}`
    }).join('\n')
    parts.push(block('חקר לקוח של הקריאייטיב', research))
  }

  if (opts.includeScript !== false) {
    const hooks = snapshot.hooks
      .map((h, i) => `הוק ${i + 1}${h.id === ctx.selectedHookId ? ' (נבחר)' : ''}: ${h.text || '(ריק)'}`)
      .join('\n')
    parts.push(
      block(
        'התסריט הנוכחי',
        `[הוקים — רק ההוק משתנה בין הווריאציות]\n${hooks}\n\n[ליד]\n${snapshot.lead || '(ריק)'}\n\n[גוף]\n${snapshot.body || '(ריק)'}\n\n[קריאה לפעולה]\n${snapshot.cta || '(ריק)'}\n\n[הוראות צילום — לא מוקרא]\n${snapshot.shooting || '(ריק)'}`,
      ),
    )
  }
  return parts.join('\n\n')
}

export const BASE_RULES = `
You are a senior direct-response copywriter and thinking partner for a two-person team writing
video ad scripts (UGC / talking-head style) for e-commerce brands, tested on Meta with several hooks.
Always answer in Hebrew (keep English product names, links and numbers as-is).

Script structure: several HOOKS (only the hook varies between variations), then ONE shared LEAD, ONE BODY and ONE CTA.
Shooting instructions are separate and are never read aloud.

Hard rules:
- The product dossier is the only verified information about the product. Never invent product facts,
  ingredients, results, prices, guarantees, studies, statistics, reviews, customer quotes or sources.
  If something important is missing, say so and ask, or write a clearly marked placeholder like [להשלים: ...].
- Never present an example sentence as a real customer quote. Phrases you invent are examples/hypotheses.
- Flag unsupported claims in our text instead of reinforcing them.
- Be concise. When you propose a change, explain in one or two short sentences why.
- Respect the team's saved preferences and things to avoid.
- You have no access to anything outside this context (not ChatGPT history, not the web, not ad accounts).
`.trim()
