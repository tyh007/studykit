const express = require('express');
const { v4: uuidv4 } = require('uuid');
const db = require('../db');
const { encryptCredential, decryptCredential, maskCredential } = require('../lib/ai-credentials');
const {
  PROVIDERS,
  serializeProviderCatalog,
  inferCapabilities,
  assertSafeCustomUrl,
  listModels,
  generate,
  generateStructured,
} = require('../lib/ai-providers');

const router = express.Router();
const DEFAULT_SUMMARY_OPTIONS = {
  temperature: 0.3,
  maxTokens: 4096,
  enabledFields: ['background', 'theory', 'methodology', 'measures', 'results', 'implications', 'limitations'],
  customInstructions: '',
  useVision: true,
};

async function getWorkspaceId(userId) {
  const result = await db.query(
    'SELECT id FROM workspaces WHERE owner_user_id = $1 AND deleted_at IS NULL LIMIT 1',
    [userId]
  );
  return result.rows[0]?.id;
}

function jsonValue(value, fallback = {}) {
  if (!value) return fallback;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function serializeProfile(row) {
  const options = jsonValue(row.options_json);
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    baseUrl: row.base_url || PROVIDERS[row.provider]?.baseUrl || '',
    model: row.model || '',
    options,
    capabilities: jsonValue(row.capabilities_json, inferCapabilities(row.provider, row.model)),
    hasCredential: !!row.credential_encrypted,
    credentialMask: row.credential_mask || null,
    local: !!PROVIDERS[row.provider]?.local || options.browserLocal === true,
    lastTestStatus: row.last_test_status,
    lastTestError: row.last_test_error,
    lastTestedAt: row.last_tested_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function getProfile(workspaceId, profileId) {
  const result = await db.query(
    `SELECT * FROM ai_provider_profiles
     WHERE id = $1 AND workspace_id = $2 AND deleted_at IS NULL`,
    [profileId, workspaceId]
  );
  return result.rows[0] || null;
}

async function getDefaults(workspaceId) {
  const result = await db.query(
    `SELECT * FROM ai_task_defaults WHERE workspace_id = $1`,
    [workspaceId]
  );
  const row = result.rows[0];
  return {
    summaryProfileId: row?.summary_profile_id || null,
    visionProfileId: row?.vision_profile_id || null,
    chatProfileId: row?.chat_profile_id || null,
    summaryOptions: { ...DEFAULT_SUMMARY_OPTIONS, ...jsonValue(row?.summary_options_json) },
  };
}

async function resolveTaskProfile(workspaceId, task, explicitProfileId) {
  const defaults = await getDefaults(workspaceId);
  const profileId = explicitProfileId || defaults[`${task}ProfileId`];
  if (!profileId) throw new Error(`尚未设置${task === 'summary' ? '文献总结' : task === 'vision' ? '视觉提取' : '论文问答'}的默认 AI 配置`);
  const profile = await getProfile(workspaceId, profileId);
  if (!profile) throw new Error('AI 配置不存在或已被删除');
  return { profile, defaults };
}

function getCredential(profile) {
  return profile.credential_encrypted ? decryptCredential(profile.credential_encrypted) : '';
}

function profileInput(body) {
  const provider = String(body.provider || '');
  if (!PROVIDERS[provider]) throw new Error('不支持的 AI 供应商');
  const preset = PROVIDERS[provider];
  const requestedBaseUrl = String(body.baseUrl || preset.baseUrl || '').trim().replace(/\/+$/, '');
  const baseUrl = preset.custom || preset.local ? requestedBaseUrl : preset.baseUrl;
  if (!baseUrl && provider !== 'ollama') throw new Error('Base URL 不能为空');
  return {
    name: String(body.name || preset.label).trim().slice(0, 80),
    provider,
    baseUrl,
    model: String(body.model || '').trim().slice(0, 200),
    options: body.options && typeof body.options === 'object' ? body.options : {},
  };
}

async function validateProfileUrl(input) {
  if (input.provider === 'custom' && input.options.browserLocal !== true) await assertSafeCustomUrl(input.baseUrl);
}

router.get('/providers', (req, res) => {
  res.json({ providers: serializeProviderCatalog() });
});

router.get('/profiles', async (req, res) => {
  try {
    const workspaceId = await getWorkspaceId(req.user.id);
    const result = await db.query(
      `SELECT * FROM ai_provider_profiles
       WHERE workspace_id = $1 AND deleted_at IS NULL
       ORDER BY created_at ASC`,
      [workspaceId]
    );
    res.json({ profiles: result.rows.map(serializeProfile), defaults: await getDefaults(workspaceId) });
  } catch (error) {
    res.status(500).json({ error: '无法读取 AI 配置' });
  }
});

router.post('/profiles', async (req, res) => {
  try {
    const workspaceId = await getWorkspaceId(req.user.id);
    const input = profileInput(req.body);
    await validateProfileUrl(input);
    const credential = String(req.body.apiKey || '').trim();
    const id = uuidv4();
    const capabilities = inferCapabilities(input.provider, input.model);
    const result = await db.query(
      `INSERT INTO ai_provider_profiles
       (id, workspace_id, name, provider, base_url, model, credential_encrypted,
        credential_mask, options_json, capabilities_json)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING *`,
      [
        id, workspaceId, input.name, input.provider, input.baseUrl, input.model,
        credential ? encryptCredential(credential) : null,
        credential ? maskCredential(credential) : null,
        JSON.stringify(input.options), JSON.stringify(capabilities),
      ]
    );
    res.status(201).json({ profile: serializeProfile(result.rows[0]) });
  } catch (error) {
    res.status(400).json({ error: error.message || '无法创建 AI 配置' });
  }
});

router.patch('/profiles/:id', async (req, res) => {
  try {
    const workspaceId = await getWorkspaceId(req.user.id);
    const current = await getProfile(workspaceId, req.params.id);
    if (!current) return res.status(404).json({ error: 'AI 配置不存在' });
    const input = profileInput({
      name: req.body.name ?? current.name,
      provider: req.body.provider ?? current.provider,
      baseUrl: req.body.baseUrl ?? current.base_url,
      model: req.body.model ?? current.model,
      options: req.body.options ?? jsonValue(current.options_json),
    });
    await validateProfileUrl(input);
    const suppliedCredential = req.body.apiKey;
    const clearCredential = req.body.clearCredential === true;
    let encrypted = current.credential_encrypted;
    let mask = current.credential_mask;
    if (clearCredential || (input.provider !== current.provider && !(typeof suppliedCredential === 'string' && suppliedCredential.trim()))) {
      encrypted = null;
      mask = null;
    } else if (typeof suppliedCredential === 'string' && suppliedCredential.trim()) {
      encrypted = encryptCredential(suppliedCredential.trim());
      mask = maskCredential(suppliedCredential.trim());
    }
    const capabilities = inferCapabilities(input.provider, input.model);
    const result = await db.query(
      `UPDATE ai_provider_profiles SET
       name=$1, provider=$2, base_url=$3, model=$4, credential_encrypted=$5,
       credential_mask=$6, options_json=$7, capabilities_json=$8,
       last_test_status='untested', last_test_error=NULL, updated_at=NOW()
       WHERE id=$9 AND workspace_id=$10 RETURNING *`,
      [
        input.name, input.provider, input.baseUrl, input.model, encrypted, mask,
        JSON.stringify(input.options), JSON.stringify(capabilities), current.id, workspaceId,
      ]
    );
    res.json({ profile: serializeProfile(result.rows[0]) });
  } catch (error) {
    res.status(400).json({ error: error.message || '无法更新 AI 配置' });
  }
});

router.delete('/profiles/:id', async (req, res) => {
  const workspaceId = await getWorkspaceId(req.user.id);
  const result = await db.query(
    `UPDATE ai_provider_profiles SET deleted_at=NOW(), updated_at=NOW()
     WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL RETURNING id`,
    [req.params.id, workspaceId]
  );
  if (!result.rows.length) return res.status(404).json({ error: 'AI 配置不存在' });
  await db.query(
    `UPDATE ai_task_defaults SET
     summary_profile_id = CASE WHEN summary_profile_id=$1 THEN NULL ELSE summary_profile_id END,
     vision_profile_id = CASE WHEN vision_profile_id=$1 THEN NULL ELSE vision_profile_id END,
     chat_profile_id = CASE WHEN chat_profile_id=$1 THEN NULL ELSE chat_profile_id END,
     updated_at=NOW()
     WHERE workspace_id=$2`,
    [req.params.id, workspaceId]
  );
  res.json({ success: true });
});

router.get('/profiles/:id/models', async (req, res) => {
  try {
    const workspaceId = await getWorkspaceId(req.user.id);
    const profile = await getProfile(workspaceId, req.params.id);
    if (!profile) return res.status(404).json({ error: 'AI 配置不存在' });
    if (serializeProfile(profile).local) {
      return res.json({ models: [], local: true, baseUrl: profile.base_url || PROVIDERS.ollama.baseUrl });
    }
    const models = await listModels(profile, getCredential(profile));
    res.json({ models });
  } catch (error) {
    res.status(502).json({ error: error.message || '无法获取模型列表' });
  }
});

router.post('/profiles/:id/test', async (req, res) => {
  const workspaceId = await getWorkspaceId(req.user.id);
  const profile = await getProfile(workspaceId, req.params.id);
  if (!profile) return res.status(404).json({ error: 'AI 配置不存在' });
  if (serializeProfile(profile).local) {
    return res.json({
      success: true,
      local: true,
      message: '请由当前浏览器连接本机 Ollama',
      baseUrl: profile.base_url || PROVIDERS.ollama.baseUrl,
    });
  }
  try {
    let models = [];
    try {
      models = await listModels(profile, getCredential(profile));
    } catch (modelError) {
      if (!profile.model) throw modelError;
      await generate(profile, getCredential(profile), {
        messages: [{ role: 'user', content: 'Reply with OK.' }],
        maxTokens: 8,
        temperature: 0,
      });
    }
    await db.query(
      `UPDATE ai_provider_profiles SET last_test_status='success', last_test_error=NULL,
       last_tested_at=NOW(), updated_at=NOW() WHERE id=$1 AND workspace_id=$2`,
      [profile.id, workspaceId]
    );
    res.json({ success: true, models });
  } catch (error) {
    const safeError = String(error.message || '连接失败').slice(0, 500);
    await db.query(
      `UPDATE ai_provider_profiles SET last_test_status='error', last_test_error=$1,
       last_tested_at=NOW(), updated_at=NOW() WHERE id=$2 AND workspace_id=$3`,
      [safeError, profile.id, workspaceId]
    );
    res.status(502).json({ error: safeError });
  }
});

router.get('/task-defaults', async (req, res) => {
  const workspaceId = await getWorkspaceId(req.user.id);
  res.json(await getDefaults(workspaceId));
});

router.patch('/task-defaults', async (req, res) => {
  try {
    const workspaceId = await getWorkspaceId(req.user.id);
    const current = await getDefaults(workspaceId);
    const next = {
      summaryProfileId: req.body.summaryProfileId !== undefined ? req.body.summaryProfileId : current.summaryProfileId,
      visionProfileId: req.body.visionProfileId !== undefined ? req.body.visionProfileId : current.visionProfileId,
      chatProfileId: req.body.chatProfileId !== undefined ? req.body.chatProfileId : current.chatProfileId,
      summaryOptions: { ...current.summaryOptions, ...(req.body.summaryOptions || {}) },
    };
    for (const [task, profileId] of [['summary', next.summaryProfileId], ['vision', next.visionProfileId], ['chat', next.chatProfileId]]) {
      if (!profileId) continue;
      const profile = await getProfile(workspaceId, profileId);
      if (!profile) throw new Error(`${task} 的 AI 配置不存在`);
      if (task === 'vision' && !serializeProfile(profile).capabilities.vision) {
        throw new Error('所选模型尚未识别为支持视觉输入；请先选择视觉模型并测试连接');
      }
    }
    await db.query(
      `INSERT INTO ai_task_defaults
       (workspace_id, summary_profile_id, vision_profile_id, chat_profile_id, summary_options_json, updated_at)
       VALUES ($1,$2,$3,$4,$5,NOW())
       ON CONFLICT (workspace_id) DO UPDATE SET
       summary_profile_id=EXCLUDED.summary_profile_id,
       vision_profile_id=EXCLUDED.vision_profile_id,
       chat_profile_id=EXCLUDED.chat_profile_id,
       summary_options_json=EXCLUDED.summary_options_json,
       updated_at=NOW()`,
      [
        workspaceId, next.summaryProfileId, next.visionProfileId, next.chatProfileId,
        JSON.stringify(next.summaryOptions),
      ]
    );
    res.json(next);
  } catch (error) {
    res.status(400).json({ error: error.message || '无法保存任务默认设置' });
  }
});

router.post('/check', async (req, res) => {
  const workspaceId = await getWorkspaceId(req.user.id);
  const defaults = await getDefaults(workspaceId);
  res.json({ available: !!defaults.summaryProfileId, defaults });
});

router.post('/extract', async (req, res) => {
  try {
    if (!req.body.userPrompt) return res.status(400).json({ error: 'userPrompt is required' });
    const workspaceId = await getWorkspaceId(req.user.id);
    const { profile, defaults } = await resolveTaskProfile(workspaceId, 'summary', req.body.profileId);
    if (serializeProfile(profile).local) return res.status(409).json({ error: 'local_provider', profile: serializeProfile(profile) });
    const options = defaults.summaryOptions;
    const extractedData = await generateStructured(profile, getCredential(profile), {
      messages: [
        { role: 'system', content: req.body.systemPrompt || 'You extract structured information from academic papers.' },
        { role: 'user', content: req.body.userPrompt },
      ],
      temperature: req.body.temperature ?? options.temperature,
      maxTokens: req.body.maxTokens || options.maxTokens,
    });
    res.json({ success: true, extractedData, profile: serializeProfile(profile) });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message || 'AI extraction failed' });
  }
});

