// Schema of the per-creative Yjs document, shared by the server and the browser.
//
// Top-level types (merged by name, so concurrent creation never conflicts):
//   'hooks'              Y.Map<hookId, Y.Map{ order, deleted, createdAt, createdBy }>
//   'hook:<id>'          Y.XmlFragment — text of one hook
//   'lead' | 'body' | 'cta' | 'shooting'   Y.XmlFragment — shared by every hook variation
//   'research:<section>' Y.Array<Y.Map{ id, text, provenance, source, createdAt }>
//
// Lead/body/CTA are stored once; only hooks vary. Text fragments use the ProseMirror
// node layout (paragraph > text) so TipTap editors bind to them directly.
import * as Y from 'yjs'
import { RESEARCH_KEYS, type Provenance, type ResearchSection } from './constants'

export const SHARED_FIELDS = ['lead', 'body', 'cta', 'shooting'] as const
export type SharedField = (typeof SHARED_FIELDS)[number]

export interface HookInfo {
  id: string
  order: number
  deleted: boolean
  createdAt: number
}

export interface ResearchItem {
  id: string
  text: string
  provenance: Provenance
  source: string
}

export interface ScriptSnapshot {
  hooks: { id: string; text: string }[]
  lead: string
  body: string
  cta: string
  shooting: string
}

export interface FullSnapshot extends ScriptSnapshot {
  research: Record<string, ResearchItem[]>
}

export const hookFieldName = (id: string) => `hook:${id}`

export function newId(): string {
  return globalThis.crypto.randomUUID().slice(0, 12)
}

// ---------- text <-> fragment ----------

type Node = Y.XmlElement | Y.XmlText | Y.XmlHook

function inlineText(node: Node): string {
  if (node instanceof Y.XmlText) {
    return node
      .toDelta()
      .map((d: { insert: unknown }) => (typeof d.insert === 'string' ? d.insert : ''))
      .join('')
  }
  if (node instanceof Y.XmlElement) {
    if (node.nodeName === 'hardBreak') return '\n'
    const children = node.toArray() as Node[]
    const isInline = children.every((c) => c instanceof Y.XmlText || (c instanceof Y.XmlElement && c.nodeName === 'hardBreak'))
    if (isInline) return children.map(inlineText).join('')
    return children.map(inlineText).join('\n')
  }
  return ''
}

