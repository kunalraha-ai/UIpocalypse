// API client for the UIpocalypse web backend (uipocalypse/src/web/server.ts).
// The design mockup shipped hard-coded sample data; every screen now pulls
// real data from these endpoints. Types mirror the backend payloads.

export type RunRow = {
  id: number
  started_at: string
  target_url: string
  agents: number
  duration_ms: number | null
  llm_calls: number | null
  coverage: number | null
  llm_models: string | null
  disabled_classes: string | null
  skipped_actions: string | null
  cpu: string | null
  cores: number | null
  ram_bytes: number | null
  agents_at_collapse: number | null
}

export type ReportIssue = {
  key: string
  title: string
  severity: string
  confidence: string
  types: string[]
  observations: number
  rootCause: string
  fixPrompt: string
  file?: string
  line?: number
  evidence: Array<Record<string, unknown>>
  steps: string[]
}

/**
 * Evidence-level verdicts the backend records on findings (surfaced in the
 * first evidence sample). Extracted here so the UI never greps raw JSON.
 */
export type IssueVerdicts = {
  /** verification sweep: still dead on retry (true), worked on retry — flaky (false), control gone (unverifiable) */
  reproduced?: boolean | 'unverifiable'
  reproNote?: string
  /** static dead-handler issue flags the same control */
  corroboration?: string
  /** idempotency replay (opt-in): 'idempotent' | 'harmful' | 'unknown' | 'skipped' */
  idempotency?: string
  idempotencyNote?: string
  /** GraphQL/Server-Action operation the duplicate keyed on (e.g. graphql:EchoMut) */
  operation?: string
}

export function issueVerdicts(issue: ReportIssue): IssueVerdicts {
  const ev = issue.evidence[0] ?? {}
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined)
  const rep = ev.reproduced
  return {
    reproduced: rep === true || rep === false || rep === 'unverifiable' ? rep : undefined,
    reproNote: str(ev.reproNote),
    corroboration: str(ev.corroboration),
    idempotency: str(ev.idempotency),
    idempotencyNote: str(ev.idempotencyNote),
    operation: str(ev.operation),
  }
}

export type Report = {
  runId: number
  generatedAt: string
  run: {
    runId: number
    targetUrl: string
    agents: number
    wallMs: number
    llmCalls: number
    startedAt?: string
    llmModels?: string | null
    machine?: { cpu: string; cores: number; ramBytes: number }
    agentsAtCollapse?: number
  }
  summary: string
  reviewedBy: 'llm' | 'mechanical'
  reviewReason?: string
  targetUnreachable?: { refused: number; totalObservations: number; mode: 'never' | 'collapse'; agentsAtCollapse?: number }
  issues: ReportIssue[]
  /** acknowledged as known/false — suppressed from `issues`, shown with the reason */
  knownIssues?: Array<{ id: number; key: string; title: string; observations: number; reason: string | null; ignoredAt: string }>
  inconsistentFeedback: Array<{ key: string; title: string; observations: number; note: string }>
  correctRejections: Array<{ key: string; title: string; observations: number }>
  artifacts: Array<{ key: string; title: string; observations: number }>
  coverage: {
    coverage: number
    reachedActions: number
    discoveredActions: number
    appMapCoverage: number
    appMapReached: number
    appMapTotal: number
    unreached: Array<{ label: string; route: string; reason: string }>
  }
  coverageFigures?: { graph: { reached: number; total: number }; appMap: { reached: number; total: number } }
  disabledClasses?: string[]
  skippedActions?: Array<{ label: string; reason: string }>
}

export type Status = {
  version: string
  llmMode: string
  llmModeOn: boolean
  machine: { cpu: string; cores: number; ramBytes: number }
  workspace: string
}

export type JobEvent = { at: number; type: string; [key: string]: unknown }

export type StaticIssue = {
  rule: string
  severity: string
  file: string
  line: number
  message: string
  fixHint?: string
}

export type Graph = {
  states: Array<{ id: number; route: string | null; first_run: number | null }>
  actions: Array<{ id: number; state_id: number; locator: string; kind: string | null; label: string | null; risk_class: string | null; skip_reason: string | null }>
  transitions: Array<{ from_state: number; action_id: number; to_state: number; count: number; error_count: number; avg_ms: number }>
}

