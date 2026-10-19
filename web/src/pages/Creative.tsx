import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { FIELD_LABELS, STATUSES, STATUS_LABELS, type CreativeStatus } from '../../../shared/constants'
import { DEFAULT_PACE, type Pace } from '../../../shared/readingTime'
import { combinedScript, type SharedField } from '../../../shared/script'
import { AssistantPanel } from '../components/creative/AssistantPanel'
import { CombinedView } from '../components/creative/CombinedView'
import { HistoryPanel } from '../components/creative/HistoryPanel'
import { HooksSection } from '../components/creative/HooksSection'
import { ProductionPanel } from '../components/creative/ProductionPanel'
import { ResearchPanel } from '../components/creative/ResearchPanel'
import { ScriptStats } from '../components/creative/ScriptStats'
import { ShortDialog } from '../components/creative/ShortDialog'
import { useProactiveReview, useSuggestions } from '../components/creative/useSuggestions'
import { FieldEditor } from '../components/FieldEditor'
import { Avatar, ErrorBox, Loading } from '../components/ui'
import { api, errorMessage } from '../lib/api'
import { useMe } from '../lib/auth'
import { SAVE_LABELS, useCreativeConnection, useDocSnapshot, type PresenceUser, type SaveState } from '../lib/collab'
import { useToast } from '../lib/toast'
import { useAsync } from '../lib/useAsync'

type PanelTab = 'research' | 'assistant' | 'production' | 'history'
const PANEL_LABELS: Record<PanelTab, string> = { research: 'חקר לקוח', assistant: 'עוזר AI', production: 'תגובות והפקה', history: 'היסטוריה' }

function load<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : (JSON.parse(v) as T)
  } catch {
    return fallback
  }
}
function save(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch {}
}

export function CreativePage() {
  const { id } = useParams()
  return <CreativeLoader key={id} id={id!} />
}

function CreativeLoader({ id }: { id: string }) {
  const meta = useAsync(() => api.get(`/creatives/${id}`), [id])
  if (meta.loading && !meta.data) return <div className="page"><Loading text="טוען קריאייטיב…" /></div>
  if (meta.error || !meta.data)
    return (
      <div className="page">
        <div className="page-inner"><ErrorBox error={meta.error ?? 'שגיאה'} onRetry={() => meta.reload()} /></div>
      </div>
    )
  return <Workspace meta={meta.data} reloadMeta={() => meta.reload(true)} />
}

function SaveIndicator({ state }: { state: SaveState }) {
  const dot = state === 'saved' ? 'dot-ok' : state === 'saving' || state === 'connecting' ? 'dot-busy' : 'dot-bad'
  return (
    <span className="save-state" role="status" aria-live="polite" data-testid="save-state" data-state={state}>
      <span className={`dot ${dot}`} />
      {SAVE_LABELS[state]}
    </span>
  )
}

function fieldLabel(field?: string | null) {
  if (!field) return null
  if (field.startsWith('hook:')) return 'הוק'
  return FIELD_LABELS[field] ?? null
}

function Presence({ users }: { users: PresenceUser[] }) {
  const others = users.filter((u) => !u.self)
  const unique = [...new Map(others.map((u) => [u.id + (u.activeField ?? ''), u])).values()]
  if (!unique.length) return <span className="subtle hide-mobile">רק את/ה במסמך</span>
  return (
    <span className="row" data-testid="presence">
      <span className="presence">
        {unique.map((u) => (
          <Avatar key={u.clientId} name={u.name} color={u.color} title={`${u.name}${fieldLabel(u.activeField) ? ` · עורך/ת ב${fieldLabel(u.activeField)}` : ' · צופה'}`} />
        ))}
      </span>
      <span className="subtle hide-mobile">{[...new Set(unique.map((u) => u.name))].join(', ')} במסמך</span>
    </span>
  )
}

