import { useSession } from '@/store/session';

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8010').replace(/\/$/, '');

// ── Types ──────────────────────────────────────────

export type User = { id: string; email: string; name: string };

export type Workspace = {
  id: string;
  name: string;
  is_active: boolean;
  has_api_key: boolean;
  api_key_masked: string | null;
  webhook_url: string;
  last_webhook_at: string | null;
  created_at: string;
};

export type MatchType = 'equals' | 'contains' | 'any';
export type ResponseType = 'text' | 'file' | 'quick_reply' | 'cta_url' | 'list' | 'location' | 'flow';
export type MediaType = 'image' | 'video' | 'audio' | 'document';

export type Header = {
  type: 'none' | 'text' | 'image' | 'video' | 'document';
  text?: string;
  url?: string;
  filename?: string;
};

export type TextResponse = { body: string };
export type FileResponse = { media_type: MediaType; url: string; filename?: string; caption?: string };
export type QuickReplyResponse = {
  header?: Header;
  body: string;
  footer?: string;
  buttons: { id: string; title: string }[];
};
export type CtaUrlResponse = { header?: Header; body: string; footer?: string; display_text: string; url: string };
export type ListResponse = {
  header_text?: string;
  body: string;
  footer?: string;
  button_text: string;
  sections: { title: string; rows: { id: string; title: string; description?: string }[] }[];
};
export type LocationResponse = { latitude: number | string; longitude: number | string; name?: string; address?: string };
export type FlowRefResponse = { flow_id: string };

export type AnyResponse =
  | TextResponse
  | FileResponse
  | QuickReplyResponse
  | CtaUrlResponse
  | ListResponse
  | LocationResponse
  | FlowRefResponse;

export type Trigger = {
  id: string;
  name: string;
  match_type: MatchType;
  keywords: string[];
  source: string | null;
  response_type: ResponseType;
  response: AnyResponse;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  created_by: User | null;
  updated_by: User | null;
};

export type TriggerInput = Omit<Trigger, 'id' | 'created_at' | 'updated_at' | 'created_by' | 'updated_by'>;

export type TryResult = { trigger: Trigger | null; matched_keyword: string | null; reason: string };

// Flows — graph is stored in React Flow's own shape. See backend app/services/flows.py.
export type FlowNodeType = 'start' | 'send' | 'buttons' | 'list' | 'question';
export type SendType = 'text' | 'file' | 'cta_url' | 'location';
export type QuestionCase = { id: string; match_type: 'equals' | 'contains'; keywords: string[] };
export type FlowNodeData = {
  response_type?: SendType; // send
  response?: AnyResponse; // send, buttons (QuickReplyResponse), list (ListResponse)
  body?: string; // question
  cases?: QuestionCase[]; // question
};
export type FlowGraphNode = { id: string; type: FlowNodeType; position: { x: number; y: number }; data: FlowNodeData };
export type FlowGraphEdge = { id: string; source: string; target: string; sourceHandle?: string | null };
export type FlowGraph = { nodes: FlowGraphNode[]; edges: FlowGraphEdge[] };
export type FlowStatus = 'active' | 'draft';

export type FlowSummary = {
  id: string;
  name: string;
  description: string | null;
  status: FlowStatus;
  node_count: number;
  triggers: { id: string; name: string; match_type: MatchType; keywords: string[]; is_active: boolean }[];
  created_at: string;
  updated_at: string;
  created_by: User | null;
  updated_by: User | null;
};
export type Flow = FlowSummary & { graph: FlowGraph };

export type SimulateResult = {
  outputs: { node_id: string; response_type: ResponseType; response: AnyResponse }[];
  waiting_node_id: string | null;
  note: string | null;
};

// ── Fetch ──────────────────────────────────────────

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function errorMessage(body: unknown): string {
  const detail = (body as { detail?: unknown })?.detail;
  if (typeof detail === 'string') return detail;
  // FastAPI validation errors: [{loc, msg}, ...]
  if (Array.isArray(detail) && detail.length) {
    return detail.map((d) => String(d.msg ?? '').replace(/^Value error, /, '')).join('. ');
  }
  return 'Something went wrong';
}

export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = useSession.getState().token;
  const headers: Record<string, string> = {
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers as Record<string, string>),
  };
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { ...options, headers });
  } catch {
    throw new ApiError(0, 'Could not reach the server');
  }

  if (res.status === 401 && token) {
    useSession.getState().logout();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new ApiError(res.status, errorMessage(body));
  }
  if (res.status === 204) return undefined as T;
  return res.json();
}

