// AI: research conversation, assistant conversation, proactive review, suggestions, short versions.
import { createHash } from 'node:crypto'
import { Router } from 'express'
import * as Y from 'yjs'
import { z } from 'zod'
import { RESEARCH_KEYS, PROVENANCE } from '../../shared/constants'
import { countWords, wordsForSeconds, PACES, type Pace } from '../../shared/readingTime'
import { addHook, combinedScript, fragmentToText, hookFragment, hooksMap, initDoc, setFragmentText, addResearchItem, contentFingerprint } from '../../shared/script'
import { checkId, getCreative } from '../access'
import { logActivity } from '../activity'
import { callStructured } from '../ai/client'
import { BASE_RULES, loadCreativeContext, renderContext } from '../ai/context'
import { aiConfigured, config } from '../config'
import { one, q, tx } from '../db'
import { insertNewDoc, mutateCreativeDoc, readCreativeDoc, saveVersion } from '../docs'
import { badRequest, conflict, HttpError, notFound } from '../errors'
import { rateLimit } from '../rateLimit'

export const aiRouter = Router()

const inFlight = new Set<string>()
async function exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
  if (inFlight.has(key)) throw conflict('בקשה קודמת עדיין בטיפול — רגע אחד')
  inFlight.add(key)
  try {
    return await fn()
  } finally {
    inFlight.delete(key)
  }
}

function limitAi(userId: string) {
  const r = rateLimit(`ai:${userId}`, 40, 10 * 60_000)
  if (!r.ok) throw new HttpError(429, `הגעתם למגבלת בקשות ה-AI. נסו שוב בעוד ${r.retryAfterSec} שניות`, 'rate_limited')
}

aiRouter.get('/ai/status', (_req, res) => {
  res.json({ configured: aiConfigured(), model: config.openaiModel })
})

async function getThread(creativeId: string, kind: 'assistant' | 'research') {
  const t = await one<{ id: string }>(
    `INSERT INTO ai_threads (creative_id, kind) VALUES ($1, $2)
       ON CONFLICT (creative_id, kind) DO UPDATE SET kind = EXCLUDED.kind RETURNING id`,
    [creativeId, kind],
  )
  return t!.id
}

async function threadMessages(threadId: string, limit = 200) {
  return q(
    `SELECT * FROM (
       SELECT m.id, m.role, m.content, m.payload, m.created_at, m.user_id, u.name AS user_name, u.color AS user_color
         FROM ai_messages m LEFT JOIN users u ON u.id = m.user_id
        WHERE m.thread_id = $1 ORDER BY m.created_at DESC LIMIT $2) t ORDER BY created_at`,
    [threadId, limit],
  )
}

const kindParam = z.enum(['assistant', 'research'])

aiRouter.get('/creatives/:id/ai/:kind', async (req, res) => {
  const creative = await getCreative(req.user!, req.params.id)
  const kind = kindParam.parse(req.params.kind)
  const threadId = await getThread(creative.id, kind)
  const messages = await threadMessages(threadId)
  res.json({ messages })
})

// ---------- schemas (strict structured outputs: every field required, use nullable/empty) ----------

const SuggestionSchema = z.object({
  kind: z.enum(['new_hook', 'rewrite', 'note']),
  target: z.enum(['selected_hook', 'lead', 'body', 'cta', 'none']),
  text: z.string().describe('For new_hook/rewrite: the full proposed text. For note: the observation.'),
  reason: z.string().describe('One or two short sentences explaining why, in Hebrew.'),
})

const AssistantSchema = z.object({
  reply: z.string().describe('Conversational answer in Hebrew. Markdown-light, short paragraphs.'),
  suggestions: z.array(SuggestionSchema).describe('Concrete proposed edits. Empty if none fit.'),
})

