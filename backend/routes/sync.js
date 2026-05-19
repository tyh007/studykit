const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');

const router = express.Router();

// ===== Device Client Registration =====

// POST /api/sync/devices — register or update a device client
router.post('/devices', async (req, res) => {
  try {
    const { device_id, label } = req.body;
    if (!device_id) {
      return res.status(400).json({ error: 'device_id is required' });
    }

    // Get user's workspace
    const ws = await db.query(
      'SELECT id FROM workspaces WHERE owner_user_id = $1 AND deleted_at IS NULL LIMIT 1',
      [req.user.id]
    );
    if (ws.rows.length === 0) {
      return res.status(400).json({ error: 'No workspace found' });
    }

    // Upsert device client — check user_id ownership to prevent cross-user leakage
    const existing = await db.query(
      'SELECT id, user_id FROM device_clients WHERE id = $1',
      [device_id]
    );

    if (existing.rows.length > 0) {
      if (existing.rows[0].user_id !== req.user.id) {
        // Device ID belongs to another user — generate a new one
        const newDeviceId = require('uuid').v4();
        await db.query(
          'INSERT INTO device_clients (id, user_id, label, last_seen_at) VALUES ($1, $2, $3, NOW())',
          [newDeviceId, req.user.id, label || req.headers['user-agent']?.substring(0, 100) || 'Unknown device']
        );
        return res.json({ device_id: newDeviceId, status: 'registered_new', previous_id_reassigned: true });
      }
      // Update last_seen for same user
      await db.query(
        'UPDATE device_clients SET last_seen_at = NOW(), label = COALESCE($1, label) WHERE id = $2',
        [label || null, device_id]
      );
      return res.json({ device_id, status: 'updated' });
    } else {
      // Register new device
      await db.query(
        'INSERT INTO device_clients (id, user_id, label, last_seen_at) VALUES ($1, $2, $3, NOW())',
        [device_id, req.user.id, label || req.headers['user-agent']?.substring(0, 100) || 'Unknown device']
      );
    }

    res.json({ device_id, status: 'registered' });
  } catch (err) {
    console.error('Device registration error:', err);
    res.status(500).json({ error: 'Failed to register device' });
  }
});

// ===== Sync Operations =====

// POST /api/sync/push — push pending operations to server
router.post('/push', async (req, res) => {
  try {
    const { workspace_id, device_id, last_seen_server_cursor, operations } = req.body;

    if (!workspace_id || !device_id || !operations) {
      return res.status(400).json({ error: 'workspace_id, device_id, and operations are required' });
    }

    // Verify device is registered
    const deviceCheck = await db.query(
      'SELECT id FROM device_clients WHERE id = $1 AND user_id = $2',
      [device_id, req.user.id]
    );
    if (deviceCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Device not registered. Call POST /api/sync/devices first.' });
    }

    // Update device last_seen
    await db.query(
      'UPDATE device_clients SET last_seen_at = NOW() WHERE id = $1',
      [device_id]
    );

    const applied = [];
    const conflicts = [];

    for (const op of operations) {
      const {
        id, sequence_number, target_table, target_id,
        operation_type, patch_json, base_version,
      } = op;

      if (!id || !sequence_number || !target_table || !target_id || !operation_type) {
        continue; // skip invalid operations
      }

      // Check for conflict: if base_version is set, verify it matches current version
      if (base_version !== undefined && base_version !== null) {
        const current = await db.query(
          `SELECT version FROM ${target_table} WHERE id = $1`,
          [target_id]
        );
        if (current.rows.length > 0 && current.rows[0].version > base_version) {
          // Conflict detected — record it, don't apply
          conflicts.push({
            operation_id: id,
            target_id,
            target_table,
            server_version: current.rows[0].version,
            client_version: base_version,
          });
          continue;
        }
      }

      // Apply the operation
      try {
        await db.query(
          `INSERT INTO sync_operations (id, workspace_id, device_id, sequence_number, target_table, target_id, operation_type, patch_json, base_version, applied_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
           ON CONFLICT (id) DO NOTHING`,
          [
            id, workspace_id, device_id, sequence_number, target_table, target_id,
            operation_type, JSON.stringify(patch_json || {}), base_version || null,
          ]
        );
        applied.push({ operation_id: id, status: 'applied' });
      } catch (e) {
        console.error('Failed to apply sync operation:', e.message);
        conflicts.push({ operation_id: id, target_id, error: e.message });
      }
    }

    // Get current server cursor (max sequence_number across all devices for this workspace)
    const cursorResult = await db.query(
      'SELECT MAX(sequence_number) as cursor FROM sync_operations WHERE workspace_id = $1',
      [workspace_id]
    );
    const server_cursor = cursorResult.rows[0]?.cursor || 0;

    res.json({
      applied: applied.length,
      conflicts,
      server_cursor: String(server_cursor),
    });
  } catch (err) {
    console.error('Sync push error:', err);
    res.status(500).json({ error: 'Failed to push operations' });
  }
});

