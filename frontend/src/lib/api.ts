import * as fx from './fixtures';
import * as local from './portalFixtures';
import type {
  DecisionResponse,
  DisputeResponse,
  GraphResponse,
  HotzoneResponse,
  PortalOverview,
  PurchaseOrder,
  QueueItem,
  Report,
  Task,
} from './types';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';
const FIXTURES_ONLY = process.env.NEXT_PUBLIC_USE_FIXTURES === '1';

/** True once a live call has failed, so we stop hammering a dead backend. */
let offline = FIXTURES_ONLY;

export function isOffline() {
  return offline;
}

/**
 * Try the backend; fall back to the local fixture on any failure. The demo must
 * survive the API being down mid-presentation, so the fallback is the default
 * rather than something you have to remember to flag on.
 */
async function call<T>(
  path: string,
  init: RequestInit | undefined,
  fallback: () => T,
): Promise<T> {
  if (offline) return fallback();
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...init?.headers },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  } catch (err) {
    console.warn(`[jenga] ${path} unavailable, using fixtures.`, err);
    offline = true;
    return fallback();
  }
}

/**
 * One site's graph. The fixture fallback is the default project's, which is the
 * only one it has — an offline drill-down into another site would show Eglinton
 * West's work packages under its name, so callers past the default should treat
 * the offline path as unsupported rather than trusted.
 */
export function fetchGraph(projectId?: string): Promise<GraphResponse> {
  const q = projectId ? `?project_id=${encodeURIComponent(projectId)}` : '';
  return call(`/api/graph${q}`, undefined, () => {
    const g = fx.graph();
    return projectId ? { ...g, tasks: local.tasksFor(projectId) } : g;
  });
}

export function fetchPurchaseOrders(): Promise<PurchaseOrder[]> {
  return call('/api/purchase-orders', undefined, fx.purchaseOrders);
}

export function fetchHotzones(): Promise<HotzoneResponse> {
  return call('/api/hotzones', undefined, fx.hotzones);
}

export function dispute(
  taskId: string,
  delayDays: number,
  reason: string,
  tasks: Task[],
): Promise<DisputeResponse> {
  return call<DisputeResponse>(
    `/api/tasks/${taskId}/dispute`,
    {
      method: 'POST',
      body: JSON.stringify({ delay_days: delayDays, reason }),
    },
    () => fx.dispute(tasks, taskId, delayDays),
  );
}

// ---------------------------------------------------------------------------
// Document upload
//
// These deliberately bypass `call()`: it forces `content-type: application/json`,
// and setting any content-type on a multipart request stops the browser emitting
// the boundary, so FastAPI rejects the body.
// ---------------------------------------------------------------------------

export interface ParsedDoc {
  filename: string;
  kind: string;
  char_count: number;
  text: string;
  preview: string;
}

export interface ProposedTask {
  name: string;
  zone: string;
  duration_days: number;
  spec_text: string;
  depends_on: string[];
}

export interface ExtractedTasks {
  filename: string;
  tasks: ProposedTask[];
  source: 'llm' | 'offline' | 'rejected';
  notes: string;
}

async function upload<T>(path: string, file: File): Promise<T> {
  const body = new FormData();
  body.append('file', file);
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    body,
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(detail || `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

/** Extract raw text from an uploaded PDF / txt / md. */
export function parseDocument(file: File): Promise<ParsedDoc> {
  return upload<ParsedDoc>('/api/documents/parse', file);
}

/** Propose work packages from an uploaded spec or blueprint. Does not mutate the graph. */
export function extractTasks(file: File): Promise<ExtractedTasks> {
  return upload<ExtractedTasks>('/api/documents/extract-tasks', file);
}

/* --- contractor portal ---------------------------------------------------- */

/**
 * The backend's own reason (a 409 for a blocked task, a 422 for a missing note)
 * has to reach the person who caused it, so the mutations below do not go
 * through `call()`: it would swallow that error and answer from fixtures, and
 * would latch the whole session offline over what was a correct refusal.
 * Only an unreachable backend degrades to the local mirror.
 */
async function mutate<T>(path: string, body: unknown, fallback: () => T): Promise<T> {
  if (offline) return fallback();
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });
  } catch (err) {
    console.warn(`[jenga] ${path} unreachable, using fixtures.`, err);
    offline = true;
    return fallback();
  }
  if (!res.ok) {
    const detail = await res.json().then((j) => j?.detail, () => null);
    throw new Error(typeof detail === 'string' ? detail : `${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

export function fetchPortal(params: { companyId?: string; ownerId?: string }): Promise<PortalOverview> {
  const q = new URLSearchParams();
  if (params.companyId) q.set('company_id', params.companyId);
  if (params.ownerId) q.set('owner_id', params.ownerId);
  return call(`/api/portal?${q}`, undefined, () => local.overview(params));
}

export function fetchReports(projectId: string, view: 'owner' | 'contractor'): Promise<Report[]> {
  return call(
    `/api/projects/${encodeURIComponent(projectId)}/reports?view=${view}`,
    undefined,
    () => local.projectReports(projectId, view),
  );
}

export function fetchQueue(ownerId: string): Promise<QueueItem[]> {
  return call(`/api/portal/owners/${encodeURIComponent(ownerId)}/queue`, undefined, () =>
    local.queue(ownerId),
  );
}

/** A contractor's progress update. The AI verdict comes back to the owner, not to them. */
export async function submitReport(
  projectId: string,
  taskId: string,
  reportText: string,
  imageBase64: string | null,
  tasks: Task[],
  strict = true,
): Promise<void> {
  await mutate(
    `/api/tasks/${encodeURIComponent(taskId)}/verify?strict=${strict}`,
    { report_text: reportText, image_base64: imageBase64 },
    () => {
      local.submit(projectId, taskId, reportText, fx.verdictForTask(taskId, tasks, strict));
      return null;
    },
  );
}

export function decideReport(
  reportId: string,
  decision: 'approve' | 'deny',
  note: string,
): Promise<DecisionResponse> {
  return mutate<DecisionResponse>(`/api/reports/${reportId}/decision`, { decision, note }, () =>
    local.decide(reportId, decision, note),
  );
}