router.post('/vision-extract', async (req, res) => {
  try {
    if (!Array.isArray(req.body.pages) || !req.body.pages.length) {
      return res.status(400).json({ error: 'pages array is required' });
    }
    const workspaceId = await getWorkspaceId(req.user.id);
    const { profile, defaults } = await resolveTaskProfile(workspaceId, 'vision', req.body.profileId);
    const serialized = serializeProfile(profile);
    if (!serialized.capabilities.vision) return res.status(400).json({ error: '所选配置不支持视觉输入' });
    if (serialized.local) return res.status(409).json({ error: 'local_provider', profile: serialized });
    const extractedData = await generateStructured(profile, getCredential(profile), {
      messages: [{ role: 'user', content: req.body.prompt || 'Extract structured information from these academic PDF pages. Return JSON only.' }],
      images: req.body.pages,
      temperature: req.body.temperature ?? defaults.summaryOptions.temperature,
      maxTokens: req.body.maxTokens || defaults.summaryOptions.maxTokens,
    });
    res.json({ success: true, extractedData, profile: serialized });
  } catch (error) {
    res.status(502).json({ success: false, error: error.message || 'Vision extraction failed' });
  }
});

async function buildPaperContext(workspaceId, paperId, paperIds) {
  const titles = [];
  if (paperId) {
    const result = await db.query(
      `SELECT id,title,authors,year,journal,abstract,full_text,extracted_data
       FROM literature_papers WHERE id=$1 AND workspace_id=$2 AND deleted_at IS NULL`,
      [paperId, workspaceId]
    );
    const paper = result.rows[0];
    if (!paper) return { titles, context: 'No accessible paper was found.' };
    titles.push(paper.title || 'Untitled');
    return {
      titles,
      context: `You are a research assistant analyzing this academic paper.
TITLE: ${paper.title || 'Untitled'}
AUTHORS: ${paper.authors || 'Unknown'}
YEAR: ${paper.year || 'Unknown'}
JOURNAL: ${paper.journal || 'Unknown'}
ABSTRACT: ${paper.abstract || 'Not available'}
AI EXTRACTION:
${JSON.stringify(jsonValue(paper.extracted_data), null, 2)}
FULL TEXT:
${paper.full_text ? paper.full_text.slice(0, 30000) : '(Full text not available)'}
Answer only from the supplied paper. State clearly when the paper does not contain the requested information.`,
    };
  }
  if (Array.isArray(paperIds) && paperIds.length) {
    const result = await db.query(
      `SELECT id,title,authors,year,abstract,extracted_data
       FROM literature_papers WHERE id=ANY($1) AND workspace_id=$2 AND deleted_at IS NULL`,
      [paperIds, workspaceId]
    );
    const content = result.rows.map((paper, index) => {
      titles.push(paper.title || 'Untitled');
      return `--- PAPER ${index + 1}: ${paper.title || 'Untitled'} ---
AUTHORS: ${paper.authors || 'Unknown'} (${paper.year || 'Unknown'})
ABSTRACT: ${paper.abstract || 'Not available'}
EXTRACTION: ${JSON.stringify(jsonValue(paper.extracted_data), null, 2)}`;
    }).join('\n\n');
    return {
      titles,
      context: `You are a research assistant comparing the supplied papers. Use specific evidence and state when information is unavailable.\n\n${content}`,
    };
  }
  return { titles, context: 'You are a research assistant helping analyze academic literature.' };
}

router.post('/chat', async (req, res) => {
  try {
    if (!Array.isArray(req.body.messages)) return res.status(400).json({ error: 'messages array is required' });
    const workspaceId = await getWorkspaceId(req.user.id);
    const { profile } = await resolveTaskProfile(workspaceId, 'chat', req.body.profileId);
    if (serializeProfile(profile).local) return res.status(409).json({ error: 'local_provider', profile: serializeProfile(profile) });
    const paperContext = await buildPaperContext(workspaceId, req.body.paperId, req.body.paperIds);
    const content = await generate(profile, getCredential(profile), {
      messages: [
        { role: 'system', content: paperContext.context },
        ...req.body.messages.filter(message => message.role !== 'system').map(message => ({
          role: message.role === 'assistant' ? 'assistant' : 'user',
          content: String(message.content || ''),
        })),
      ],
      temperature: req.body.temperature ?? 0.3,
      maxTokens: req.body.maxTokens || 4096,
    });
    res.json({
      message: { role: 'assistant', content },
      sources: paperContext.titles,
      profile: serializeProfile(profile),
    });
  } catch (error) {
    res.status(502).json({ error: error.message || 'AI chat failed' });
  }
});

module.exports = router;
