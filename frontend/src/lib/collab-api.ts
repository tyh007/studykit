/**
 * StudyKit v0.4 — `lib/collab-api` (Collaboration async gateway)
 *
 * The minimal HTTP transport the WP-08 Round 2
 * "real async collaboration path" requires.
 *
 * Background
 * ----------
 *
 * The WP-08 brief promises "可靠异步协作" — reliable
 * async collaboration. `BroadcastChannel` only
 * delivers envelopes to *same-origin* tabs; it is
 * not a durable cross-user transport. The real
 * async path is an HTTP gateway with an
 * outbox/inbox pattern:
 *
 *   - **Outbox** — every successful use case write
 *     appends a `CollabOp` to the local outbox
 *     (Dexie v8). The outbox is the durable
 *     record of "what we wrote but have not yet
 *     acked". A drain loop POSTs unsynced ops to
 *     the server; on success the op is marked
 *     `syncedAt`.
 *   - **Inbox** — a pull loop GETs ops since the
 *     last cursor. Each remote op is applied to
 *     the local `CollaborationRepository` /
 *     `ResearchRepository` (private scratches are
 *     NEVER pushed, so the inbox never carries
 *     another member's private data).
 *   - **Conflict** — when an inbox op collides
 *     with a local row (same id, different
 *     content), the sync service records a
 *     `Conflict` row in the collaboration repo
 *     instead of silently overwriting.
 *
 * The gateway is a thin HTTP client. The smoke
 * test ships a real Node.js HTTP server in
 * `scripts/smoke-collaboration.cjs`; the
 * production backend (when it ships) will reuse
 * the same protocol so the client does not
 * change.
 *
 * What is *not* in this file
 * --------------------------
 *
 *   - Conflict *detection* — the inbox apply step
 *     delegates to `syncService.applyRemoteOp`,
 *     which uses the existing `Conflict` use case
 *     to record non-destructive conflicts.
 *   - Cursor persistence — the smoke holds the
 *     cursor in memory; the production server
 *     backs the cursor with a per-client row.
 *
 * Why not Yjs / CRDT? Per the spec and the
 * master's plan, the v0.4 first Beta commits to
 * "reliable async collaboration", not live
 * co-editing. Realtime presence / CRDT are
 * explicit future work; the gateway here is the
 * minimum that makes "two devices can read the
 * same project" real.
 */

import type { AiDraftDecision, AiMessage, AiThread } from '../domain/aiThread';
import type {
  Activity,
  Collaborator,
  Comment,
  Conflict,
  RealtimeEnvelope,
} from '../domain/collaboration';
import type { ResearchTask } from '../domain/researchDesign';

// ---------------------------------------------------------------------------
// Op shape
// ---------------------------------------------------------------------------

/**
 * The closed set of cross-user ops the gateway
 * carries. The set mirrors the durable events the
 * collaboration slice produces. Private scratches
 * are deliberately absent — they are owner-only
 * and never leave the local store.
 *
 * `membership-bootstrap` carries the local user's
 * own membership row so a freshly-joined user can
 * surface in the other side's member list without
 * a separate "add member" round-trip.
 */
export type CollabOpKind =
  | 'membership-bootstrap'
  | 'member-added'
  | 'member-role-changed'
  | 'member-removed'
  | 'comment-posted'
  | 'comment-resolved'
  | 'activity-logged'
  | 'task-shared'
  | 'task-assigned'
  | 'task-status-changed'
  | 'conflict-detected'
  // v0.5 P4b: shared project AI threads (ADR-003 §5).
  | 'ai-thread-created'
  | 'ai-thread-updated'
  | 'ai-message-appended'
  | 'ai-draft-decided';

export const COLLAB_OP_KINDS: readonly CollabOpKind[] = [
  'membership-bootstrap',
  'member-added',
  'member-role-changed',
  'member-removed',
  'comment-posted',
  'comment-resolved',
  'activity-logged',
  'task-shared',
  'task-assigned',
  'task-status-changed',
  'conflict-detected',
  'ai-thread-created',
  'ai-thread-updated',
  'ai-message-appended',
  'ai-draft-decided',
] as const;