export const json = (body: unknown, method = 'POST'): RequestInit => ({ method, body: JSON.stringify(body) });

// ── Endpoints ──────────────────────────────────────

export const endpoints = {
  login: (email: string, password: string) =>
    api<{ access_token: string; user: User }>('/api/auth/login', json({ email, password })),

  workspaces: () => api<Workspace[]>('/api/workspaces'),
  createWorkspace: (body: { name: string; api_key?: string | null; is_active?: boolean }) =>
    api<Workspace>('/api/workspaces', json(body)),
  updateWorkspace: (id: string, body: { name: string; api_key?: string | null; is_active: boolean }) =>
    api<Workspace>(`/api/workspaces/${id}`, json(body, 'PUT')),
  deleteWorkspace: (id: string) => api<void>(`/api/workspaces/${id}`, { method: 'DELETE' }),
  rotateWebhook: (id: string) => api<Workspace>(`/api/workspaces/${id}/rotate-webhook`, { method: 'POST' }),
  testSend: (id: string, to: string, text: string) =>
    api<{ ok: boolean }>(`/api/workspaces/${id}/test-send`, json({ to, text })),

  triggers: (ws: string) => api<Trigger[]>(`/api/workspaces/${ws}/triggers`),
  trigger: (ws: string, id: string) => api<Trigger>(`/api/workspaces/${ws}/triggers/${id}`),
  createTrigger: (ws: string, body: TriggerInput) => api<Trigger>(`/api/workspaces/${ws}/triggers`, json(body)),
  updateTrigger: (ws: string, id: string, body: TriggerInput) =>
    api<Trigger>(`/api/workspaces/${ws}/triggers/${id}`, json(body, 'PUT')),
  setTriggerStatus: (ws: string, id: string, is_active: boolean) =>
    api<Trigger>(`/api/workspaces/${ws}/triggers/${id}/status`, json({ is_active }, 'PATCH')),
  deleteTrigger: (ws: string, id: string) => api<void>(`/api/workspaces/${ws}/triggers/${id}`, { method: 'DELETE' }),
  bulkDeleteTriggers: (ws: string, ids: string[]) =>
    api<void>(`/api/workspaces/${ws}/triggers/bulk-delete`, json({ ids })),
  tryMessage: (ws: string, body: { message: string; message_type: 'text' | 'button' | 'media'; source?: string }) =>
    api<TryResult>(`/api/workspaces/${ws}/triggers/try`, json(body)),

  flows: (ws: string) => api<FlowSummary[]>(`/api/workspaces/${ws}/flows`),
  flow: (ws: string, id: string) => api<Flow>(`/api/workspaces/${ws}/flows/${id}`),
  createFlow: (ws: string, body: { name: string; description?: string }) =>
    api<Flow>(`/api/workspaces/${ws}/flows`, json(body)),
  saveFlow: (ws: string, id: string, body: { name: string; description: string | null; status: FlowStatus; graph: FlowGraph }) =>
    api<Flow>(`/api/workspaces/${ws}/flows/${id}`, json(body, 'PUT')),
  duplicateFlow: (ws: string, id: string) => api<Flow>(`/api/workspaces/${ws}/flows/${id}/duplicate`, { method: 'POST' }),
  deleteFlow: (ws: string, id: string) => api<void>(`/api/workspaces/${ws}/flows/${id}`, { method: 'DELETE' }),
  simulateFlow: (ws: string, id: string, body: { graph: FlowGraph; waiting_node_id: string | null; message: string }) =>
    api<SimulateResult>(`/api/workspaces/${ws}/flows/${id}/simulate`, json(body)),

  upload: (ws: string, file: File) => {
    const form = new FormData();
    form.append('file', file);
    return api<{ url: string; filename: string; size: number }>(`/api/workspaces/${ws}/uploads`, {
      method: 'POST',
      body: form,
    });
  },
};

// ── Display helpers ────────────────────────────────

export const MATCH_LABEL: Record<MatchType, string> = {
  equals: 'Equals',
  contains: 'Contains',
  any: 'Any message',
};

export const RESPONSE_LABEL: Record<ResponseType, string> = {
  text: 'Text',
  file: 'File',
  quick_reply: 'Quick Reply',
  cta_url: 'CTA URL',
  list: 'List',
  location: 'Location',
  flow: 'Flow',
};

export function timeAgo(iso: string): string {
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB');
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' });
}
