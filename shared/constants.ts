export const STATUSES = ['writing', 'ready_to_shoot', 'editing', 'published'] as const
export type CreativeStatus = (typeof STATUSES)[number]

export const STATUS_LABELS: Record<CreativeStatus, string> = {
  writing: 'בכתיבה',
  ready_to_shoot: 'מוכן לצילום',
  editing: 'בעריכה',
  published: 'עלה לפרסום',
}

export const SCRIPT_FIELDS = ['lead', 'body', 'cta'] as const
export type ScriptField = (typeof SCRIPT_FIELDS)[number]

export const FIELD_LABELS: Record<string, string> = {
  lead: 'ליד',
  body: 'גוף',
  cta: 'קריאה לפעולה',
  shooting: 'הוראות צילום',
  hook: 'הוק',
}

/** Customer research sections, stored per creative. */
export const RESEARCH_SECTIONS = [
  { key: 'audience', label: 'הקהל והסיטואציה שלו' },
  { key: 'problem', label: 'הבעיה המרכזית' },
  { key: 'desires', label: 'רצונות ותוצאה רצויה' },
  { key: 'pains', label: 'כאבים, פחדים ותסכולים' },
  { key: 'tried', label: 'פתרונות שכבר נוסו' },
  { key: 'objections', label: 'התנגדויות לרכישה' },
  { key: 'language', label: 'שפה ומשפטים של הקהל' },
  { key: 'angle', label: 'הזווית והמסר שנבחרו' },
  { key: 'open_questions', label: 'שאלות פתוחות' },
] as const
export type ResearchSection = (typeof RESEARCH_SECTIONS)[number]['key']
export const RESEARCH_KEYS = RESEARCH_SECTIONS.map((s) => s.key) as ResearchSection[]

/**
 * Where a research item came from. Kept separate so nobody mistakes a hypothesis or an
 * AI-written example for something a real customer said.
 */
export const PROVENANCE = ['user', 'sourced', 'hypothesis', 'ai_example'] as const
export type Provenance = (typeof PROVENANCE)[number]
export const PROVENANCE_LABELS: Record<Provenance, string> = {
  user: 'מסרנו',
  sourced: 'עם מקור',
  hypothesis: 'השערה לבדיקה',
  ai_example: 'דוגמה שנוסחה ע״י AI',
}

export const DOSSIER_FIELDS = [
  { key: 'benefits', label: 'יתרונות' },
  { key: 'features', label: 'מאפיינים' },
  { key: 'audiences', label: 'קהלים' },
  { key: 'offer', label: 'הצעה מסחרית' },
  { key: 'links', label: 'קישורים' },
  { key: 'sources', label: 'מקורות' },
  { key: 'materials', label: 'חומרים רלוונטיים' },
] as const
export type DossierKey = (typeof DOSSIER_FIELDS)[number]['key']
export type Dossier = Partial<Record<DossierKey, string>>

export const PREFERENCE_CATEGORIES = {
  style: 'סגנון כתיבה',
  method: 'שיטות ועקרונות',
  example: 'דוגמאות שאהבנו',
  brand_guideline: 'הנחיות מותג',
  avoid: 'להימנע',
  imported: 'יובא ידנית',
} as const
export type PreferenceCategory = keyof typeof PREFERENCE_CATEGORIES