export interface CollabOp {
  /**
   * Stable per-op id. The op id is the
   * idempotency key: the server dedupes pushes
   * by `id`; the inbox skips ops already
   * applied.
   */
  readonly id: string;
  /** The originating client's id. The
   *  server uses this to prevent a client from
   *  pulling its own writes (the inbox skips
   *  ops with `clientId === self`). */
  readonly clientId: string;
  readonly projectId: string;
  readonly kind: CollabOpKind;
  /** JSON-serialised payload. The shape
   *  depends on `kind`:
   *    - membership-bootstrap / member-* : Collaborator
   *    - comment-posted / comment-resolved : Comment
   *    - activity-logged : Activity
   *    - task-shared : { task: ResearchTask, scratchId, scratchTitle }
   *    - conflict-detected : Conflict
   */
  readonly payload: string;
  /** For version-based writes (Comment edits,
   *  Scratch publishes): the writer's
   *  `baseVersion`. The inbox apply step uses
   *  this to detect a conflict with a
   *  concurrent local write. */
  readonly baseVersion?: number | string;
  readonly createdAt: string;
}

/**
 * The set of payload types the gateway can carry.
 * Each `CollabOp` payload is one of these, JSON-
 * serialised. The map is exhaustive: every
 * `CollabOpKind` is covered.
 */
export interface CollabOpPayloads {
  'membership-bootstrap': Collaborator;
  'member-added': Collaborator;
  'member-role-changed': Collaborator;
  'member-removed': { readonly collaboratorId: string; readonly projectId: string };
  'comment-posted': Comment;
  'comment-resolved': Comment;
  'activity-logged': Activity;
  'task-shared': {
    readonly task: ResearchTask;
    readonly scratchId: string;
    readonly scratchTitle: string;
  };
  'task-assigned': {
    readonly taskId: string;
    readonly projectId: string;
    readonly assignee: { readonly userId: string; readonly displayName: string } | null;
    readonly previousAssignee: { readonly userId: string; readonly displayName: string } | null;
  };
  'task-status-changed': {
    readonly taskId: string;
    readonly projectId: string;
    readonly status: ResearchTask['status'];
    readonly previousStatus: ResearchTask['status'] | null;
  };
  'conflict-detected': Conflict;
  'ai-thread-created': AiThread;
  'ai-thread-updated': AiThread;
  'ai-message-appended': AiMessage;
  'ai-draft-decided': AiDraftDecision;
}

// ---------------------------------------------------------------------------
// Gateway interface
// ---------------------------------------------------------------------------

export interface PushResult {
  /** Op ids the server accepted. The op with
   *  an `accepted` id can be marked
   *  `syncedAt` in the outbox. */
  readonly accepted: readonly string[];
  /** Op ids the server rejected (e.g. duplicate
   *  id, schema mismatch). The op stays in the
   *  outbox for retry; the next drain
   *  re-attempts. */
  readonly rejected: readonly { readonly id: string; readonly reason: string }[];
}

export interface PullResult {
  /** Ops the server returned. The inbox applies
   *  each one; ops with `clientId === self` are
   *  filtered out before apply. */
  readonly ops: readonly CollabOp[];
  /** The new cursor. The client stores this as
   *  the per-project cursor; the next pull
   *  passes it back as `since`. */
  readonly cursor: string;
}

export interface SharedProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly kind: string;
  readonly owner_user_id: string;
  readonly role: string;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ServerMembership {
  readonly project_id: string;
  readonly user_id: string;
  readonly role: 'owner' | 'editor' | 'commenter' | 'viewer';
  readonly display_name: string;
  readonly added_by: string;
  readonly added_at: string;
}

