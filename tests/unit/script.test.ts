import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { countWords, estimateSeconds, PACES } from '../../shared/readingTime'
import {
  addHook, combinedScript, contentFingerprint, copyScript, fragmentToText, hookFragment, initDoc, listHooks, moveHook,
  scriptSnapshot, setFragmentText, setHookDeleted, addResearchItem, researchItems,
} from '../../shared/script'

function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a, Y.encodeStateVector(b)))
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b, Y.encodeStateVector(a)))
}

describe('reading time', () => {
  it('counts Hebrew, English and numbers as words', () => {
    expect(countWords('שלום לכם, this is 30% off!')).toBe(6)
    expect(countWords('')).toBe(0)
  })
  it('uses the central pace table', () => {
    expect(estimateSeconds(PACES.normal.wpm, 'normal')).toBe(60)
    expect(estimateSeconds(150, 'fast')).toBeLessThan(estimateSeconds(150, 'slow'))
  })
})

describe('script document', () => {
  it('stores lead/body/CTA once and varies only the hook', () => {
    const doc = new Y.Doc()
    initDoc(doc, { hooks: ['הוק ראשון', 'הוק שני'], lead: 'ליד', body: 'גוף', cta: 'קנו עכשיו', shooting: 'צילום במטבח' })
    const snap = scriptSnapshot(doc)
    const [h1, h2] = snap.hooks
    expect(combinedScript(snap, h1.id)).toBe('הוק ראשון\n\nליד\n\nגוף\n\nקנו עכשיו')
    expect(combinedScript(snap, h2.id)).toBe('הוק שני\n\nליד\n\nגוף\n\nקנו עכשיו')
    // Shooting notes are never part of the spoken script.
    expect(combinedScript(snap, h1.id)).not.toContain('צילום')
  })

  it('read time counts only selected hook + lead + body + CTA', () => {
    const doc = new Y.Doc()
    initDoc(doc, { hooks: ['אחת שתיים', 'שלוש ארבע חמש שש שבע'], lead: 'ליד', body: 'גוף', cta: 'קנו', shooting: 'הרבה מאוד מילים של הוראות צילום שלא נספרות' })
    const snap = scriptSnapshot(doc)
    expect(countWords(combinedScript(snap, snap.hooks[0].id))).toBe(5)
    expect(countWords(combinedScript(snap, snap.hooks[1].id))).toBe(8)
  })

  it('adds, duplicates, reorders and soft-deletes hooks', () => {
    const doc = new Y.Doc()
    initDoc(doc, { hooks: ['A', 'B'] })
    const [a, b] = listHooks(doc)
    const c = addHook(doc, { afterId: a.id, copyFrom: a.id })
    expect(listHooks(doc).map((h) => fragmentToText(hookFragment(doc, h.id)))).toEqual(['A', 'A', 'B'])
    moveHook(doc, b.id, -1)
    expect(listHooks(doc).map((h) => h.id)).toEqual([a.id, b.id, c])
    setHookDeleted(doc, a.id, true)
    expect(listHooks(doc).length).toBe(2)
    setHookDeleted(doc, a.id, false)
    expect(listHooks(doc).length).toBe(3)
  })

  it('merges concurrent edits to the same field without losing text (CRDT)', () => {
    const a = new Y.Doc()
    initDoc(a, { body: 'שורה משותפת' })
    const b = new Y.Doc()
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    // Both type in the same paragraph while offline from each other.
    const textA = (a.getXmlFragment('body').get(0) as Y.XmlElement).get(0) as Y.XmlText
    const textB = (b.getXmlFragment('body').get(0) as Y.XmlElement).get(0) as Y.XmlText
    textA.insert(0, 'של יעל ')
    textB.insert(textB.length, ' ושל דני')
    sync(a, b)
    const result = fragmentToText(a.getXmlFragment('body'))
    expect(result).toBe(fragmentToText(b.getXmlFragment('body')))
    expect(result).toContain('של יעל')
    expect(result).toContain('ושל דני')
    expect(result).toContain('שורה משותפת')
  })

  it('concurrent hook additions by two users both survive', () => {
    const a = new Y.Doc()
    initDoc(a, { hooks: ['1'] })
    const b = new Y.Doc()
    Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
    addHook(a, { text: 'מ-A' })
    addHook(b, { text: 'מ-B' })
    sync(a, b)
    expect(listHooks(a).length).toBe(3)
  })

  it('fingerprint ignores whitespace-only changes but not wording', () => {
    const doc = new Y.Doc()
    initDoc(doc, { hooks: ['הוק'], body: 'גוף התסריט' })
    const before = contentFingerprint(scriptSnapshot(doc))
    setFragmentText(doc.getXmlFragment('body'), 'גוף   התסריט ')
    expect(contentFingerprint(scriptSnapshot(doc))).toBe(before)
    setFragmentText(doc.getXmlFragment('body'), 'גוף תסריט אחר')
    expect(contentFingerprint(scriptSnapshot(doc))).not.toBe(before)
    setFragmentText(doc.getXmlFragment('shooting'), 'שינוי בהוראות צילום')
    expect(contentFingerprint(scriptSnapshot(doc))).toBe(contentFingerprint(scriptSnapshot(doc)))
  })

  it('copyScript copies script (and research on request) without touching the source', () => {
    const src = new Y.Doc()
    initDoc(src, { hooks: ['h1', 'h2'], lead: 'L', body: 'B', cta: 'C' })
    addResearchItem(src, 'pains', { text: 'כאב', provenance: 'user', source: '' })
    const before = Y.encodeStateAsUpdate(src)
    const dst = new Y.Doc()
    copyScript(src, dst, { includeResearch: true })
    setFragmentText(dst.getXmlFragment('body'), 'שונה')
    expect(scriptSnapshot(dst).hooks.map((h) => h.text)).toEqual(['h1', 'h2'])
    expect(researchItems(dst, 'pains')[0].text).toBe('כאב')
    expect(fragmentToText(src.getXmlFragment('body'))).toBe('B')
    expect(Y.encodeStateAsUpdate(src)).toEqual(before)
  })

  it('restoring a version onto a live doc soft-deletes newer hooks', () => {
    const v1 = new Y.Doc()
    initDoc(v1, { hooks: ['old'], body: 'old body' })
    const live = new Y.Doc()
    Y.applyUpdate(live, Y.encodeStateAsUpdate(v1))
    addHook(live, { text: 'new hook' })
    setFragmentText(live.getXmlFragment('body'), 'new body')
    copyScript(v1, live)
    const snap = scriptSnapshot(live)
    expect(snap.hooks.map((h) => h.text)).toEqual(['old'])
    expect(snap.body).toBe('old body')
    expect(listHooks(live, { includeDeleted: true }).length).toBe(2)
  })
})