export type Diff = {
  runs: number[]
  fixed: Array<{ key: string; title: string }>
  new: Array<{ key: string; title: string }>
  stillFailing: Array<{ key: string; title: string }>
  intermittent: Array<{ key: string; title: string }>
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(path)
  if (!res.ok) throw new Error((await res.json().catch(() => ({ error: res.status }))).error ?? `HTTP ${res.status}`)
  return (await res.json()) as T
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const json = (await res.json().catch(() => ({}))) as T & { error?: string }
  if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`)
  return json
}

export type Monitor = {
  id: number
  name: string
  url: string
  frequency: 'hourly' | 'daily' | 'weekly' | 'manual'
  enabled: boolean
  last_run_at: string | null
  last_run_id: number | null
  last_run_status: string
  open_findings: number
  created_at: string
}

export const api = {
  status: () => get<Status>('/api/status'),
  runs: () => get<{ runs: RunRow[] }>('/api/runs'),
  report: (runId: number) => get<{ report: Report }>(`/api/runs/${runId}/report`),
  graph: (runId: number) => get<Graph>(`/api/runs/${runId}/graph`),
  scan: (path: string) => post<{ issues: StaticIssue[]; summary: { routes: number; elements: number; envVars: number } }>('/api/scan', { path }),
  diff: (runs: number[], path: string) => get<Diff>(`/api/diff?runs=${runs.join(',')}&path=${encodeURIComponent(path)}`),
  startRun: (input: { path?: string; url: string; agents?: number; budgetSeconds?: number; optIn?: { destructive?: boolean; externalSideEffects?: boolean; idempotencyReplay?: boolean }; liveTarget?: { attested?: boolean; ownershipToken?: string; prodOverride?: boolean } }) =>
    post<{ jobId: number }>('/api/runs', input),
  job: (jobId: number) => get<{ jobId: number; status: 'running' | 'done' | 'error'; runId?: number; error?: string }>(`/api/jobs/${jobId}`),

  // ---- acknowledged findings (the triage loop)
  ignoreIssue: (runId: number, key: string, reason?: string) =>
    post<{ ignored: { id: number; cluster_key: string } }>(`/api/runs/${runId}/ignore`, { key, reason }),
  ignored: () => get<{ ignored: Array<{ id: number; cluster_key: string; title: string | null; reason: string | null; created_at: string }> }>('/api/ignored'),
  unignore: (id: number) => fetch(`/api/ignored/${id}`, { method: 'DELETE' }).then((r) => r.json()),

  // ---- monitors
  monitors: () => get<{ monitors: Monitor[] }>('/api/monitors'),
  createMonitor: (input: { url: string; name?: string; frequency?: string }) =>
    post<{ monitor: Monitor }>('/api/monitors', input),
  deleteMonitor: (id: number) => fetch(`/api/monitors/${id}`, { method: 'DELETE' }).then((r) => r.json()),
  updateMonitor: (id: number, input: { enabled?: boolean; frequency?: string }) =>
    fetch(`/api/monitors/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(input) }).then((r) => r.json()),
  runMonitor: (id: number) => post<{ jobId: number }>(`/api/monitors/${id}/run`, {}),

  /** Subscribe to a job's event stream (SSE). Returns an unsubscribe fn. */
  events(jobId: number, onEvent: (ev: JobEvent) => void, onEnd?: () => void): () => void {
    const controller = new AbortController()
    fetch(`/api/jobs/${jobId}/events`, { signal: controller.signal })
      .then((res) => {
        const reader = res.body!.getReader()
        const decoder = new TextDecoder()
        let buf = ''
        const pump = (): Promise<void> =>
          reader.read().then(({ done, value }) => {
            if (done) {
              onEnd?.()
              return
            }
            buf += decoder.decode(value, { stream: true })
            let idx: number
            while ((idx = buf.indexOf('\n\n')) >= 0) {
              const frame = buf.slice(0, idx)
              buf = buf.slice(idx + 2)
              const data = frame.split('\n').find((l) => l.startsWith('data: '))
              if (data) onEvent(JSON.parse(data.slice(6)) as JobEvent)
            }
            return pump()
          })
        return pump()
      })
      .catch(() => onEnd?.())
    return () => controller.abort()
  },
}

// ---- target classification (mirrors the backend Guard: local hosts and
// private ranges are "local"; anything else is a live target needing the
// ownership-token flow)

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0'])
const STAGING_LIKE = /^(staging|stage|stg|dev|test|qa|demo|preview|beta|uat|preprod)([.-]|$)/

export function targetHost(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return ''
  }
}

export function isLocalTarget(url: string): boolean {
  const h = targetHost(url).toLowerCase()
  if (!h) return false
  if (LOCAL_HOSTS.has(h) || h.endsWith('.localhost') || h.endsWith('.local')) return true
  const parts = h.split('.')
  if (parts.length !== 4) return false
  const octets = parts.map((p) => Number(p))
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false
  const [a, b] = octets as [number, number, number, number]
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31)
}

export function looksLikeProdTarget(url: string): boolean {
  const h = targetHost(url).toLowerCase()
  if (!h || isLocalTarget(url)) return false
  if (/\.vercel\.app$/.test(h) || /\.netlify\.app$/.test(h)) return false
  return !STAGING_LIKE.test(h.split('.')[0]!)
}

// ---- the "connected project" (path + url), persisted locally

export type Project = { path: string; url: string } // path may be '' for URL-only testing

export function loadProject(): Project | null {
  try {
    const raw = localStorage.getItem('uip-project')
    return raw ? (JSON.parse(raw) as Project) : null
  } catch {
    return null
  }
}

export function saveProject(p: Project): void {
  localStorage.setItem('uip-project', JSON.stringify(p))
}

// ---- hash-route helpers (the design uses hash routing; we add queries)

export function routeParts(): { path: string; query: URLSearchParams } {
  const raw = window.location.hash.slice(1) || '/'
  const q = raw.indexOf('?')
  return q >= 0
    ? { path: raw.slice(0, q), query: new URLSearchParams(raw.slice(q + 1)) }
    : { path: raw, query: new URLSearchParams() }
}