export interface CollabGateway {
  readonly id: string;
  listProjects(): Promise<{ readonly projects: readonly SharedProjectSummary[] }>;
  createProject(input: { readonly id: string; readonly name: string; readonly kind: string; readonly owner_user_id: string }): Promise<{ readonly project: unknown }>;
  inviteMember(input: { readonly projectId: string; readonly user_id: string; readonly role: string; readonly display_name: string }): Promise<{ readonly membership: ServerMembership }>;
  listMembers(input: { readonly projectId: string }): Promise<{ readonly memberships: readonly ServerMembership[] }>;
  changeMemberRole(input: { readonly projectId: string; readonly userId: string; readonly role: string }): Promise<{ readonly membership: ServerMembership }>;
  removeMember(input: { readonly projectId: string; readonly userId: string }): Promise<void>;
  pushOps(input: { readonly clientId: string; readonly projectId: string; readonly ops: readonly CollabOp[] }): Promise<PushResult>;
  pullOps(input: {
    readonly clientId: string;
    readonly projectId: string;
    readonly since: string | null;
    /** Maximum number of ops to return in one
     *  pull. The client pages by passing the
     *  returned `cursor` back as `since`. */
    readonly limit?: number;
  }): Promise<PullResult>;
}

// ---------------------------------------------------------------------------
// Noop gateway (default; smoke opts into HttpCollabGateway)
// ---------------------------------------------------------------------------

export class NoopCollabGateway implements CollabGateway {
  readonly id: string = 'noop';
  async listProjects(): Promise<{ projects: readonly SharedProjectSummary[] }> {
    return { projects: [] };
  }
  async createProject(): Promise<{ project: unknown }> {
    throw new Error('Shared collaboration is unavailable in this workspace.');
  }
  async inviteMember(): Promise<{ membership: ServerMembership }> {
    throw new Error('Shared collaboration is unavailable in this workspace.');
  }
  async listMembers(): Promise<{ memberships: readonly ServerMembership[] }> {
    return { memberships: [] };
  }
  async changeMemberRole(): Promise<{ membership: ServerMembership }> {
    throw new Error('Shared collaboration is unavailable in this workspace.');
  }
  async removeMember(): Promise<void> {
    throw new Error('Shared collaboration is unavailable in this workspace.');
  }
  async pushOps(_input: { clientId: string; projectId: string; ops: readonly CollabOp[] }): Promise<PushResult> {
    return { accepted: [], rejected: [] };
  }
  async pullOps(_input: { clientId: string; projectId: string; since: string | null; limit?: number }): Promise<PullResult> {
    return { ops: [], cursor: 'noop' };
  }
}

// ---------------------------------------------------------------------------
// HTTP gateway
// ---------------------------------------------------------------------------

/**
 * Resolve the collaboration gateway's base URL.
 * The default is the same backend host as the
 * rest of the slice (see `lib/api.ts`): the
 * `VITE_API_URL` env, minus the trailing `/api`,
 * so the gateway can hit `/api/collab/*`. The
 * `baseUrl` option overrides the default for the
 * smoke (which spins a real Express on a
 * different port).
 */
function defaultBaseUrl(): string {
  // The `lib/api.ts` file exposes `API_BASE` only
  // through the `request` helper; here we read the
  // Vite env directly. The trailing `/api` is
  // stripped because the gateway paths already
  // start with `/api/collab/...`.
  const raw = (() => {
    if (typeof globalThis !== 'undefined') {
      const w = globalThis as { __ENV?: { VITE_API_URL?: string } };
      if (w.__ENV?.VITE_API_URL) return w.__ENV.VITE_API_URL;
    }
    try {
      // Vite injects `import.meta.env`; the
      // `any` cast keeps the typecheck honest
      // when this file is imported from a
      // non-Vite context (the smoke test).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const im: any = (import.meta as any);
      if (im?.env?.VITE_API_URL) return im.env.VITE_API_URL as string;
    } catch {
      // ignore
    }
    return '';
  })();
  const base = (raw || '').replace(/\/+$/, '').replace(/\/api$/, '');
  return base || '';
}

