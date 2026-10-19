// In-memory data for the browser demo. Mirrors the server's tables closely enough for every screen.
// Nothing is persisted: reloading the page starts over from the sample data.
import * as Y from 'yjs'
import { addResearchItem, contentFingerprint, initDoc, plainTextForSearch, scriptSnapshot } from '../../../shared/script'
import type { Provenance, ResearchSection } from '../../../shared/constants'

export const ME = { id: 'u-me', name: 'את/ה', email: 'demo@example.com', color: '#2563eb', workspaceId: 'ws', role: 'owner' as const }
export const PARTNER = { id: 'u-partner', name: 'השותף/ה', email: 'partner@example.com', color: '#db2777' }
export const USERS: Record<string, { name: string; color: string }> = { [ME.id]: ME, [PARTNER.id]: PARTNER }

let seq = 1000
export const uid = (p: string) => `${p}-${(++seq).toString(36)}-${Math.random().toString(36).slice(2, 7)}`
export const now = () => new Date().toISOString()
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString()

export const db = {
  brands: [] as any[],
  products: [] as any[],
  creatives: [] as any[],
  versions: [] as any[],
  comments: [] as any[],
  assets: [] as any[],
  files: new Map<string, { url: string; name: string; mime: string; size: number }>(),
  messages: [] as any[], // { creative_id, kind, ... }
  suggestions: [] as any[],
  preferences: [] as any[],
  activity: [] as any[],
  visits: new Map<string, string>(),
}

const docs = new Map<string, Y.Doc>()

/** The "server copy" of a creative's shared document. */
export function serverDoc(creativeId: string): Y.Doc {
  let doc = docs.get(creativeId)
  if (!doc) {
    doc = new Y.Doc()
    docs.set(creativeId, doc)
    watchDoc(creativeId, doc)
  }
  return doc
}

export const hashOf = (doc: Y.Doc) => contentFingerprint(scriptSnapshot(doc))

/** Keeps derived fields (search text, "needs review" after approval) up to date, like the server's store hook. */
function watchDoc(creativeId: string, doc: Y.Doc) {
  let t: ReturnType<typeof setTimeout> | undefined
  doc.on('update', () => {
    clearTimeout(t)
    t = setTimeout(() => {
      const c = db.creatives.find((x) => x.id === creativeId)
      if (!c) return
      const h = hashOf(doc)
      if (h === c.content_hash) return
      c.content_hash = h
      c.plain_text = plainTextForSearch(scriptSnapshot(doc))
      c.content_updated_at = now()
      const wasOk = c.approved_hash && !c.needs_review
      c.needs_review = Boolean(c.approved_hash) && c.approved_hash !== h
      if (wasOk && c.needs_review) log(c.id, 'creative.needs_review', {}, ME.id)
    }, 400)
  })
}

export function log(creativeId: string | null, action: string, details: Record<string, unknown> = {}, userId = ME.id) {
  db.activity.unshift({ id: uid('a'), creative_id: creativeId, action, details, created_at: now(), user_id: userId })
}

export function saveVersion(creativeId: string, reason: string, label: string | null = null, userId = ME.id) {
  const doc = serverDoc(creativeId)
  const v = {
    id: uid('v'),
    creative_id: creativeId,
    state: Y.encodeStateAsUpdate(doc),
    snapshot: scriptSnapshot(doc),
    content_hash: hashOf(doc),
    reason,
    label,
    created_at: now(),
    created_by: userId,
  }
  db.versions.unshift(v)
  return v
}

export function newCreative(fields: Partial<any>, content?: Parameters<typeof initDoc>[1], fromDoc?: Y.Doc) {
  const c = {
    id: uid('c'),
    workspace_id: 'ws',
    name: '',
    angle: '',
    status: 'writing',
    source_creative_id: null,
    source_kind: null,
    short_target: null,
    plain_text: '',
    content_hash: '',
    approved_version_id: null,
    approved_hash: null,
    approved_by: null,
    approved_at: null,
    needs_review: false,
    revision: 1,
    created_by: ME.id,
    created_at: now(),
    updated_at: now(),
    content_updated_at: now(),
    archived_at: null,
    ...fields,
  }
  db.creatives.push(c)
  const doc = serverDoc(c.id)
  if (fromDoc) Y.applyUpdate(doc, Y.encodeStateAsUpdate(fromDoc))
  else initDoc(doc, content)
  c.content_hash = hashOf(doc)
  c.plain_text = plainTextForSearch(scriptSnapshot(doc))
  saveVersion(c.id, 'created', null, c.created_by)
  return c
}