export function fragmentToText(fragment: Y.XmlFragment): string {
  return (fragment.toArray() as Node[]).map(inlineText).join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function paragraphsFromText(text: string): Y.XmlElement[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n')
  return lines.map((line) => {
    const p = new Y.XmlElement('paragraph')
    if (line.length) {
      const t = new Y.XmlText()
      t.insert(0, line)
      p.insert(0, [t])
    }
    return p
  })
}

/**
 * Gives an empty field its first paragraph AND an (empty) shared text node up front. Without them,
 * two people typing into an empty field at the same moment would each create their own paragraph /
 * text node, and the editor binding could then duplicate or drop the first characters. With a
 * shared text node both edits go into the same CRDT text and merge character by character.
 */
export function ensureParagraph(fragment: Y.XmlFragment) {
  if (fragment.length === 0) {
    const p = new Y.XmlElement('paragraph')
    p.insert(0, [new Y.XmlText()])
    fragment.insert(0, [p])
  }
}

/** Replaces the whole fragment with plain-text paragraphs. Call inside a transaction. */
export function setFragmentText(fragment: Y.XmlFragment, text: string) {
  if (fragment.length) fragment.delete(0, fragment.length)
  if (text.trim().length) fragment.insert(0, paragraphsFromText(text.trim()))
  else ensureParagraph(fragment)
}

/** Replaces the content of `dst` with a deep copy of `src` (keeps formatting). */
export function copyFragment(src: Y.XmlFragment, dst: Y.XmlFragment) {
  if (dst.length) dst.delete(0, dst.length)
  const clones = (src.toArray() as Node[]).map((n) => n.clone() as Y.XmlElement | Y.XmlText)
  if (clones.length) dst.insert(0, clones)
  else ensureParagraph(dst)
}

// ---------- hooks ----------

export function hooksMap(doc: Y.Doc) {
  return doc.getMap<Y.Map<unknown>>('hooks')
}

export function listHooks(doc: Y.Doc, opts: { includeDeleted?: boolean } = {}): HookInfo[] {
  const out: HookInfo[] = []
  hooksMap(doc).forEach((m, id) => {
    const info: HookInfo = {
      id,
      order: Number(m.get('order') ?? 0),
      deleted: Boolean(m.get('deleted')),
      createdAt: Number(m.get('createdAt') ?? 0),
    }
    if (opts.includeDeleted || !info.deleted) out.push(info)
  })
  return out.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

export function hookFragment(doc: Y.Doc, id: string) {
  return doc.getXmlFragment(hookFieldName(id))
}

/** Order value placing a hook right after `afterId` (or at the end). Fractional ordering. */
function orderAfter(doc: Y.Doc, afterId?: string): number {
  const hooks = listHooks(doc)
  if (!hooks.length) return 1
  if (!afterId) return hooks[hooks.length - 1].order + 1
  const idx = hooks.findIndex((h) => h.id === afterId)
  if (idx === -1 || idx === hooks.length - 1) return hooks[hooks.length - 1].order + 1
  return (hooks[idx].order + hooks[idx + 1].order) / 2
}

export function addHook(doc: Y.Doc, opts: { text?: string; afterId?: string; copyFrom?: string; createdBy?: string } = {}): string {
  const id = newId()
  doc.transact(() => {
    const m = new Y.Map<unknown>()
    m.set('order', orderAfter(doc, opts.afterId))
    m.set('deleted', false)
    m.set('createdAt', Date.now())
    if (opts.createdBy) m.set('createdBy', opts.createdBy)
    hooksMap(doc).set(id, m)
    if (opts.copyFrom) copyFragment(hookFragment(doc, opts.copyFrom), hookFragment(doc, id))
    else setFragmentText(hookFragment(doc, id), opts.text ?? '')
  })
  return id
}

/** Soft delete so it can be undone (and so concurrent edits on the deleted hook are not lost). */
export function setHookDeleted(doc: Y.Doc, id: string, deleted: boolean) {
  hooksMap(doc).get(id)?.set('deleted', deleted)
}

export function moveHook(doc: Y.Doc, id: string, direction: -1 | 1) {
  const hooks = listHooks(doc)
  const idx = hooks.findIndex((h) => h.id === id)
  const target = idx + direction
  if (idx === -1 || target < 0 || target >= hooks.length) return
  // Swap order values with the neighbour.
  doc.transact(() => {
    const a = hooksMap(doc).get(hooks[idx].id)!
    const b = hooksMap(doc).get(hooks[target].id)!
    const ao = hooks[idx].order
    const bo = hooks[target].order
    a.set('order', ao === bo ? bo + direction * 0.5 : bo)
    b.set('order', ao)
  })
}

// ---------- research ----------

export function researchArray(doc: Y.Doc, section: ResearchSection) {
  return doc.getArray<Y.Map<unknown>>(`research:${section}`)
}

export function researchItems(doc: Y.Doc, section: ResearchSection): ResearchItem[] {
  return researchArray(doc, section)
    .toArray()
    .map((m) => ({
      id: String(m.get('id')),
      text: String(m.get('text') ?? ''),
      provenance: (m.get('provenance') as Provenance) ?? 'user',
      source: String(m.get('source') ?? ''),
    }))
}

export function addResearchItem(doc: Y.Doc, section: ResearchSection, item: Omit<ResearchItem, 'id'>) {
  const m = new Y.Map<unknown>()
  m.set('id', newId())
  m.set('text', item.text)
  m.set('provenance', item.provenance)
  m.set('source', item.source)
  m.set('createdAt', Date.now())
  researchArray(doc, section).push([m])
}

// ---------- snapshots ----------

export function scriptSnapshot(doc: Y.Doc): ScriptSnapshot {
  return {
    hooks: listHooks(doc).map((h) => ({ id: h.id, text: fragmentToText(hookFragment(doc, h.id)) })),
    lead: fragmentToText(doc.getXmlFragment('lead')),
    body: fragmentToText(doc.getXmlFragment('body')),
    cta: fragmentToText(doc.getXmlFragment('cta')),
    shooting: fragmentToText(doc.getXmlFragment('shooting')),
  }
}

export function fullSnapshot(doc: Y.Doc): FullSnapshot {
  const research: Record<string, ResearchItem[]> = {}
  for (const key of RESEARCH_KEYS) research[key] = researchItems(doc, key)
  return { ...scriptSnapshot(doc), research }
}

/**
 * The spoken script for one hook: hook + lead + body + CTA.
 * Excludes shooting notes, research, comments and other hooks.
 */
export function combinedScript(snap: Pick<ScriptSnapshot, 'hooks' | 'lead' | 'body' | 'cta'>, hookId?: string | null): string {
  const hook = snap.hooks.find((h) => h.id === hookId) ?? snap.hooks[0]
  return [hook?.text ?? '', snap.lead, snap.body, snap.cta]
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n\n')
}

/** Normalised text used to detect substantive script changes (whitespace-only edits ignored). */
export function contentFingerprint(snap: ScriptSnapshot): string {
  const norm = (s: string) => s.replace(/\s+/g, ' ').trim()
  return JSON.stringify({
    hooks: snap.hooks.map((h) => norm(h.text)).filter(Boolean),
    lead: norm(snap.lead),
    body: norm(snap.body),
    cta: norm(snap.cta),
  })
}

export function plainTextForSearch(snap: ScriptSnapshot): string {
  return [...snap.hooks.map((h) => h.text), snap.lead, snap.body, snap.cta].join('\n').slice(0, 20000)
}

// ---------- whole-document helpers (server side mostly) ----------

export interface InitialContent {
  hooks?: string[]
  lead?: string
  body?: string
  cta?: string
  shooting?: string
}

export function initDoc(doc: Y.Doc, content: InitialContent = {}) {
  doc.transact(() => {
    const hooks = content.hooks?.length ? content.hooks : ['']
    for (const text of hooks) addHook(doc, { text })
    for (const f of SHARED_FIELDS) setFragmentText(doc.getXmlFragment(f), content[f] ?? '')
  })
}

/**
 * Copies script content (and optionally research) from `src` into `dst`, which may be a live
 * document. Hooks present in dst but not in src are soft-deleted; nothing is hard-deleted.
 */
export function copyScript(src: Y.Doc, dst: Y.Doc, opts: { includeResearch?: boolean; onlyHookIds?: string[] } = {}) {
  dst.transact(() => {
    const srcHooks = listHooks(src).filter((h) => !opts.onlyHookIds || opts.onlyHookIds.includes(h.id))
    const keep = new Set(srcHooks.map((h) => h.id))
    for (const h of listHooks(dst)) if (!keep.has(h.id)) setHookDeleted(dst, h.id, true)
    for (const h of srcHooks) {
      let m = hooksMap(dst).get(h.id)
      if (!m) {
        m = new Y.Map<unknown>()
        hooksMap(dst).set(h.id, m)
        m.set('createdAt', h.createdAt || Date.now())
      }
      m.set('order', h.order)
      m.set('deleted', false)
      copyFragment(hookFragment(src, h.id), hookFragment(dst, h.id))
    }
    for (const f of SHARED_FIELDS) copyFragment(src.getXmlFragment(f), dst.getXmlFragment(f))
    if (opts.includeResearch) {
      for (const key of RESEARCH_KEYS) {
        const arr = researchArray(dst, key)
        if (arr.length) arr.delete(0, arr.length)
        for (const item of researchItems(src, key)) {
          const { id: _id, ...rest } = item
          addResearchItem(dst, key, rest)
        }
      }
    }
  })
}