export interface HttpCollabGatewayOptions {
  /** The base URL of the server. The default is
   *  the same backend host as the rest of the
   *  slice (see `lib/api.ts`). The smoke spins
   *  a real Express on a different port and
   *  points the gateway at it via this option. */
  readonly baseUrl?: string;
  /** Optional fetch override (the smoke uses
   *  Playwright's `page.request` so the
   *  BrowserContext's cookies are honoured;
   *  production uses the global `fetch`). */
  readonly fetchImpl?: typeof fetch;
  /** Bearer token for the cross-user server.
   *  The default is the local JWT from
   *  `getAuthToken()` (read at request time so
   *  a sign-in / sign-out updates the header
   *  without reconstructing the gateway). */
  readonly authToken?: string | null | (() => string | null);
  /** Request timeout in ms. The default is
   *  5s; the client retries on timeout. */
  readonly timeoutMs?: number;
}

export class HttpCollabGateway implements CollabGateway {
  readonly id: string = 'http';
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly authToken: string | null | (() => string | null);
  private readonly timeoutMs: number;

  constructor(opts: HttpCollabGatewayOptions) {
    this.baseUrl = (opts.baseUrl ?? defaultBaseUrl()).replace(/\/+$/, '');
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.authToken = opts.authToken ?? null;
    this.timeoutMs = opts.timeoutMs ?? 5_000;
  }

  private resolveToken(): string | null {
    if (typeof this.authToken === 'function') return this.authToken();
    return this.authToken;
  }

  private async request<T>(path: string, init: RequestInit): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    const headers = new Headers(init.headers);
    const token = this.resolveToken();
    if (token) headers.set('authorization', `Bearer ${token}`);
    if (init.body && !headers.has('content-type')) {
      headers.set('content-type', 'application/json');
    }
    try {
      const r = await this.fetchImpl(`${this.baseUrl}${path}`, {
        ...init,
        headers,
        signal: ctrl.signal,
      });
      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(
          `HttpCollabGateway ${path} ${init.method ?? 'GET'} returned ${r.status}: ${text.slice(0, 200)}`,
        );
      }
      if (r.status === 204) return undefined as T;
      return (await r.json()) as T;
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * WP-08 Round 3: project listing. The gateway
   * surfaces the projects the caller is a member
   * of so the Research Home can render the list
   * (the dev seam `__studykitDevSmoke.research.seedProject`
   * is gone — the real server is the source of
   * truth).
   */
  async listProjects(): Promise<{ readonly projects: readonly { id: string; name: string; kind: string; owner_user_id: string; role: string; created_at: string; updated_at: string }[] }> {
    return this.request('/api/collab/projects', { method: 'GET' });
  }