// GET /api/sync/pull?workspaceId=xxx&since=cursor — pull operations since cursor
router.get('/pull', async (req, res) => {
  try {
    const { workspaceId, since } = req.query;

    if (!workspaceId) {
      return res.status(400).json({ error: 'workspaceId query parameter is required' });
    }

    // Get operations after the given cursor (exclusive)
    const cursor = parseInt(since || '0', 10);

    const result = await db.query(
      `SELECT id, workspace_id, device_id, sequence_number, target_table, target_id,
              operation_type, patch_json, base_version, created_at, applied_at
       FROM sync_operations
       WHERE workspace_id = $1 AND sequence_number > $2
       ORDER BY sequence_number ASC
       LIMIT 500`,
      [workspaceId, cursor]
    );

    // Get current server cursor
    const cursorResult = await db.query(
      'SELECT MAX(sequence_number) as cursor FROM sync_operations WHERE workspace_id = $1',
      [workspaceId]
    );
    const server_cursor = cursorResult.rows[0]?.cursor || 0;

    // Fetch conflicts for this workspace
    const conflictOps = await db.query(
      `SELECT id, target_id, target_table, patch_json
       FROM sync_operations
       WHERE workspace_id = $1 AND sequence_number > $2
       AND operation_type = 'conflict'
       ORDER BY sequence_number ASC`,
      [workspaceId, cursor]
    );

    res.json({
      workspace_id: workspaceId,
      server_cursor: String(server_cursor),
      operations: result.rows,
      conflicts: conflictOps.rows,
    });
  } catch (err) {
    console.error('Sync pull error:', err);
    res.status(500).json({ error: 'Failed to pull operations' });
  }
});

// ===== Annotations sync =====

// POST /api/sync/annotations — batch save/update annotations (for sync)
router.post('/annotations', async (req, res) => {
  try {
    const annotations = Array.isArray(req.body) ? req.body : [req.body];
    const results = [];

    for (const a of annotations) {
      const {
        id, lecture_id, source_page_id, annotation_type,
        geometry_json, style_json, text_content, layer,
        created_by_device_id, version,
      } = a;

      if (!id || !lecture_id || !source_page_id || !annotation_type) {
        return res.status(400).json({ error: 'id, lecture_id, source_page_id, and annotation_type are required' });
      }

      await db.query(
        `INSERT INTO annotations (id, lecture_id, source_page_id, annotation_type, geometry_json, style_json, text_content, layer, created_by_device_id, version)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
         ON CONFLICT (id) DO UPDATE SET
           geometry_json = EXCLUDED.geometry_json,
           style_json = EXCLUDED.style_json,
           text_content = EXCLUDED.text_content,
           version = EXCLUDED.version,
           updated_at = NOW()
         WHERE annotations.version <= EXCLUDED.version`,
        [
          id, lecture_id, source_page_id, annotation_type,
          JSON.stringify(geometry_json || {}), JSON.stringify(style_json || {}),
          text_content || null, layer || 'student',
          created_by_device_id || '00000000-0000-0000-0000-000000000000',
          version ?? 1,
        ]
      );

      results.push({ id, status: 'saved' });
    }

    res.status(201).json(results);
  } catch (err) {
    console.error('Sync annotations error:', err);
    res.status(500).json({ error: 'Failed to sync annotations' });
  }
});

// GET /api/sync/annotations?lecture_id=xxx — get all annotations for a lecture
router.get('/annotations', async (req, res) => {
  try {
    const { lecture_id } = req.query;
    if (!lecture_id) {
      return res.status(400).json({ error: 'lecture_id query parameter is required' });
    }

    const result = await db.query(
      'SELECT * FROM annotations WHERE lecture_id = $1 AND deleted_at IS NULL ORDER BY created_at',
      [lecture_id]
    );
    res.json(result.rows);
  } catch (err) {
    console.error('Get annotations error:', err);
    res.status(500).json({ error: 'Failed to get annotations' });
  }
});

module.exports = router;