const ResearchSchema = z.object({
  reply: z.string().describe('Short Hebrew reply: reflect what you understood, then ask 1-2 focused next questions.'),
  updates: z
    .array(
      z.object({
        section: z.enum(RESEARCH_KEYS as [string, ...string[]]),
        text: z.string(),
        provenance: z.enum(PROVENANCE),
        source: z.string().describe('Source title/link if the user provided one, else empty string.'),
      }),
    )
    .describe('Structured research items extracted from the conversation.'),
  suggested_angle: z.string().nullable().describe('A concise angle if one emerged, else null.'),
})

const ReviewSchema = z.object({
  findings: z
    .array(
      SuggestionSchema.extend({
        issue: z.enum(['repetition', 'logic_gap', 'generic', 'unsupported_claim', 'open_loop', 'weak_hook', 'other']),
      }),
    )
    .describe('At most 3 high-value findings. Empty if the script is fine.'),
})

const ShortSchema = z.object({
  hooks: z.array(z.string()).describe('Shortened hooks. First = the selected hook. Others only if requested.'),
  lead: z.string(),
  body: z.string(),
  cta: z.string(),
  shooting: z.string().describe('Shooting notes adapted to the shorter script, or empty.'),
  notes: z.string().describe('What was cut and why, in Hebrew, 1-3 sentences.'),
})

// ---------- conversation ----------

const ASSISTANT_INSTRUCTIONS = `${BASE_RULES}

Mode: on-demand assistant inside the script editor.
You can: suggest angles and ideas, sharpen research, propose hooks, improve lead/body/CTA,
propose opening and closing loops, and point out repetition, logic jumps, generic messaging and unsupported claims.
When you propose concrete text, put it in "suggestions" (not only in the reply):
- new hook → kind "new_hook", target "none".
- rewrite of an existing part → kind "rewrite", target = selected_hook / lead / body / cta, with the FULL new text of that part.
- observation without text → kind "note".
The team approves every change manually.`

const RESEARCH_INSTRUCTIONS = `${BASE_RULES}

Mode: customer-research interview for THIS creative (and idea development when the creative is new).
Ask questions gradually — one or two at a time — about audience & situation, core problem, desired outcome,
pains/fears/frustrations, solutions already tried, purchase objections, the audience's own language, and the chosen angle & message.
After each user answer, extract structured items into "updates":
- provenance "user": the user stated it.
- provenance "sourced": the user gave a source (put it in "source").
- provenance "hypothesis": your inference that still needs checking.
- provenance "ai_example": example phrasing you wrote — never present it as a real quote.
Put unanswered important questions in section "open_questions". Do not repeat items that already exist in the research.`

aiRouter.post('/creatives/:id/ai/:kind', async (req, res) => {
  const creative = await getCreative(req.user!, req.params.id)
  const kind = kindParam.parse(req.params.kind)
  const body = z
    .object({ message: z.string().trim().min(1, 'ההודעה ריקה').max(8000), hookId: z.string().max(40).nullable().optional() })
    .parse(req.body)
  limitAi(req.user!.id)
  const threadId = await getThread(creative.id, kind)

  const result = await exclusive(`thread:${threadId}`, async () => {
    const userMsg = await one<{ id: string }>(
      `INSERT INTO ai_messages (thread_id, role, user_id, content) VALUES ($1, 'user', $2, $3) RETURNING id`,
      [threadId, req.user!.id, body.message],
    )
    try {
      const ctx = await loadCreativeContext(creative, body.hookId)
      const history = await threadMessages(threadId, 30)
      const input = history.map((m: any) => ({
        role: m.role as 'user' | 'assistant',
        content: m.role === 'user' ? `${m.user_name ?? 'משתמש'}: ${m.content}` : m.content,
      }))
      const instructions = `${kind === 'assistant' ? ASSISTANT_INSTRUCTIONS : RESEARCH_INSTRUCTIONS}

Messages come from two team members; each user message starts with the author's name.

# Workspace context (current, read from the server)
${renderContext(ctx)}`

      if (kind === 'assistant') {
        const out = await callStructured({ instructions, input, schema: AssistantSchema, schemaName: 'assistant_reply' })
        const msg = await one<any>(
          `INSERT INTO ai_messages (thread_id, role, content, payload) VALUES ($1, 'assistant', $2, $3) RETURNING id, role, content, payload, created_at`,
          [threadId, out.reply, { suggestionCount: out.suggestions.length }],
        )
        const suggestions = await insertSuggestions(creative.id, msg.id, 'chat', out.suggestions, ctx)
        return { message: msg, suggestions }
      } else {
        const out = await callStructured({ instructions, input, schema: ResearchSchema, schemaName: 'research_reply' })
        const updates = out.updates.map((u, i) => ({ ...u, index: i, applied: false }))
        const msg = await one<any>(
          `INSERT INTO ai_messages (thread_id, role, content, payload) VALUES ($1, 'assistant', $2, $3) RETURNING id, role, content, payload, created_at`,
          [threadId, out.reply, { updates, suggested_angle: out.suggested_angle }],
        )
        return { message: msg }
      }
    } catch (e) {
      // Don't leave an unanswered message behind; the client keeps the text for a retry.
      await q('DELETE FROM ai_messages WHERE id = $1', [userMsg!.id])
      throw e
    }
  })
  res.json(result)
})

