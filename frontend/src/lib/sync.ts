import { useStore } from '../store/useStore';
import { syncApi, getAuthToken } from './api';
import { db } from './db';
import type { SyncOperation } from '../types';

let pushTimer: ReturnType<typeof setInterval> | null = null;
let deviceRegistered = false;
let currentWorkspaceId: string | null = null;

/**
 * Set the sync status indicator.
 * Used by NoteEditor and other components to show save state.
 */
export function setSyncStatus(status: 'synced' | 'pending' | 'error' | 'offline') {
  useStore.getState().setSyncStatus(status);
}

/**
 * Register this device with the backend.
 * If the device ID is already taken by another user, the server returns a new one.
 */
async function registerDevice(): Promise<boolean> {
  try {
    const store = useStore.getState();
    let deviceId = store.deviceId;
    const result = await syncApi.registerDevice(deviceId, navigator.userAgent?.substring(0, 100) || 'StudyKit Web');
    // If server reassigned our device ID (cross-user conflict), update local storage
    if (result.device_id && result.device_id !== deviceId) {
      localStorage.setItem('studykit_device_id', result.device_id);
      // Update the store's deviceId by re-reading from localStorage
      const newId = localStorage.getItem('studykit_device_id') || crypto.randomUUID();
      // Force refresh: update store's internal deviceId
      useStore.setState({ deviceId: newId });
    }
    deviceRegistered = true;
    return true;
  } catch (err) {
    console.warn('Device registration failed (may be offline):', (err as Error)?.message);
    return false;
  }
}

/**
 * Push pending sync operations to the server.
 */
async function pushOperations(): Promise<void> {
  const store = useStore.getState();
  const workspaceId = store.workspace_id;
  const deviceId = store.deviceId;
  const token = getAuthToken();

  if (!workspaceId || !token || !deviceRegistered) return;

  try {
    // Get pending operations from Dexie
    const pendingOps = await db.syncOperations
      .where('workspace_id')
      .equals(workspaceId)
      .filter((op: any) => !op.applied_at)
      .toArray();

    if (pendingOps.length === 0) return;

    // Get last known server cursor from localStorage
    const lastCursor = localStorage.getItem('studykit_sync_cursor') || '0';

    const result = await syncApi.push({
      workspace_id: workspaceId,
      device_id: deviceId,
      last_seen_server_cursor: lastCursor,
      operations: pendingOps.map((op: any) => ({
        id: op.id,
        sequence_number: op.sequence_number,
        target_table: op.target_table,
        target_id: op.target_id,
        operation_type: op.operation_type,
        patch_json: op.patch_json,
        base_version: op.base_version,
      })),
    });

    // Mark pushed operations as applied
    for (const op of pendingOps) {
      await db.syncOperations.update(op.id, { applied_at: new Date().toISOString() });
    }

    // Update server cursor
    if (result.server_cursor) {
      localStorage.setItem('studykit_sync_cursor', result.server_cursor);
    }

    // Handle conflicts
    if (result.conflicts && result.conflicts.length > 0) {
      console.warn('Sync conflicts detected:', result.conflicts);
      store.setSyncStatus('error');
    } else {
      store.setSyncStatus('synced');
    }
  } catch (err) {
    console.warn('Sync push failed:', (err as Error)?.message);
    store.setSyncStatus('offline');
  }
}

/**
 * Pull remote operations from the server.
 */
async function pullOperations(): Promise<void> {
  const store = useStore.getState();
  const workspaceId = store.workspace_id;
  const token = getAuthToken();

  if (!workspaceId || !token || !deviceRegistered) return;

  try {
    const lastCursor = localStorage.getItem('studykit_sync_cursor') || '0';

    const result = await syncApi.pull(workspaceId, lastCursor);

    // Update server cursor
    if (result.server_cursor && result.server_cursor !== lastCursor) {
      localStorage.setItem('studykit_sync_cursor', result.server_cursor);
    }

    // Apply remote operations to local Dexie
    for (const op of result.operations) {
      await applyRemoteOperation(op);
    }

    // Record pulled operations locally to avoid re-pulling
    for (const op of result.operations) {
      const exists = await db.syncOperations.get(op.id);
      if (!exists) {
        await db.syncOperations.add({
          id: op.id,
          workspace_id: op.workspace_id,
          device_id: op.device_id,
          sequence_number: op.sequence_number,
          target_table: op.target_table,
          target_id: op.target_id,
          operation_type: op.operation_type,
          patch_json: op.patch_json,
          base_version: op.base_version,
          created_at: op.created_at,
          applied_at: op.applied_at,
        } as any);
      }
    }
  } catch (err) {
    // Silent fail for pull — it's not critical
    console.debug('Sync pull skipped (offline or not ready)');
  }
}