  /**
   * Atomic create + owner membership. The server
   * rejects the request unless `owner_user_id`
   * matches the authenticated user; the `id` is
   * client-generated.
   */
  async createProject(input: { id: string; name: string; kind: string; owner_user_id: string }): Promise<{ project: unknown }> {
    return this.request('/api/collab/projects', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  }

  /**
   * Owner-only invite. The role MUST be
   * `editor|commenter|viewer`; the server
   * rejects `owner` (the only path to the
   * `owner` role is the atomic `createProject`).
   */
  async inviteMember(input: { projectId: string; user_id: string; role: string; display_name: string }): Promise<{ membership: ServerMembership }> {
    return this.request(`/api/collab/projects/${input.projectId}/memberships`, {
      method: 'POST',
      body: JSON.stringify({
        user_id: input.user_id,
        role: input.role,
        display_name: input.display_name,
      }),
    });
  }

  /**
   * List the project's members. Caller must be a
   * member; non-members get 403.
   */
  async listMembers(input: { projectId: string }): Promise<{ memberships: readonly ServerMembership[] }> {
    return this.request(`/api/collab/projects/${input.projectId}/memberships`, { method: 'GET' });
  }

  async changeMemberRole(input: { projectId: string; userId: string; role: string }): Promise<{ membership: ServerMembership }> {
    return this.request(`/api/collab/projects/${input.projectId}/memberships/${encodeURIComponent(input.userId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: input.role }),
    });
  }

  async removeMember(input: { projectId: string; userId: string }): Promise<void> {
    await this.request(`/api/collab/projects/${input.projectId}/memberships/${encodeURIComponent(input.userId)}`, {
      method: 'DELETE',
    });
  }

  /**
   * Pull the project's activity feed. The cursor
   * is the `<ms>:<id>` tuple the server returned
   * on the previous pull.
   */
  async listActivities(input: { projectId: string; since?: string }): Promise<{ activities: readonly unknown[]; cursor: string }> {
    const params = new URLSearchParams();
    if (input.since) params.set('since', input.since);
    const qs = params.toString();
    return this.request(`/api/collab/projects/${input.projectId}/activities${qs ? `?${qs}` : ''}`, { method: 'GET' });
  }

  /**
   * Append a single activity row. The server
   * dedupes on the client-supplied `id`. The
   * `actor_user_id` is always set to the
   * authenticated user; a body claim is
   * ignored.
   */
  async postActivity(input: { projectId: string; id: string; actor_name: string; actor_type: 'user' | 'ai' | 'system'; kind: string; target_kind?: string | null; target_id?: string | null; summary: string; body?: string; payload_json: string }): Promise<{ activity: unknown; created: boolean }> {
    return this.request(`/api/collab/projects/${input.projectId}/activities`, {
      method: 'POST',
      body: JSON.stringify({
        id: input.id,
        actor_name: input.actor_name,
        actor_type: input.actor_type,
        kind: input.kind,
        target_kind: input.target_kind ?? null,
        target_id: input.target_id ?? null,
        summary: input.summary,
        body: input.body ?? '',
        payload_json: input.payload_json,
      }),
    });
  }

  async pushOps(input: { clientId: string; projectId: string; ops: readonly CollabOp[] }): Promise<PushResult> {
    return this.request<PushResult>(`/api/collab/projects/${input.projectId}/push`, {
      method: 'POST',
      body: JSON.stringify({ client_id: input.clientId, ops: input.ops }),
    });
  }

  async pullOps(input: {
    clientId: string;
    projectId: string;
    since: string | null;
    limit?: number;
  }): Promise<PullResult> {
    const params = new URLSearchParams();
    params.set('client_id', input.clientId);
    if (input.since) params.set('since', input.since);
    if (input.limit !== undefined) params.set('limit', String(input.limit));
    return this.request<PullResult>(`/api/collab/projects/${input.projectId}/pull?${params.toString()}`, {
      method: 'GET',
    });
  }
}

// ---------------------------------------------------------------------------
// Cursor helper
// ---------------------------------------------------------------------------

/**
 * Build a deterministic cursor from the last
 * applied op. The server uses the same shape so
 * a client and a server can agree on "which ops
 * have I seen". The cursor is the most recent
 * op's `(createdAt, id)` tuple encoded as
 * `<ms>:<id>`; the server returns ops with
 * `(createdAt, id) > cursor` in lexicographic
 * order. The smoke server implements the same
 * comparator; the production server (future) will
 * use Postgres.
 */
export function encodeCursor(op: { readonly createdAt: string; readonly id: string }): string {
  return `${Date.parse(op.createdAt)}:${op.id}`;
}

/**
 * Parse a cursor back into the `createdAt` and
 * `id` of the most recently applied op. The
 * client uses this to log / surface the cursor in
 * the UI; the server compares `(createdAt, id)`.
 */
export function decodeCursor(cursor: string): { readonly createdAtMs: number; readonly id: string } | null {
  const idx = cursor.indexOf(':');
  if (idx <= 0) return null;
  const msRaw = cursor.slice(0, idx);
  const id = cursor.slice(idx + 1);
  const ms = Number(msRaw);
  if (!Number.isFinite(ms) || ms < 0 || id.length === 0) return null;
  return { createdAtMs: ms, id };
}

// ---------------------------------------------------------------------------
// Realtime envelope carrier (kept for the spike's BroadcastChannel layer)
// ---------------------------------------------------------------------------

/**
 * Re-export the realtime envelope type for the
 * spike layer. The `BroadcastChannel` channel is
 * unchanged: it is the *live awareness* layer on
 * top of the durable async gateway. A peer that
 * misses a broadcast still gets the data via the
 * next inbox pull.
 */
export type { RealtimeEnvelope };