/** Marks research items from an AI message as added (the client writes them into the shared document). */
aiRouter.post('/ai/messages/:mid/research-applied', async (req, res) => {
  checkId(req.params.mid, 'ההודעה')
  const body = z.object({ indexes: z.array(z.number().int().min(0)).min(1) }).parse(req.body)
  const m = await one<any>(
    `SELECT m.*, t.creative_id FROM ai_messages m JOIN ai_threads t ON t.id = m.thread_id JOIN creatives c ON c.id = t.creative_id
      WHERE m.id = $1 AND c.workspace_id = $2`,
    [req.params.mid, req.user!.workspaceId],
  )
  if (!m) throw notFound('ההודעה')
  const payload = m.payload ?? {}
  for (const i of body.indexes) if (payload.updates?.[i]) payload.updates[i].applied = true
  await q('UPDATE ai_messages SET payload = $2 WHERE id = $1', [m.id, payload])
  await logActivity({ workspaceId: req.user!.workspaceId, userId: req.user!.id, creativeId: m.creative_id, action: 'ai.research_applied', details: { count: body.indexes.length } })
  res.json({ ok: true, payload })
})

/** Server-side add of research items (used by "add all"), applied to the live shared document. */
aiRouter.post('/creatives/:id/research-items', async (req, res) => {
  const creative = await getCreative(req.user!, req.params.id)
  const body = z
    .object({
      items: z
        .array(z.object({ section: z.enum(RESEARCH_KEYS as [string, ...string[]]), text: z.string().min(1).max(4000), provenance: z.enum(PROVENANCE), source: z.string().max(1000) }))
        .min(1)
        .max(50),
    })
    .parse(req.body)
  await mutateCreativeDoc(creative.id, req.user!.id, (doc) => {
    for (const it of body.items) addResearchItem(doc, it.section as any, { text: it.text, provenance: it.provenance, source: it.source })
  })
  res.json({ ok: true })
})

// ---------- suggestions ----------

type RawSuggestion = z.infer<typeof SuggestionSchema>

