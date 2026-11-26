/**
 * StudyKit v0.4 — `backend/tests/mockDb`
 *
 * In-memory implementation of the SQL fragments
 * the WP-08 Round 3 collab routes use. The
 * mock lets the round-3 smoke (and the unit
 * tests) run without a live Postgres. The mock
 * is **strict**: any SQL the routes execute
 * that the mock does not implement throws
 * (the error message lists the unhandled SQL),
 * so missing coverage surfaces immediately.
 *
 * The shape mirrors the real `db.js` (a
 * `query(text, params)` and a `getClient()`);
 * the routes are unchanged.
 */

function makeMockDb() {
  // Per-table in-memory store. The mock
  // implements the SQL the routes need; it
  // does NOT implement a full SQL parser.
  const tables = {
    users: new Map(),
    workspaces: new Map(),
    collab_projects: new Map(),
    collab_memberships: new Map(),
    collab_activities: new Map(),
    collab_op_log: new Map(),
    device_clients: new Map(),
    sync_operations: new Map(),
  };

  const membershipKey = (pid, uid) => `${pid}|${uid}`;
  const opKey = (cid, oid) => `${cid}|${oid}`;

  function membershipRows() {
    return Array.from(tables.collab_memberships.values());
  }
  function projectRows() {
    return Array.from(tables.collab_projects.values());
  }
  function activityRows() {
    return Array.from(tables.collab_activities.values());
  }
  function opLogRows() {
    return Array.from(tables.collab_op_log.values());
  }
  function userRows() {
    return Array.from(tables.users.values());
  }
  function workspaceRows() {
    return Array.from(tables.workspaces.values());
  }

  async function query(text, params = []) {
    const sql = text.replace(/\s+/g, ' ').trim();
    if (process.env.MOCK_DB_DEBUG) {
      // eslint-disable-next-line no-console
      console.log(`[mockDb] query: ${sql.slice(0, 100)}`);
    }

    if (/^SELECT id FROM workspaces/i.test(sql)) {
      const [userId] = params;
      const ws = workspaceRows().filter(
        (w) => w.owner_user_id === userId && w.deleted_at == null,
      );
      return { rows: ws.map((w) => ({ id: w.id })) };
    }

    if (/^SELECT id, user_id FROM device_clients WHERE id = \$/i.test(sql)) {
      const row = tables.device_clients.get(params[0]);
      return { rows: row ? [{ id: row.id, user_id: row.user_id }] : [] };
    }

    if (/^SELECT id FROM device_clients WHERE id = \$1 AND user_id = \$2/i.test(sql)) {
      const row = tables.device_clients.get(params[0]);
      return { rows: row && row.user_id === params[1] ? [{ id: row.id }] : [] };
    }

    if (/^INSERT INTO device_clients/i.test(sql)) {
      const [id, userId, label] = params;
      tables.device_clients.set(id, {
        id,
        user_id: userId,
        label,
        last_seen_at: new Date(),
      });
      return { rows: [] };
    }

    if (/^UPDATE device_clients/i.test(sql)) {
      const id = params.length > 1 ? params[1] : params[0];
      const row = tables.device_clients.get(id);
      if (row) {
        tables.device_clients.set(id, { ...row, last_seen_at: new Date() });
      }
      return { rows: [] };
    }

    if (/^SELECT MAX\(sequence_number\) as cursor FROM sync_operations/i.test(sql)) {
      return { rows: [{ cursor: 0 }] };
    }

    if (/^SELECT id, workspace_id, device_id, sequence_number, target_table, target_id, operation_type/i.test(sql)) {
      return { rows: [] };
    }

    if (/^SELECT id, target_id, target_table, patch_json FROM sync_operations/i.test(sql)) {
      return { rows: [] };
    }

    if (/^SELECT id, workspace_id, title, code, academic_term, colour, sort_order/i.test(sql)) {
      return { rows: [] };
    }

    if (/^SELECT id, workspace_id, name, description, created_at, updated_at FROM literature_projects/i.test(sql)) {
      return { rows: [] };
    }

    if (/^SELECT id, auth_status, provider_user_id, provider_display_name, created_at, disconnected_at FROM external_accounts/i.test(sql)) {
      return { rows: [] };
    }

    if (/^SELECT id FROM users WHERE id = \$/i.test(sql)) {
      const [id] = params;
      const u = tables.users.get(id);
      return { rows: u ? [{ id: u.id }] : [] };
    }

    if (/^SELECT project_id, user_id, role, display_name FROM collab_memberships/i.test(sql)) {
      const [pid, uid] = params;
      const row = tables.collab_memberships.get(membershipKey(pid, uid));
      return { rows: row ? [row] : [] };
    }

    if (/^SELECT p\.id, p\.workspace_id, p\.name, p\.kind, p\.owner_user_id/i.test(sql)) {
      const [userId] = params;
      const myMemberships = membershipRows().filter((m) => m.user_id === userId);
      const projects = myMemberships
        .map((m) => tables.collab_projects.get(m.project_id))
        .filter((p) => p && p.deleted_at == null)
        .map((p) => {
          const m = tables.collab_memberships.get(membershipKey(p.id, userId));
          return { ...p, role: m.role };
        });
      return { rows: projects };
    }

    if (/^SELECT id, workspace_id, name, kind, owner_user_id, created_at, updated_at FROM collab_projects WHERE id = \$/i.test(sql)) {
      const [id] = params;
      const p = tables.collab_projects.get(id);
      return { rows: p ? [p] : [] };
    }

    if (/^INSERT INTO collab_projects/i.test(sql)) {
      const [id, workspaceId, name, kind, ownerUserId] = params;
      if (tables.collab_projects.has(id)) {
        return { rows: [tables.collab_projects.get(id)] };
      }
      const now = new Date();
      const row = {
        id, workspace_id: workspaceId, name, kind,
        owner_user_id: ownerUserId,
        created_at: now, updated_at: now, deleted_at: null,
      };
      tables.collab_projects.set(id, row);
      return { rows: [row] };
    }

    if (/^INSERT INTO collab_memberships/i.test(sql)) {
      const [pid, uid, role, addedBy, displayName] = params;
      const key = membershipKey(pid, uid);
      if (tables.collab_memberships.has(key)) {
        return { rows: [] };
      }
      const row = {
        project_id: pid, user_id: uid, role,
        added_by: addedBy, display_name: displayName,
        added_at: new Date(),
      };
      tables.collab_memberships.set(key, row);
      return { rows: [row] };
    }

    if (/^SELECT project_id, user_id, role, display_name, (?:added_by, )?added_at FROM collab_memberships WHERE project_id = \$/i.test(sql)) {
      const [pid] = params;
      const rows = membershipRows()
        .filter((m) => m.project_id === pid)
        .sort((a, b) => a.added_at - b.added_at);
      return { rows };
    }

    if (/^UPDATE collab_memberships SET role = \$3/i.test(sql)) {
      const [pid, uid, role] = params;
      const key = membershipKey(pid, uid);
      const row = tables.collab_memberships.get(key);
      if (!row || row.role === 'owner') return { rows: [] };
      const next = { ...row, role };
      tables.collab_memberships.set(key, next);
      return { rows: [next] };
    }

    if (/^DELETE FROM collab_memberships WHERE project_id = \$1/i.test(sql)) {
      const [pid, uid] = params;
      const key = membershipKey(pid, uid);
      const row = tables.collab_memberships.get(key);
      if (!row || row.role === 'owner') return { rows: [] };
      tables.collab_memberships.delete(key);
      return { rows: [{ user_id: uid }] };
    }

    if (/^SELECT id, project_id, actor_user_id, actor_name, actor_type, kind/i.test(sql)) {
      const [pid, sinceMs, sinceId, limit] = params;
      let rows = activityRows().filter((a) => a.project_id === pid);
      rows = rows.filter((a) => {
        const ms = Date.parse(a.created_at.toISOString());
        if (ms > sinceMs) return true;
        if (ms === sinceMs && sinceId && a.id > sinceId) return true;
        return false;
      });
      rows = rows.sort((a, b) => a.created_at - b.created_at).slice(0, limit);
      return { rows };
    }

    if (/^INSERT INTO collab_activities/i.test(sql)) {
      const [id, pid, actorUserId, actorName, actorType, kind,
        targetKind, targetId, summary, body, payloadJson] = params;
      if (tables.collab_activities.has(id)) {
        return { rows: [] };
      }
      const row = {
        id, project_id: pid,
        actor_user_id: actorUserId, actor_name: actorName,
        actor_type: actorType, kind,
        target_kind: targetKind, target_id: targetId,
        summary, body, payload_json: payloadJson,
        created_at: new Date(),
      };
      tables.collab_activities.set(id, row);
      return { rows: [row] };
    }

    if (/^INSERT INTO collab_op_log/i.test(sql)) {
      const [id, pid, clientId, kind, payloadJson, baseVersion] = params;
      const key = opKey(clientId, id);
      if (tables.collab_op_log.has(key)) {
        return { rows: [] };
      }
      const row = {
        id, project_id: pid, client_id: clientId,
        kind, payload_json: payloadJson,
        base_version: baseVersion, created_at: new Date(),
      };
      tables.collab_op_log.set(key, row);
      return { rows: [row] };
    }

    if (/^SELECT payload_json FROM collab_op_log WHERE project_id = \$1 AND kind = 'ai-thread-created'/i.test(sql)) {
      const [pid] = params;
      return { rows: opLogRows().filter((o) => o.project_id === pid && o.kind === 'ai-thread-created') };
    }

    if (/^SELECT id, project_id, client_id, kind, payload_json, base_version, created_at FROM collab_op_log/i.test(sql)) {
      const [pid, clientId, sinceMs, sinceId, limit] = params;
      let rows = opLogRows().filter(
        (o) => o.project_id === pid && o.client_id !== clientId,
      );
      rows = rows.filter((o) => {
        const ms = Date.parse(o.created_at.toISOString());
        if (ms > sinceMs) return true;
        if (ms === sinceMs && sinceId && o.id > sinceId) return true;
        return false;
      });
      rows = rows.sort((a, b) => a.created_at - b.created_at).slice(0, limit);
      return { rows };
    }

    // Auth-related queries (for the smoke's
    // /api/auth/register + login flow).
    if (/^INSERT INTO users/i.test(sql)) {
      const [id, email, passwordHash, displayName, createdAt] = params;
      if (tables.users.has(id)) {
        return { rows: [] };
      }
      const row = { id, email, password_hash: passwordHash, display_name: displayName, created_at: createdAt };
      tables.users.set(id, row);
      return { rows: [row] };
    }
    if (/^INSERT INTO workspaces/i.test(sql)) {
      const [id, ownerUserId, name, settingsJson] = params;
      if (tables.workspaces.has(id)) {
        return { rows: [] };
      }
      const row = {
        id, owner_user_id: ownerUserId, name,
        settings_json: typeof settingsJson === 'string' ? JSON.parse(settingsJson) : settingsJson,
        created_at: new Date(), updated_at: new Date(), deleted_at: null,
      };
      tables.workspaces.set(id, row);
      return { rows: [row] };
    }
    if (/^SELECT \* FROM users WHERE email = \$/i.test(sql) || /^SELECT id, email, password_hash, display_name, created_at FROM users WHERE email = \$/i.test(sql) || /^SELECT id FROM users WHERE email = \$/i.test(sql)) {
      const [email] = params;
      const u = userRows().find((u) => u.email === email);
      return { rows: u ? [u] : [] };
    }
    if (/^SELECT id, email, display_name, created_at FROM users WHERE id = \$/i.test(sql)) {
      const [id] = params;
      const u = tables.users.get(id);
      return { rows: u ? [{ id: u.id, email: u.email, display_name: u.display_name, created_at: u.created_at }] : [] };
    }

    // Unhandled SQL — fail loudly so the
    // test suite surfaces missing mock
    // coverage.
    throw new Error(`mock db: unhandled SQL: ${sql}`);
  }

  async function getClient() {
    const state = { inTxn: false };
    const client = {
      query: async (text, params) => {
        const sql = text.replace(/\s+/g, ' ').trim();
        if (sql === 'BEGIN') { state.inTxn = true; return { rows: [] }; }
        if (sql === 'COMMIT') { state.inTxn = false; return { rows: [] }; }
        if (sql === 'ROLLBACK') { state.inTxn = false; return { rows: [] }; }
        return query(text, params);
      },
      release: () => undefined,
    };
    return client;
  }

  // Auto-seed a workspace for a new user
  // (matches the real backend's behaviour on
  // register).
  function seedWorkspaceForUser(userId) {
    const wsId = `ws_${userId}`;
    if (!tables.workspaces.has(wsId)) {
      tables.workspaces.set(wsId, {
        id: wsId,
        owner_user_id: userId,
        name: 'Default',
        settings_json: {},
        created_at: new Date(),
        updated_at: new Date(),
        deleted_at: null,
      });
    }
    return wsId;
  }

  return { query, getClient, _tables: tables, seedWorkspaceForUser };
}

module.exports = { makeMockDb };