function svgData(bg1: string, bg2: string, text: string, w = 200, h = 200) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${bg1}"/><stop offset="1" stop-color="${bg2}"/></linearGradient></defs><rect width="${w}" height="${h}" fill="url(#g)"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="Arial" font-weight="700" font-size="${Math.round(h * 0.36)}" fill="#fff">${text}</text></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}
function addFile(url: string, name: string, mime = 'image/svg+xml') {
  const id = uid('f')
  db.files.set(id, { url, name, mime, size: url.length })
  return id
}

export function seed() {
  const brand = (name: string, logo: string | null) => {
    const b = { id: uid('b'), workspace_id: 'ws', name, logo_file_id: logo, created_at: ago(5000), updated_at: ago(5000), archived_at: null }
    db.brands.push(b)
    return b
  }
  const glow = brand('Glow Labs', addFile(svgData('#f59e0b', '#ef4444', 'GL'), 'glow.svg'))
  brand('נעלי ענן', addFile(svgData('#38bdf8', '#6366f1', 'CS'), 'cloud.svg'))
  brand('Kiddo', addFile(svgData('#34d399', '#059669', 'K'), 'kiddo.svg'))

  const product = (b: any, name: string, description: string, img: string | null, dossier: Record<string, string> = {}) => {
    const p = {
      id: uid('p'), workspace_id: 'ws', brand_id: b.id, name, description, image_file_id: img, dossier,
      revision: 1, created_at: ago(4000), updated_at: ago(3000), archived_at: null,
    }
    db.products.push(p)
    return p
  }
  const serum = product(glow, 'סרום ויטמין C', 'סרום פנים 30 מ״ל עם 15% ויטמין C, בבקבוק טפטפת', addFile(svgData('#fed7aa', '#fb923c', 'C', 400, 250), 'serum.svg'), {
    benefits: 'עור זוהר ואחיד יותר אחרי שבועיים של שימוש יומי (לפי משובי לקוחות מהחנות)\nנספג מהר, לא משאיר תחושה דביקה',
    features: '30 מ״ל · 15% ויטמין C · חומצה היאלורונית\nמתאים לשימוש בבוקר מתחת לקרם הגנה',
    audiences: 'אמהות עובדות 28–40\nנשים שמרגישות שהעור נראה עייף',
    offer: '1+1 עד סוף החודש · משלוח חינם מעל 199₪ · החזרה תוך 30 יום',
    links: 'https://glowlabs.example.com/serum',
    sources: 'סקר לקוחות פנימי, ספטמבר 2026 (212 משיבות) — נתון לדוגמה',
  })
  product(glow, 'קרם לילה מחדש', 'קרם לילה עשיר עם פפטידים', null)

  const c1 = newCreative(
    { product_id: serum.id, name: 'בוקר עייף', angle: 'עייפות שלא רואים על הפנים', created_at: ago(1500), created_by: PARTNER.id },
    {
      hooks: ['אם את קמה כל בוקר עם פנים עייפות — תעצרי שנייה.', 'הדבר היחיד שהחזיר לי את הזוהר אחרי הלידה.', 'אף אחד לא מספר לך מה שינה של 4 שעות עושה לעור.'],
      lead: 'שלושה ילדים, ארבע שעות שינה, ועור שנראה בדיוק ככה. הייתי בטוחה שזה פשוט המצב עכשיו.',
      body: 'ניסיתי קרמים יקרים, מסכות, אפילו טיפול אחד. ואז חברה שלחה לי את הסרום הזה עם 15% ויטמין C. שתי טיפות כל בוקר, מתחת לקרם ההגנה — נספג תוך שניות, לא דביק. אחרי שבועיים חברה מהעבודה שאלה אם חזרתי מחופשה.',
      cta: 'הקישור למטה — עכשיו 1+1 עד סוף החודש, ואם זה לא בשבילך יש 30 יום להחזרה.',
      shooting: 'סלפי במטבח, אור בוקר טבעי מהחלון. להתחיל בלי איפור, תקריב על הבקבוק בזמן "שתי טיפות".',
    },
  )
  const d1 = serverDoc(c1.id)
  const research: [ResearchSection, string, Provenance, string?][] = [
    ['audience', 'אמהות לילדים קטנים, עובדות, ישנות 4–6 שעות', 'user'],
    ['problem', 'העור "מסגיר" את העייפות גם כשמשקיעים', 'user'],
    ['pains', 'מרגישות שאנשים רואים עליהן את העייפות', 'hypothesis'],
    ['tried', 'קרמי לחות יקרים — לא ראו הבדל', 'sourced', 'סקר לקוחות פנימי (לדוגמה)'],
    ['objections', 'עוד מוצר יקר שלא יעבוד', 'hypothesis'],
    ['language', '"אני נראית כמו שאני מרגישה"', 'ai_example'],
  ]
  d1.transact(() => research.forEach(([s, text, provenance, source]) => addResearchItem(d1, s, { text, provenance, source: source ?? '' })))
  c1.content_hash = hashOf(d1)

  const c2 = newCreative(
    { product_id: serum.id, name: 'ביקורת של חברה', angle: 'המלצה מחברה קרובה', status: 'editing', created_at: ago(900) },
    { hooks: ['החברה הכי ביקורתית שלי שאלה מה עשיתי לפנים.'], lead: 'היא לא מחמיאה סתם.', body: 'סיפרתי לה על הסרום, ושבוע אחרי היא שלחה לי הודעה.', cta: 'הקישור כאן למטה.' },
  )
  const c3 = newCreative(
    { product_id: serum.id, name: 'לפני ואחרי — שבועיים', angle: 'הוכחה ויזואלית', status: 'published', created_at: ago(3000) },
    { hooks: ['שבועיים. אותה מצלמה. אותו אור.'], lead: 'צילמתי את עצמי כל בוקר.', body: 'בלי פילטרים, בלי איפור.', cta: 'ראו בעצמכן — הקישור למטה.' },
  )
  for (const c of [c1, c2, c3]) log(c.id, 'creative.created', { name: c.name }, c.created_by)
  c2.content_updated_at = ago(300)
  c3.content_updated_at = ago(2000)

  // Approved by the partner, then marked ready to shoot.
  const v = saveVersion(c1.id, 'approval', 'גרסה שאושרה', PARTNER.id)
  Object.assign(c1, { approved_version_id: v.id, approved_hash: v.content_hash, approved_by: PARTNER.id, approved_at: ago(60), status: 'ready_to_shoot' })
  log(c1.id, 'creative.approved', {}, PARTNER.id)
  log(c1.id, 'creative.status', { to: 'ready_to_shoot' }, PARTNER.id)

  db.comments.push(
    { id: uid('cm'), creative_id: c1.id, user_id: PARTNER.id, body: 'הוק 3 הכי חזק לדעתי. אפשר לצלם ביום חמישי?', created_at: ago(55) },
    { id: uid('cm'), creative_id: c1.id, user_id: ME.id, body: 'מסכימה. הוספתי רפרנס לצילום: https://drive.example.com/ref-kitchen', created_at: ago(40) },
  )
  db.assets.push({ id: uid('as'), creative_id: c1.id, kind: 'link', name: 'רפרנס — סלפי במטבח', description: 'הסגנון שאנחנו רוצות', url: 'https://drive.example.com/ref-kitchen', file_id: null, created_by: ME.id, created_at: ago(40) })

  for (const [category, title, content] of [
    ['style', 'טון כתיבה', 'גוף ראשון, שפה מדוברת, משפטים קצרים. בלי סופרלטיבים ("הכי", "מושלם").'],
    ['method', 'הוק לא חושף את המוצר', 'ההוק פותח סקרנות או מצב, המוצר נכנס רק בגוף.'],
    ['avoid', 'הבטחות רפואיות', 'לא לכתוב "מרפא", "מעלים קמטים", או אחוזי שיפור בלי מקור בתיק המוצר.'],
  ]) {
    db.preferences.push({ id: uid('pr'), workspace_id: 'ws', brand_id: null, category, title, content, active: true, created_by: ME.id, created_at: ago(2000), updated_at: ago(2000) })
  }
  db.visits.set(c1.id, ago(30))
  db.visits.set(c2.id, ago(200))
}

export function resolveFileUrl(id: string) {
  return db.files.get(id)?.url ?? ''
}
export function addUploadedFile(file: File) {
  const id = uid('f')
  db.files.set(id, { url: URL.createObjectURL(file), name: file.name, mime: file.type || 'application/octet-stream', size: file.size })
  return { id, original_name: file.name, mime: file.type, size: file.size }
}