async function insertSuggestions(
  creativeId: string,
  messageId: string | null,
  origin: 'chat' | 'proactive',
  items: RawSuggestion[],
  ctx: Awaited<ReturnType<typeof loadCreativeContext>>,
) {
  const out = []
  for (const s of items) {
    let target: string | null = null
    let baseText: string | null = null
    let kind = s.kind
    if (kind === 'rewrite') {
      if (s.target === 'selected_hook' && ctx.selectedHookId) {
        target = `hook:${ctx.selectedHookId}`
        baseText = ctx.snapshot.hooks.find((h) => h.id === ctx.selectedHookId)?.text ?? ''
      } else if (s.target === 'lead' || s.target === 'body' || s.target === 'cta') {
        target = s.target
        baseText = ctx.snapshot[s.target]
      } else kind = 'note'
    }
    // Remember exactly what the AI saw, so an outdated suggestion can never silently replace newer text.
    const row = await one(
      `INSERT INTO ai_suggestions (creative_id, message_id, origin, kind, target, base_text, text, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [creativeId, messageId, origin, kind, target, baseText, s.text, s.reason],
    )
    out.push(row)
  }
  return out
}

aiRouter.get('/creatives/:id/suggestions', async (req, res) => {
  const creative = await getCreative(req.user!, req.params.id)
  const rows = await q(
    `SELECT s.*, u.name AS resolved_by_name FROM ai_suggestions s LEFT JOIN users u ON u.id = s.resolved_by
      WHERE s.creative_id = $1 ORDER BY s.created_at DESC LIMIT 100`,
    [creative.id],
  )
  res.json(rows)
})

async function getSuggestion(user: { workspaceId: string }, id: string) {
  checkId(id, 'ההצעה')
  const s = await one<any>(
    `SELECT s.* FROM ai_suggestions s JOIN creatives c ON c.id = s.creative_id WHERE s.id = $1 AND c.workspace_id = $2 AND c.archived_at IS NULL`,
    [id, user.workspaceId],
  )
  if (!s) throw notFound('ההצעה')
  if (s.status !== 'pending') throw conflict('ההצעה כבר טופלה')
  return s
}

function fragmentFor(doc: Y.Doc, target: string) {
  if (target.startsWith('hook:')) {
    const id = target.slice(5)
    const meta = hooksMap(doc).get(id)
    if (!meta || meta.get('deleted')) return null
    return hookFragment(doc, id)
  }
  return doc.getXmlFragment(target)
}

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

/** Applies a rewrite only if the target text is still exactly what the AI saw. */
aiRouter.post('/suggestions/:sid/apply', async (req, res) => {
  const s = await getSuggestion(req.user!, req.params.sid)
  if (s.kind !== 'rewrite' || !s.target) throw badRequest('אפשר להחיל רק הצעת שכתוב')
  const before = await readCreativeDoc(s.creative_id)
  await saveVersion(s.creative_id, before, 'ai_applied', req.user!.id, 'לפני החלת הצעת AI')
  let outcome: 'ok' | 'stale' | 'missing' = 'ok'
  await mutateCreativeDoc(s.creative_id, req.user!.id, (doc) => {
    // Check and write in the same transaction so nothing can slip in between.
    const frag = fragmentFor(doc, s.target)
    if (!frag) return void (outcome = 'missing')
    if (norm(fragmentToText(frag)) !== norm(s.base_text ?? '')) return void (outcome = 'stale')
    setFragmentText(frag, s.text)
  })
  if (outcome !== 'ok') {
    res.status(409).json({
      code: outcome,
      error:
        outcome === 'stale'
          ? 'הטקסט השתנה מאז שההצעה נוצרה, ולכן היא לא הוחלה. אפשר להוסיף אותה כהוק, להעתיק אותה או לבקש הצעה חדשה.'
          : 'החלק שאליו ההצעה מתייחסת כבר לא קיים.',
    })
    return
  }
  await q(`UPDATE ai_suggestions SET status = 'applied', resolved_by = $2, resolved_at = now() WHERE id = $1`, [s.id, req.user!.id])
  await logActivity({ workspaceId: req.user!.workspaceId, userId: req.user!.id, creativeId: s.creative_id, action: 'ai.suggestion_applied', details: { target: s.target, origin: s.origin } })
  res.json({ ok: true })
})

aiRouter.post('/suggestions/:sid/add-as-hook', async (req, res) => {
  const s = await getSuggestion(req.user!, req.params.sid)
  const body = z.object({ afterHookId: z.string().max(40).nullable().optional() }).parse(req.body ?? {})
  let hookId = ''
  await mutateCreativeDoc(s.creative_id, req.user!.id, (doc) => {
    hookId = addHook(doc, { text: s.text, afterId: body.afterHookId ?? undefined, createdBy: req.user!.id })
  })
  await q(`UPDATE ai_suggestions SET status = 'added_as_hook', resolved_by = $2, resolved_at = now() WHERE id = $1`, [s.id, req.user!.id])
  await logActivity({ workspaceId: req.user!.workspaceId, userId: req.user!.id, creativeId: s.creative_id, action: 'ai.hook_added', details: { origin: s.origin } })
  res.json({ ok: true, hookId })
})

aiRouter.post('/suggestions/:sid/reject', async (req, res) => {
  const s = await getSuggestion(req.user!, req.params.sid)
  await q(`UPDATE ai_suggestions SET status = 'rejected', resolved_by = $2, resolved_at = now() WHERE id = $1`, [s.id, req.user!.id])
  res.json({ ok: true })
})

// ---------- proactive review ----------

const REVIEW_INSTRUCTIONS = `${BASE_RULES}

Mode: quiet proactive review while the team is writing. Return at most 3 findings, only ones that clearly matter:
repetition, logic jumps, generic messaging, unsupported claims (vs. the dossier), open loops that never close,
or a weak hook. Prefer "note" unless you have a clearly better full rewrite of one part. If the script is fine
or still too early to judge, return an empty list.`

aiRouter.post('/creatives/:id/ai-review', async (req, res) => {
  const creative = await getCreative(req.user!, req.params.id)
  const body = z.object({ hookId: z.string().max(40).nullable().optional() }).parse(req.body ?? {})
  if (!aiConfigured()) return void res.json({ skipped: 'not_configured' })
  const ctx = await loadCreativeContext(creative, body.hookId)
  const script = combinedScript(ctx.snapshot, ctx.selectedHookId)
  if (countWords(script) < 25) return void res.json({ skipped: 'too_short' })
  // Skip identical content — no duplicate requests for a script we already reviewed.
  const hash = createHash('sha256').update(contentFingerprint(ctx.snapshot) + '|' + ctx.selectedHookId).digest('hex')
  const prev = await one<{ last_hash: string; last_at: Date }>('SELECT last_hash, last_at FROM ai_checks WHERE creative_id = $1', [creative.id])
  if (prev?.last_hash === hash) return void res.json({ skipped: 'unchanged' })
  if (prev && Date.now() - new Date(prev.last_at).getTime() < 60_000) return void res.json({ skipped: 'too_soon' })
  const r = rateLimit(`ai-review:${creative.id}`, 1, 60_000)
  if (!r.ok) return void res.json({ skipped: 'too_soon' })

  const out = await exclusive(`review:${creative.id}`, async () => {
    await q(
      `INSERT INTO ai_checks (creative_id, last_hash, last_at) VALUES ($1, $2, now())
         ON CONFLICT (creative_id) DO UPDATE SET last_hash = EXCLUDED.last_hash, last_at = now()`,
      [creative.id, hash],
    )
    const result = await callStructured({
      instructions: `${REVIEW_INSTRUCTIONS}\n\n# Workspace context\n${renderContext(ctx)}`,
      input: [{ role: 'user', content: 'סקור את התסריט הנוכחי (ההוק הנבחר + ליד + גוף + קריאה לפעולה).' }],
      schema: ReviewSchema,
      schemaName: 'script_review',
    })
    // Older unresolved proactive suggestions are superseded by the new review.
    await q(`UPDATE ai_suggestions SET status = 'dismissed' WHERE creative_id = $1 AND origin = 'proactive' AND status = 'pending'`, [creative.id])
    return insertSuggestions(creative.id, null, 'proactive', result.findings.slice(0, 3), ctx)
  })
  res.json({ suggestions: out })
})