/**
 * Apply a single remote operation to local Dexie.
 */
async function applyRemoteOperation(op: any): Promise<void> {
  try {
    const { target_table, target_id, operation_type, patch_json } = op;

    switch (target_table) {
      case 'modules':
        if (operation_type === 'delete') {
          await db.modules.update(target_id, { deleted_at: new Date().toISOString() } as any);
        }
        break;
      case 'lectures':
        if (operation_type === 'delete') {
          await db.lectures.update(target_id, { deleted_at: new Date().toISOString() } as any);
        }
        break;
      case 'note_blocks':
        if (operation_type === 'delete') {
          await db.noteBlocks.update(target_id, { deleted_at: new Date().toISOString() } as any);
        }
        break;
      // More target tables can be added as sync expands
    }
  } catch (err) {
    console.warn('Failed to apply remote operation:', err);
  }
}

/**
 * Record a local operation for later sync.
 */
export async function recordOperation(
  targetTable: string,
  targetId: string,
  operationType: string,
  patchJson: any,
  baseVersion?: number,
): Promise<void> {
  const store = useStore.getState();
  const workspaceId = store.workspace_id;
  const deviceId = store.deviceId;

  if (!workspaceId) return;

  // Get next sequence number for this device
  const existingOps = await db.syncOperations
    .where('device_id')
    .equals(deviceId)
    .reverse()
    .sortBy('sequence_number');

  const lastSeq = existingOps.length > 0 ? existingOps[0].sequence_number : 0;

  await db.syncOperations.add({
    id: crypto.randomUUID(),
    workspace_id: workspaceId,
    device_id: deviceId,
    sequence_number: lastSeq + 1,
    target_table: targetTable,
    target_id: targetId,
    operation_type: operationType,
    patch_json: patchJson,
    base_version: baseVersion,
    created_at: new Date().toISOString(),
  } as any);
}

/**
 * Initialize sync detection and periodic sync.
 * Registers the device and starts push/pull cycles.
 */
export async function initSyncDetection() {
  const store = useStore.getState();

  // Set initial status
  store.setSyncStatus('synced');

  // Listen for auth change: register device when token is available
  const token = getAuthToken();
  if (token && store.workspace_id) {
    currentWorkspaceId = store.workspace_id;
    deviceRegistered = await registerDevice();
  }

  // Re-register device if workspace_id changes (user switch)
  useStore.subscribe((state) => {
    if (state.workspace_id && state.workspace_id !== currentWorkspaceId) {
      currentWorkspaceId = state.workspace_id;
      deviceRegistered = false;
      registerDevice().then((ok) => {
        deviceRegistered = ok;
        if (ok) {
          pushOperations().catch(() => {});
          pullOperations().catch(() => {});
        }
      });
    }
  });

  // Listen for online/offline events
  window.addEventListener('online', async () => {
    store.setSyncStatus('synced');
    if (!deviceRegistered) {
      deviceRegistered = await registerDevice();
    }
    if (deviceRegistered) {
      await pushOperations();
      await pullOperations();
    }
  });

  window.addEventListener('offline', () => {
    store.setSyncStatus('offline');
  });

  // Listen for custom events from NoteEditor
  window.addEventListener('studykit:notes:saved', async () => {
    if (deviceRegistered) {
      // Don't block — fire and forget
      pushOperations().catch(() => {});
    }
  });

  // Periodic sync every 30 seconds if device is registered
  if (pushTimer) clearInterval(pushTimer);
  pushTimer = setInterval(async () => {
    if (!deviceRegistered || !getAuthToken() || !store.workspace_id) return;
    await pushOperations();
    await pullOperations();
  }, 30000);

  // Retry registration every 10 seconds until successful
  const regRetry = setInterval(async () => {
    if (deviceRegistered || !getAuthToken()) {
      clearInterval(regRetry);
      return;
    }
    deviceRegistered = await registerDevice();
  }, 10000);
}

// Expose a way to trigger manual sync (called on login)
export async function triggerSync(workspaceId: string): Promise<void> {
  const store = useStore.getState();
  store.setSyncStatus('pending');

  if (!deviceRegistered) {
    deviceRegistered = await registerDevice();
  }

  if (deviceRegistered) {
    await pushOperations();
    await pullOperations();
  }

  store.setSyncStatus('synced');
}
