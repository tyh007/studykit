const express = require('express');
const router = express.Router();
const db = require('../db');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

// Zotero API base URL
const ZOTERO_API = 'https://api.zotero.org';

/**
 * Helper: fetch from Zotero API with auth
 */

// Get workspace ID for the current user
async function getWorkspaceId(userId) {
  const ws = await db.query(
    'SELECT id FROM workspaces WHERE owner_user_id = $1 AND deleted_at IS NULL LIMIT 1',
    [userId]
  );
  return ws.rows[0]?.id;
}
async function zoteroFetch(path, apiKey, options = {}) {
  const url = `${ZOTERO_API}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      'Zotero-API-Key': apiKey,
      'Zotero-API-Version': '3',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Zotero API error ${response.status}: ${text}`);
  }

  const data = await response.json();
  return { data, headers: response.headers };
}

/**
 * POST /api/zotero/connect
 * Validate Zotero API key, fetch user identity, store external_account
 */
router.post('/connect', async (req, res) => {
  try {
    const { apiKey, userId } = req.body;
    if (!apiKey) {
      return res.status(400).json({ error: 'API key is required' });
    }

    // Validate key against Zotero API
    const { data: keyData } = await zoteroFetch('/keys/current', apiKey);

    const providerUserId = userId || keyData.userID || '';
    const providerDisplayName = keyData.username || keyData.displayName || 'Zotero User';

    // Check if already connected for this workspace
    const existing = await db.query(
      `SELECT id FROM external_accounts
       WHERE workspace_id = $1 AND provider = 'zotero' AND disconnected_at IS NULL`,
      [await getWorkspaceId(req.user.id)]
    );

    let account;
    if (existing.rows.length > 0) {
      // Update existing connection
      const result = await db.query(
        `UPDATE external_accounts
         SET auth_status = 'connected',
             credentials_json = $1,
             provider_user_id = $2,
             provider_display_name = $3,
             updated_at = NOW()
         WHERE id = $4
         RETURNING *`,
        [JSON.stringify({ apiKey }), providerUserId, providerDisplayName, existing.rows[0].id]
      );
      account = result.rows[0];
    } else {
      // Create new external account
      const id = uuidv4();
      const result = await db.query(
        `INSERT INTO external_accounts (id, workspace_id, provider, auth_method, auth_status,
          granted_scopes_json, provider_user_id, provider_display_name, credentials_json)
         VALUES ($1, $2, 'zotero', 'api_key', 'connected', $3, $4, $5, $6)
         RETURNING *`,
        [
          id,
          await getWorkspaceId(req.user.id),
          JSON.stringify({ collections: true, library: true }),
          providerUserId,
          providerDisplayName,
          JSON.stringify({ apiKey }),
        ]
      );
      account = result.rows[0];
    }

    // Log connection event
    await db.query(
      `INSERT INTO connector_sync_events
       (id, external_account_id, provider, operation_type, status, message)
       VALUES ($1, $2, 'zotero', 'import', 'succeeded', 'Connected to Zotero')`,
      [uuidv4(), account.id]
    );

    // Strip credentials from response
    const { credentials_json, ...safeAccount } = account;
    res.json({ account: safeAccount });
  } catch (err) {
    console.error('Zotero connect error:', err.message);

    // Log failure event if we have workspace context
    if (req.user?.id) {
      try {
        const wsId = await getWorkspaceId(req.user.id);
        if (wsId) {
          const failedId = uuidv4();
          await db.query(
            `INSERT INTO connector_sync_events
             (id, external_account_id, provider, operation_type, status, message)
             VALUES ($1, $2, 'zotero', 'error', 'failed', $3)`,
            [failedId, failedId, err.message]
          );
        }
      } catch (_) { /* ignore logging errors */ }
    }

    res.status(502).json({ error: `Failed to connect to Zotero: ${err.message}` });
  }
});

/**
 * POST /api/zotero/disconnect
 * Disconnect Zotero account
 */