// ---------- short version ----------

const SHORT_INSTRUCTIONS = `${BASE_RULES}

Mode: create a SHORTER version of the script. Keep the core idea, angle and message, the strongest proof points and the CTA.
Cut repetition and secondary points first. Do not add new claims. Keep the hook/lead/body/CTA structure.
Hit the requested word budget as closely as reasonable (it's an estimate of read time, not a guarantee).`

aiRouter.post('/creatives/:id/short', async (req, res) => {
  const creative = await getCreative(req.user!, req.params.id)
  const body = z
    .object({
      targetSeconds: z.number().int().min(5).max(600).nullable().optional(),
      freeTarget: z.string().trim().max(200).nullable().optional(),
      pace: z.enum(Object.keys(PACES) as [Pace, ...Pace[]]).default('normal'),
      hookId: z.string().max(40).nullable().optional(),
      includeOtherHooks: z.boolean().default(false),
    })
    .parse(req.body)
  if (!body.targetSeconds && !body.freeTarget) throw badRequest('יש לבחור יעד זמן או יעד אורך')
  limitAi(req.user!.id)

  const created = await exclusive(`short:${creative.id}`, async () => {
    const ctx = await loadCreativeContext(creative, body.hookId)
    const selected = ctx.snapshot.hooks.find((h) => h.id === ctx.selectedHookId)
    const others = ctx.snapshot.hooks.filter((h) => h.id !== ctx.selectedHookId && h.text.trim())
    const currentWords = countWords(combinedScript(ctx.snapshot, ctx.selectedHookId))
    const target = body.targetSeconds
      ? `יעד: כ-${body.targetSeconds} שניות בקצב ${PACES[body.pace].label} ≈ ${wordsForSeconds(body.targetSeconds, body.pace)} מילים בסך הכול (הוק נבחר + ליד + גוף + קריאה לפעולה). כרגע: ${currentWords} מילים.`
      : `יעד אורך: ${body.freeTarget}. כרגע: ${currentWords} מילים.`
    const hooksReq = body.includeOtherHooks && others.length
      ? `קצר את ההוק הנבחר (ראשון ברשימה) וגם את ${others.length} ההוקים האחרים כחלופות, באותו סדר:\n${[selected, ...others].map((h, i) => `${i + 1}. ${h?.text ?? ''}`).join('\n')}`
      : `קצר רק את ההוק הנבחר: ${selected?.text || '(ריק)'}`
    const result = await callStructured({
      instructions: `${SHORT_INSTRUCTIONS}\n\n# Workspace context\n${renderContext(ctx, { includeResearch: true })}`,
      input: [{ role: 'user', content: `${target}\n${hooksReq}` }],
      schema: ShortSchema,
      schemaName: 'short_version',
    })
    const doc = new Y.Doc()
    initDoc(doc, {
      hooks: result.hooks.filter((h) => h.trim()).slice(0, body.includeOtherHooks ? 20 : 1),
      lead: result.lead,
      body: result.body,
      cta: result.cta,
      shooting: result.shooting,
    })
    const label = body.targetSeconds ? `${body.targetSeconds} שנ׳` : body.freeTarget!
    return tx(async (c) => {
      const row = (
        await c.query(
          `INSERT INTO creatives (workspace_id, product_id, name, angle, created_by, source_creative_id, source_kind, short_target, status)
           VALUES ($1, $2, $3, $4, $5, $6, 'short', $7, 'writing') RETURNING *`,
          [creative.workspace_id, creative.product_id, `${creative.name} — גרסה קצרה (${label})`, creative.angle, req.user!.id, creative.id, label],
        )
      ).rows[0]
      await insertNewDoc(c, row.id, doc, req.user!.id)
      return { creative: row, notes: result.notes }
    })
  })
  await logActivity({
    workspaceId: req.user!.workspaceId,
    userId: req.user!.id,
    creativeId: created.creative.id,
    productId: creative.product_id,
    action: 'ai.short_version_created',
    details: { sourceId: creative.id, target: created.creative.short_target, notes: created.notes },
  })
  await logActivity({
    workspaceId: req.user!.workspaceId,
    userId: req.user!.id,
    creativeId: creative.id,
    action: 'creative.short_version_derived',
    details: { newId: created.creative.id, target: created.creative.short_target },
  })
  res.status(201).json(created)
})