function Workspace({ meta, reloadMeta }: { meta: any; reloadMeta: () => void }) {
  const me = useMe()
  const creative = meta.creative
  const toast = useToast()
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const startAi = params.get('start') === 'ai'
  const conn = useCreativeConnection(creative.id, me.user)
  const snap = useDocSnapshot(conn.doc)

  const [selected, setSelected] = useState<string | null>(() => load(`hook:${creative.id}`, null))
  const selectedHookId = snap.hooks.find((h) => h.id === selected)?.id ?? snap.hooks[0]?.id ?? null
  const selectHook = useCallback(
    (hid: string) => {
      setSelected(hid)
      save(`hook:${creative.id}`, hid)
    },
    [creative.id],
  )
  const [pace, setPaceState] = useState<Pace>(() => load('pace', DEFAULT_PACE))
  const setPace = (p: Pace) => {
    setPaceState(p)
    save('pace', p)
  }
  const [view, setView] = useState<'edit' | 'combined'>('edit')
  const [panelOpen, setPanelOpen] = useState<boolean>(() => startAi || load('panel-open', true))
  const [tab, setTab] = useState<PanelTab>(() => (startAi ? 'research' : load('panel-tab', 'assistant')))
  const [mobileArea, setMobileArea] = useState<'write' | 'panel'>(startAi ? 'panel' : 'write')
  const [proactive, setProactiveState] = useState<boolean>(() => load('proactive', true))
  const [shortOpen, setShortOpen] = useState(false)
  const [name, setName] = useState(creative.name)
  const [angle, setAngle] = useState(creative.angle)
  useEffect(() => setName(creative.name), [creative.name])
  useEffect(() => setAngle(creative.angle), [creative.angle])

  const suggestions = useSuggestions(creative.id, conn)
  useProactiveReview({
    enabled: proactive && me.aiConfigured && conn.synced,
    creativeId: creative.id,
    snap,
    selectedHookId,
    onResult: suggestions.changed,
    setReviewing: suggestions.setReviewing,
  })
  useEffect(() => conn.onNotify((m) => (m.scope === 'meta' || m.scope === 'history') && reloadMeta()), [conn, reloadMeta])
  // Keep approval state fresh (it can change through a save on the server).
  useEffect(() => {
    if (conn.saveState === 'saved' && creative.approved_at) reloadMeta()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conn.saveState])

  const openTab = (t: PanelTab) => {
    setTab(t)
    save('panel-tab', t)
    setPanelOpen(true)
    save('panel-open', true)
    setMobileArea('panel')
  }
  const togglePanel = () => {
    setPanelOpen((o) => {
      save('panel-open', !o)
      return !o
    })
  }

  const patch = async (body: Record<string, unknown>, okText?: string) => {
    try {
      await api.patch(`/creatives/${creative.id}`, body)
      reloadMeta()
      conn.notify('meta')
      if (okText) toast.show('success', okText)
      return true
    } catch (e) {
      toast.show('error', `השינוי לא נשמר: ${errorMessage(e)}`)
      setName(creative.name)
      setAngle(creative.angle)
      return false
    }
  }
  const changeStatus = (status: CreativeStatus) => {
    if (status === 'ready_to_shoot' && (!creative.approved_at || creative.needs_review)) {
      if (!confirm('התסריט עוד לא אושר (או שהשתנה מאז האישור). לסמן ״מוכן לצילום״ בכל זאת?')) return
    }
    patch({ status }, `הסטטוס עודכן ל״${STATUS_LABELS[status]}״`)
  }
  const duplicate = async () => {
    if (!confirm('ליצור עותק של הקריאייטיב? התסריט והמחקר יועתקו. תגובות, קבצים, שיחות ואישורים לא יועתקו.')) return
    try {
      const c = await api.post(`/creatives/${creative.id}/duplicate`)
      toast.show('success', 'נוצר עותק')
      navigate(`/creatives/${c.id}`)
    } catch (e) {
      toast.show('error', errorMessage(e))
    }
  }
  const archive = async () => {
    if (!confirm('להעביר את הקריאייטיב לארכיון? הוא לא יופיע ברשימות.')) return
    try {
      await api.del(`/creatives/${creative.id}`)
      navigate(`/products/${meta.product.id}`)
    } catch (e) {
      toast.show('error', errorMessage(e))
    }
  }
  const setProactive = (v: boolean) => {
    setProactiveState(v)
    save('proactive', v)
  }

  const hookIndex = Math.max(0, snap.hooks.findIndex((h) => h.id === selectedHookId))
  const pendingCount = suggestions.items.filter((s) => s.status === 'pending' && s.origin === 'proactive').length
  const fieldPresence = (field: string) => conn.presence.filter((p) => !p.self && p.activeField === field)

  const sharedField = (field: SharedField, label: string, placeholder: string, hint?: string) => (
    <div>
      <div className="block-label">
        {label} {hint && <span className="hint">· {hint}</span>}
        {fieldPresence(field).map((p) => <Avatar key={p.clientId} name={p.name} color={p.color} title={`${p.name} עורך/ת כאן`} />)}
      </div>
      <div className={`editor-box ${field === 'shooting' ? 'shooting' : ''}`}>
        <FieldEditor fragment={conn.doc.getXmlFragment(field)} provider={conn.provider} field={field} label={label} placeholder={placeholder} />
      </div>
    </div>
  )

  const panel = (
    <aside className={`cw-panel ${mobileArea === 'panel' ? 'mobile-open' : ''}`} aria-label="פאנל צדדי" style={{ display: panelOpen || mobileArea === 'panel' ? undefined : 'none' }}>
      <div className="tabs" role="tablist">
        {(Object.keys(PANEL_LABELS) as PanelTab[]).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => openTab(t)}>
            {PANEL_LABELS[t]}
            {t === 'assistant' && pendingCount > 0 && <span className="count">{pendingCount}</span>}
          </button>
        ))}
        <span className="spacer" />
        <button className="icon-btn panel-toggle-desktop" onClick={togglePanel} aria-label="סגירת הפאנל" title="סגירת הפאנל">✕</button>
      </div>
      <div className="cw-panel-body">
        {!conn.synced ? (
          <Loading />
        ) : tab === 'research' ? (
          <ResearchPanel conn={conn} creative={creative} startWithChat={startAi} onAngle={(a) => { setAngle(a); patch({ angle: a }, 'הזווית עודכנה') }} />
        ) : tab === 'assistant' ? (
          <AssistantPanel conn={conn} creativeId={creative.id} snap={snap} selectedHookId={selectedHookId} suggestions={suggestions} proactive={proactive} onProactive={setProactive} />
        ) : tab === 'production' ? (
          <ProductionPanel creative={meta} conn={conn} saveState={conn.saveState} onChanged={reloadMeta} />
        ) : (
          <HistoryPanel creativeId={creative.id} conn={conn} />
        )}
      </div>
    </aside>
  )

  return (
    <div className="cw">
      <header className="cw-head">
        <div className="crumbs">
          <Link to={`/brands/${meta.product.brand_id}`} className="bidi">{meta.product.brand_name}</Link> /
          <Link to={`/products/${meta.product.id}`} className="bidi">{meta.product.name}</Link>
          {meta.source && (
            <span>
              · {creative.source_kind === 'short' ? 'גרסה קצרה של' : 'שוכפל מ'}{' '}
              <Link to={`/creatives/${meta.source.id}`} className="bidi">{meta.source.name}</Link>
            </span>
          )}
          {meta.derived.length > 0 && (
            <span>
              · נגזרו ממנו:{' '}
              {meta.derived.map((d: any, i: number) => (
                <span key={d.id}>{i > 0 && ', '}<Link to={`/creatives/${d.id}`} className="bidi">{d.name}</Link></span>
              ))}
            </span>
          )}
        </div>
        <div className="cw-head-top">
          <input
            className="title-input bidi"
            type="text"
            value={name}
            aria-label="שם הקריאייטיב"
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name !== creative.name ? patch({ name: name.trim() }) : setName(creative.name)}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <select value={creative.status} onChange={(e) => changeStatus(e.target.value as CreativeStatus)} style={{ width: 'auto' }} aria-label="סטטוס">
            {STATUSES.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
          </select>
          {creative.needs_review ? (
            <button className="badge badge-warn" style={{ border: 'none', cursor: 'pointer' }} onClick={() => openTab('production')}>נדרשת בדיקה מחודשת</button>
          ) : creative.approved_at ? (
            <span className="badge badge-ok">✓ מאושר</span>
          ) : null}
          <Presence users={conn.presence} />
          <SaveIndicator state={conn.saveState} />
        </div>
        <div className="cw-head-top">
          <input
            className="angle-input bidi"
            type="text"
            value={angle}
            placeholder="זווית שיווקית — למשל: ״הפתרון של אמהות עסוקות לבוקר רגוע״"
            aria-label="זווית שיווקית"
            onChange={(e) => setAngle(e.target.value)}
            onBlur={() => angle !== creative.angle && patch({ angle })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
          <button className="btn btn-sm" onClick={duplicate}>שכפול</button>
          <button className="btn btn-sm" onClick={() => setShortOpen(true)} disabled={!conn.synced}>✂ צור גרסה קצרה עם AI</button>
          <button className="btn btn-sm btn-ghost hide-mobile" onClick={archive} title="העברה לארכיון">ארכיון</button>
          {!panelOpen && (
            <button className="btn btn-sm panel-toggle-desktop" onClick={togglePanel}>פתיחת פאנל ◧</button>
          )}
        </div>
        <div className="cw-mobile-switch seg" style={{ alignSelf: 'stretch' }}>
          <button className={mobileArea === 'write' ? 'active' : ''} onClick={() => setMobileArea('write')} style={{ flex: 1 }}>כתיבה</button>
          {(Object.keys(PANEL_LABELS) as PanelTab[]).map((t) => (
            <button key={t} className={mobileArea === 'panel' && tab === t ? 'active' : ''} onClick={() => openTab(t)} style={{ flex: 1 }}>
              {PANEL_LABELS[t]}
            </button>
          ))}
        </div>
      </header>

      {(conn.saveState === 'offline_unsaved' || conn.saveState === 'failed' || conn.saveState === 'slow') && (
        <div className="alert alert-warn" style={{ borderRadius: 0, borderInline: 'none' }} role="alert">
          {conn.saveState === 'failed'
            ? 'השרת לא הצליח לשמור את השינויים האחרונים. הם נשמרים בדפדפן הזה ויישלחו שוב — אל תסגרו את הלשונית.'
            : conn.saveState === 'slow'
              ? 'השמירה מתעכבת. השינויים שמורים בלשונית הזו ויישלחו כשהחיבור יתייצב — אל תסגרו אותה.'
              : 'אין חיבור לשרת. אפשר להמשיך לכתוב — השינויים יסונכרנו כשהחיבור יחזור. אל תסגרו את הלשונית עד שיופיע ״נשמר״.'}
        </div>
      )}
      {conn.saveState === 'denied' && <div className="alert alert-error" style={{ borderRadius: 0 }}>אין הרשאה למסמך. נסו להתחבר מחדש.</div>}

      <div className="cw-body">
        <main className={`cw-writing ${mobileArea === 'panel' ? 'mobile-hidden' : ''}`}>
          <div className="stats-bar">
            <ScriptStats text={combinedScript(snap, selectedHookId)} pace={pace} onPace={setPace} hookIndex={hookIndex} />
            <span className="spacer" />
            <span className="seg" role="group" aria-label="תצוגה">
              <button className={view === 'edit' ? 'active' : ''} onClick={() => setView('edit')}>עריכה</button>
              <button className={view === 'combined' ? 'active' : ''} onClick={() => setView('combined')}>תסריט מלא</button>
            </span>
          </div>
          <div className="cw-writing-inner">
            {!conn.synced ? (
              <Loading text="טוען את המסמך המשותף…" />
            ) : view === 'combined' ? (
              <CombinedView snap={snap} selectedHookId={selectedHookId} onSelect={selectHook} />
            ) : (
              <>
                <HooksSection doc={conn.doc} provider={conn.provider} userId={me.user.id} selectedHookId={selectedHookId} onSelect={selectHook} presence={conn.presence} />
                {sharedField('lead', 'ליד', 'הליד — ממשיך את ההוק ומכניס לסיפור…', 'משותף לכל ההוקים')}
                {sharedField('body', 'גוף', 'הגוף — הבעיה, הפתרון, ההוכחות…', 'משותף לכל ההוקים')}
                {sharedField('cta', 'קריאה לפעולה', 'מה הצופה צריך לעשות עכשיו?', 'משותפת לכל ההוקים')}
                {sharedField('shooting', 'הוראות צילום', 'לוקיישן, שוטים, אביזרים, טון… (לא מוקרא ולא נספר בזמן ההקראה)', 'לא חלק מהטקסט המוקרא')}
              </>
            )}
          </div>
        </main>
        {panel}
      </div>
      {shortOpen && <ShortDialog creativeId={creative.id} snap={snap} selectedHookId={selectedHookId} pace={pace} onClose={() => setShortOpen(false)} />}
    </div>
  )
}