router.post('/disconnect', async (req, res) => {
  try {
    const account = await db.query(
      `SELECT id FROM external_accounts
       WHERE workspace_id = $1 AND provider = 'zotero' AND disconnected_at IS NULL`,
      [await getWorkspaceId(req.user.id)]
    );

    if (account.rows.length === 0) {
      return res.status(404).json({ error: 'No active Zotero connection' });
    }

    const accountId = account.rows[0].id;

    await db.query(
      `UPDATE external_accounts
       SET auth_status = 'revoked', disconnected_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [accountId]
    );

    // Log disconnect
    await db.query(
      `INSERT INTO connector_sync_events
       (id, external_account_id, provider, operation_type, status, message)
       VALUES ($1, $2, 'zotero', 'disconnect', 'succeeded', 'Disconnected from Zotero')`,
      [uuidv4(), accountId]
    );

    res.json({ success: true });
  } catch (err) {
    console.error('Zotero disconnect error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/zotero/status
 * Check current Zotero connection status
 */
router.get('/status', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT id, auth_status, provider_user_id, provider_display_name, created_at, disconnected_at
       FROM external_accounts
       WHERE workspace_id = $1 AND provider = 'zotero' AND disconnected_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [await getWorkspaceId(req.user.id)]
    );

    if (result.rows.length === 0) {
      return res.json({ status: 'disconnected' });
    }

    const account = result.rows[0];
    res.json({
      status: account.auth_status,
      account: {
        id: account.id,
        provider_user_id: account.provider_user_id,
        provider_display_name: account.provider_display_name,
        created_at: account.created_at,
      },
    });
  } catch (err) {
    console.error('Zotero status error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/zotero/collections
 * Fetch collections from Zotero API via the connected account
 */
router.get('/collections', async (req, res) => {
  try {
    // Get active account
    const accountResult = await db.query(
      `SELECT id, provider_user_id, credentials_json FROM external_accounts
       WHERE workspace_id = $1 AND provider = 'zotero' AND disconnected_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [await getWorkspaceId(req.user.id)]
    );

    if (accountResult.rows.length === 0) {
      return res.status(400).json({ error: 'No active Zotero connection' });
    }

    const account = accountResult.rows[0];
    const credentials = typeof account.credentials_json === 'string'
      ? JSON.parse(account.credentials_json)
      : account.credentials_json;
    const apiKey = credentials.apiKey;
    const zoteroUserId = account.provider_user_id;

    if (!zoteroUserId) {
      return res.status(400).json({ error: 'Zotero user ID not found. Please reconnect.' });
    }

    // Fetch collections from Zotero
    const { data: collections } = await zoteroFetch(`/users/${zoteroUserId}/collections?limit=100`, apiKey);

    res.json({ collections });
  } catch (err) {
    console.error('Zotero collections error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

/**
 * POST /api/zotero/import-collections
 * Import selected Zotero collections as reading lists
 */
router.post('/import-collections', async (req, res) => {
  try {
    const { collectionIds } = req.body;
    if (!collectionIds || !Array.isArray(collectionIds)) {
      return res.status(400).json({ error: 'collectionIds array is required' });
    }

    // Get active account
    const accountResult = await db.query(
      `SELECT id, provider_user_id, credentials_json FROM external_accounts
       WHERE workspace_id = $1 AND provider = 'zotero' AND disconnected_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [await getWorkspaceId(req.user.id)]
    );

    if (accountResult.rows.length === 0) {
      return res.status(400).json({ error: 'No active Zotero connection' });
    }

    const account = accountResult.rows[0];
    const credentials = typeof account.credentials_json === 'string'
      ? JSON.parse(account.credentials_json)
      : account.credentials_json;
    const apiKey = credentials.apiKey;
    const zoteroUserId = account.provider_user_id;

    if (!zoteroUserId) {
      return res.status(400).json({ error: 'Zotero user ID not found. Please reconnect.' });
    }

    // Fetch all collections from Zotero
    const { data: allCollections } = await zoteroFetch(`/users/${zoteroUserId}/collections?limit=100`, apiKey);
    const selected = allCollections.filter(c => collectionIds.includes(c.key));

    const imported = [];

    for (const collection of selected) {
      // Check if already imported
      const existing = await db.query(
        `SELECT rl.id FROM reading_lists rl
         JOIN external_objects eo ON eo.id = rl.external_object_id
         WHERE eo.provider_object_id = $1 AND eo.external_account_id = $2 AND rl.deleted_at IS NULL`,
        [collection.key, account.id]
      );

      if (existing.rows.length > 0) {
        imported.push(existing.rows[0].id);
        continue;
      }

      // Create external object mapping
      const extObjId = uuidv4();
      await db.query(
        `INSERT INTO external_objects (id, external_account_id, provider, provider_object_type,
          provider_object_id, provider_parent_id, sync_direction, metadata_json)
         VALUES ($1, $2, 'zotero', 'collection', $3, $4, 'read_only', $5)`,
        [
          extObjId,
          account.id,
          collection.key,
          collection.parent?.key || null,
          JSON.stringify({ name: collection.data?.name || '' }),
        ]
      );

      // Create reading list
      const listId = uuidv4();
      await db.query(
        `INSERT INTO reading_lists (id, workspace_id, name, description, external_object_id)
         VALUES ($1, $2, $3, $4, $5)`,
        [
          listId,
          await getWorkspaceId(req.user.id),
          collection.data?.name || 'Untitled Collection',
          collection.data?.description || null,
          extObjId,
        ]
      );

      // Log import
      await db.query(
        `INSERT INTO connector_sync_events
         (id, external_account_id, provider, operation_type, local_object_type, local_object_id,
          provider_object_type, provider_object_id, status, message)
         VALUES ($1, $2, 'zotero', 'import', 'reading_list', $3, 'collection', $4, 'succeeded', $5)`,
        [uuidv4(), account.id, listId, collection.key, `Imported "${collection.data?.name}"`]
      );

      imported.push(listId);
    }

    // Fetch created reading lists
    const result = await db.query(
      `SELECT * FROM reading_lists WHERE id = ANY($1) AND deleted_at IS NULL`,
      [imported]
    );

    res.json({ readingLists: result.rows });
  } catch (err) {
    console.error('Zotero import collections error:', err.message);

    // Log failure
    try {
      const accountResult = await db.query(
        `SELECT id FROM external_accounts
         WHERE workspace_id = $1 AND provider = 'zotero' AND disconnected_at IS NULL LIMIT 1`,
        [await getWorkspaceId(req.user.id)]
      );
      if (accountResult.rows.length > 0) {
        await db.query(
          `INSERT INTO connector_sync_events
           (id, external_account_id, provider, operation_type, status, message)
           VALUES ($1, $2, 'zotero', 'error', 'failed', $3)`,
          [uuidv4(), accountResult.rows[0].id, err.message]
        );
      }
    } catch (_) { /* ignore */ }

    res.status(502).json({ error: err.message });
  }
});

/**
 * POST /api/zotero/import-items
 * Import items from a Zotero collection
 */
router.post('/import-items', async (req, res) => {
  try {
    const { collectionId, readingListId } = req.body;
    let effectiveCollectionId = collectionId;

    // If readingListId provided, look up the Zotero collection key
    if (!effectiveCollectionId && readingListId) {
      const rlResult = await db.query(
        `SELECT eo.provider_object_id as collection_key
         FROM reading_lists rl
         JOIN external_objects eo ON eo.id = rl.external_object_id
         WHERE rl.id = $1 AND rl.deleted_at IS NULL
         LIMIT 1`,
        [readingListId]
      );
      if (rlResult.rows.length > 0) {
        effectiveCollectionId = rlResult.rows[0].collection_key;
      }
    }

    if (!effectiveCollectionId) {
      return res.status(400).json({ error: 'Could not find Zotero collection for this reading list. Make sure the reading list was imported from Zotero.' });
    }

    // Get active account
    const accountResult = await db.query(
      `SELECT id, provider_user_id, credentials_json FROM external_accounts
       WHERE workspace_id = $1 AND provider = 'zotero' AND disconnected_at IS NULL
       ORDER BY created_at DESC LIMIT 1`,
      [await getWorkspaceId(req.user.id)]
    );

    if (accountResult.rows.length === 0) {
      return res.status(400).json({ error: 'No active Zotero connection' });
    }

    const account = accountResult.rows[0];
    const credentials = typeof account.credentials_json === 'string'
      ? JSON.parse(account.credentials_json)
      : account.credentials_json;
    const apiKey = credentials.apiKey;
    const zoteroUserId = account.provider_user_id;

    if (!zoteroUserId) {
      return res.status(400).json({ error: 'Zotero user ID not found. Please reconnect.' });
    }

    // Find reading list linked to this collection
    const readingListResult = await db.query(
      `SELECT rl.id FROM reading_lists rl
       JOIN external_objects eo ON eo.id = rl.external_object_id
       WHERE eo.provider_object_id = $1 AND rl.deleted_at IS NULL
       LIMIT 1`,
      [effectiveCollectionId]
    );

    const resolvedReadingListId = readingListResult.rows[0]?.id;

    // Fetch reading list name for project naming
    const effectiveReadingListId = readingListId || resolvedReadingListId;
    let readingListName = null;
    if (effectiveReadingListId) {
      const rlNameResult = await db.query(
        'SELECT name FROM reading_lists WHERE id = $1 AND deleted_at IS NULL',
        [effectiveReadingListId]
      );
      readingListName = rlNameResult.rows[0]?.name || null;
    }

    // Determine target project for papers
    const wsId = await getWorkspaceId(req.user.id);
    let projectId = req.body.projectId || null;
    if (!projectId && readingListName) {
      projectId = await getOrCreateZoteroProject(wsId, readingListName);
    }

    // Fetch items from Zotero (top-level items in the collection)
    const { data: items } = await zoteroFetch(
      `/users/${zoteroUserId}/collections/${effectiveCollectionId}/items/top?limit=100`,
      apiKey
    );

    const imported = [];

    for (const item of items) {
      const itemKey = item.key;
      const itemData = item.data || {};

      // Skip non-citable items (notes, attachments)
      if (itemData.itemType === 'note' || itemData.itemType === 'attachment') continue;

      // Check if already imported
      const existing = await db.query(
        `SELECT ci.id FROM citation_items ci
         JOIN external_objects eo ON eo.id = ci.external_object_id
         WHERE eo.provider_object_id = $1 AND ci.deleted_at IS NULL
         LIMIT 1`,
        [itemKey]
      );

      if (existing.rows.length > 0) {
        if (effectiveReadingListId) {
          await addToReadingListIfMissing(effectiveReadingListId, existing.rows[0].id);
        }
        imported.push(existing.rows[0].id);
        continue;
      }

      // Build creators array
      const creators = (itemData.creators || []).map(c => ({
        firstName: c.firstName || null,
        lastName: c.lastName || null,
        name: c.name || null,
        creatorType: c.creatorType || 'author',
      }));

      // Extract year
      let issuedYear = null;
      if (itemData.date) {
        const yearMatch = String(itemData.date).match(/(\d{4})/);
        if (yearMatch) issuedYear = parseInt(yearMatch[1]);
      }

      // Build CSL JSON
      const cslJson = buildCSLJSON(itemData);

      // Create external object mapping
      const extObjId = uuidv4();
      await db.query(
        `INSERT INTO external_objects (id, external_account_id, provider, provider_object_type,
          provider_object_id, sync_direction, metadata_json)
         VALUES ($1, $2, 'zotero', 'item', $3, 'read_only', $4)`,
        [
          extObjId,
          account.id,
          itemKey,
          JSON.stringify({ itemType: itemData.itemType }),
        ]
      );

      // Create citation item
      const citationId = uuidv4();
      await db.query(
        `INSERT INTO citation_items
         (id, workspace_id, provider, external_object_id, citekey, title,
          creators_json, issued_year, item_type, publisher, doi, url, abstract,
          tags_json, csl_json)
         VALUES ($1, $2, 'zotero', $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          citationId,
          await getWorkspaceId(req.user.id),
          extObjId,
          itemKey,
          itemData.title || 'Untitled',
          JSON.stringify(creators),
          issuedYear,
          itemData.itemType || 'document',
          itemData.publisher || null,
          itemData.DOI || null,
          itemData.url || null,
          itemData.abstractNote || null,
          JSON.stringify(itemData.tags?.map(t => t.tag) || []),
          JSON.stringify(cslJson),
        ]
      );

      // Add to reading list
      if (effectiveReadingListId) {
        await addToReadingListIfMissing(effectiveReadingListId, citationId);
      }

      imported.push(citationId);

      // ===== PDF download and paper creation =====
      let paperId = null;
      try {
        // Check if paper already exists for this citation
        const existingPaper = await db.query(
          'SELECT id FROM literature_papers WHERE citation_item_id = $1 AND deleted_at IS NULL LIMIT 1',
          [citationId]
        );

        if (existingPaper.rows.length === 0) {
          // Fetch child items to find PDF attachments
          const childrenResult = await zoteroFetch(
            `/users/${zoteroUserId}/items/${itemKey}/children`,
            apiKey
          );
          const children = childrenResult.data || [];

          // Find PDF attachment
          const pdfAttachment = children.find(c =>
            c.data?.contentType === 'application/pdf'
            || (c.data?.itemType === 'attachment' && c.data?.contentType === 'application/pdf')
            || (c.data?.filename || '').toLowerCase().endsWith('.pdf')
          );

          if (pdfAttachment?.links?.enclosure?.href) {
            // Download PDF from Zotero
            const pdfResponse = await fetch(pdfAttachment.links.enclosure.href, {
              headers: {
                'Zotero-API-Key': apiKey,
                'Zotero-API-Version': '3',
              },
            });

            if (pdfResponse.ok) {
              const pdfBuffer = Buffer.from(await pdfResponse.arrayBuffer());
              const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads');
              const storageKey = `lit-${uuidv4()}.pdf`;
              const pdfPath = path.join(uploadDir, storageKey);

              // Ensure directory exists
              fs.mkdirSync(path.dirname(pdfPath), { recursive: true });
              fs.writeFileSync(pdfPath, pdfBuffer);

              // Extract text using pdf-parse
              let fullText = null;
              try {
                const pdfParse = require('pdf-parse');
                const pdfData = await pdfParse(pdfBuffer);
                fullText = pdfData.text;
              } catch (parseErr) {
                console.warn(`Failed to extract text from PDF for item ${itemKey}:`, parseErr.message);
              }

              // Create literature_paper record
              const newPaperId = uuidv4();
              const fileName = pdfAttachment.data?.filename || `${itemData.title || 'untitled'}.pdf`;
              const authorsStr = creators.map(c => `${c.lastName || ''}, ${c.firstName || ''}`).filter(Boolean).join('; ');

              if (projectId) {
                await db.query(
                  `INSERT INTO literature_papers
                   (id, project_id, workspace_id, file_name, file_size, file_type,
                    storage_key, citation_item_id, title, authors, year, journal,
                    doi, abstract, full_text, processing_status)
                   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
                  [
                    newPaperId, projectId, wsId, fileName, pdfBuffer.length, 'application/pdf',
                    storageKey, citationId, itemData.title || null, authorsStr || null, issuedYear,
                    itemData.publicationTitle || null, itemData.DOI || null,
                    itemData.abstractNote || null, fullText,
                    fullText ? 'pending' : 'pending',
                  ]
                );

                // Link paper to reading list and citation
                if (effectiveReadingListId) {
                  await db.query(
                    `INSERT INTO literature_pdf_references (id, paper_id, reading_list_id, citation_item_id)
                     VALUES ($1, $2, $3, $4)`,
                    [uuidv4(), newPaperId, effectiveReadingListId, citationId]
                  );
                }
              }

              paperId = newPaperId;
            } else {
              console.warn(`Zotero PDF download failed for ${itemKey}: HTTP ${pdfResponse.status}`);
            }
          } else {
            console.log(`No PDF attachment found for item ${itemKey}`);
          }
        } else {
          paperId = existingPaper.rows[0].id;
        }
      } catch (pdfErr) {
        console.error(`PDF download/creation error for ${itemKey}:`, pdfErr.message);
        // Don't fail the entire import — citation was still created
      }

      // Log import
      await db.query(
        `INSERT INTO connector_sync_events
         (id, external_account_id, provider, operation_type, local_object_type, local_object_id,
          provider_object_type, provider_object_id, status, message)
         VALUES ($1, $2, 'zotero', 'import', 'citation_item', $3, 'item', $4, 'succeeded', $5)`,
        [uuidv4(), account.id, citationId, itemKey, `Imported "${itemData.title}"${paperId ? ' + PDF' : ''}`]
      );

      // Rate limiting: small delay between Zotero API calls
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Fetch created citation items
    let citations = [];
    if (imported.length > 0) {
      const result = await db.query(
        `SELECT * FROM citation_items WHERE id = ANY($1) AND deleted_at IS NULL`,
        [imported]
      );
      citations = result.rows;
    }

    res.json({ citationItems: citations, importedCount: imported.length, projectId });
  } catch (err) {
    console.error('Zotero import items error:', err.message);

    try {
      const accountResult = await db.query(
        `SELECT id FROM external_accounts
         WHERE workspace_id = $1 AND provider = 'zotero' AND disconnected_at IS NULL LIMIT 1`,
        [await getWorkspaceId(req.user.id)]
      );
      if (accountResult.rows.length > 0) {
        await db.query(
          `INSERT INTO connector_sync_events
           (id, external_account_id, provider, operation_type, status, message)
           VALUES ($1, $2, 'zotero', 'error', 'failed', $3)`,
          [uuidv4(), accountResult.rows[0].id, err.message]
        );
      }
    } catch (_) { /* ignore */ }

    res.status(502).json({ error: err.message });
  }
});

/**
 * GET /api/zotero/sync-events
 * Get sync event history for Zotero
 */
router.get('/sync-events', async (req, res) => {
  try {
    const accountResult = await db.query(
      `SELECT id FROM external_accounts
       WHERE workspace_id = $1 AND provider = 'zotero' ORDER BY created_at DESC LIMIT 1`,
      [await getWorkspaceId(req.user.id)]
    );

    if (accountResult.rows.length === 0) {
      return res.json({ events: [] });
    }

    const result = await db.query(
      `SELECT * FROM connector_sync_events
       WHERE external_account_id = $1
       ORDER BY created_at DESC LIMIT 50`,
      [accountResult.rows[0].id]
    );

    res.json({ events: result.rows });
  } catch (err) {
    console.error('Zotero sync events error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

/**
 * Helper: add citation to reading list if not already present
 */
async function addToReadingListIfMissing(readingListId, citationItemId) {
  const existing = await db.query(
    `SELECT id FROM reading_list_items
     WHERE reading_list_id = $1 AND citation_item_id = $2`,
    [readingListId, citationItemId]
  );
  if (existing.rows.length === 0) {
    await db.query(
      `INSERT INTO reading_list_items (id, reading_list_id, citation_item_id)
       VALUES ($1, $2, $3)`,
      [uuidv4(), readingListId, citationItemId]
    );
  }
}

/**
 * Helper: get or create a literature project for Zotero imports
 */
async function getOrCreateZoteroProject(workspaceId, name) {
  const existing = await db.query(
    `SELECT id FROM literature_projects WHERE workspace_id = $1 AND name = $2 AND deleted_at IS NULL LIMIT 1`,
    [workspaceId, name]
  );
  if (existing.rows.length > 0) return existing.rows[0].id;

  const id = uuidv4();
  await db.query(
    `INSERT INTO literature_projects (id, workspace_id, name) VALUES ($1, $2, $3)`,
    [id, workspaceId, name]
  );
  return id;
}

/**
 * Helper: build CSL-JSON from Zotero item data
 */
function buildCSLJSON(itemData) {
  const creators = (itemData.creators || []).map(c => {
    const entry = { family: c.lastName || '', given: c.firstName || '' };
    if (c.name && !c.lastName) entry.literal = c.name;
    return entry;
  });

  return {
    id: itemData.key || '',
    type: (itemData.itemType || 'document').toLowerCase(),
    title: itemData.title || '',
    author: creators,
    issued: itemData.date ? { 'date-parts': [[parseInt(String(itemData.date).match(/(\d{4})/)?.[1] || '')]] } : undefined,
    publisher: itemData.publisher || undefined,
    DOI: itemData.DOI || undefined,
    URL: itemData.url || undefined,
    abstract: itemData.abstractNote || undefined,
    container: itemData.publicationTitle || undefined,
    volume: itemData.volume || undefined,
    issue: itemData.issue || undefined,
    page: itemData.pages || undefined,
  };
}

module.exports = router;
