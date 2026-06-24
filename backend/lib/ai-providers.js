const dns = require('dns').promises;
const net = require('net');

const PROVIDERS = {
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', protocol: 'openai' },
  anthropic: { label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', protocol: 'anthropic' },
  gemini: { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', protocol: 'gemini' },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', protocol: 'openai' },
  groq: { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', protocol: 'openai' },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', protocol: 'openai' },
  minimax: { label: 'MiniMax', baseUrl: 'https://api.minimaxi.com/v1', protocol: 'openai' },
  moonshot: { label: 'Kimi / Moonshot', baseUrl: 'https://api.moonshot.cn/v1', protocol: 'openai' },
  zhipu: { label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', protocol: 'openai' },
  dashscope: { label: '阿里云百炼', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', protocol: 'openai' },
  volcengine: { label: '火山方舟 / 豆包', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', protocol: 'openai' },
  baidu: { label: '百度千帆 / 文心', baseUrl: 'https://qianfan.baidubce.com/v2', protocol: 'openai' },
  tencent: { label: '腾讯混元', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', protocol: 'openai' },
  siliconflow: { label: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', protocol: 'openai' },
  ollama: { label: 'Ollama', baseUrl: 'http://localhost:11434', protocol: 'ollama', local: true },
  custom: { label: '自定义 OpenAI-compatible', baseUrl: '', protocol: 'openai', custom: true },
};

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function isPrivateIp(address) {
  if (!net.isIP(address)) return false;
  if (address === '::1' || address.startsWith('fc') || address.startsWith('fd') || address.startsWith('fe80:')) return true;
  if (net.isIP(address) === 4) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  return false;
}

async function assertSafeCustomUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('Base URL 格式无效');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') throw new Error('Base URL 仅支持 HTTP/HTTPS');
  if (parsed.username || parsed.password) throw new Error('Base URL 不允许内嵌账号或密码');
  if (['localhost', 'host.docker.internal'].includes(parsed.hostname) || isPrivateIp(parsed.hostname)) {
    throw new Error('云端自定义 API 不允许访问本机或私有网络；本地模型请使用 Ollama');
  }
  const records = await dns.lookup(parsed.hostname, { all: true });
  if (!records.length || records.some(record => isPrivateIp(record.address))) {
    throw new Error('Base URL 解析到了私有或保留网络地址');
  }
  return normalizeBaseUrl(parsed.toString());
}

function inferCapabilities(provider, model = '') {
  const name = String(model).toLowerCase();
  const visionHints = ['vision', 'vl', 'gpt-4.1', 'gpt-5', 'gemini', 'claude', 'qwen-vl', 'glm-4v', 'glm-4.5v', 'doubao-vision'];
  const knownTextOnly = provider === 'deepseek' || name.includes('reasoner');
  return {
    text: true,
    structured: true,
    vision: !knownTextOnly && visionHints.some(hint => name.includes(hint)),
  };
}

function serializeProviderCatalog() {
  return Object.entries(PROVIDERS).map(([id, value]) => ({
    id,
    label: value.label,
    defaultBaseUrl: value.baseUrl,
    local: !!value.local,
    custom: !!value.custom,
  }));
}

function providerConfig(profile) {
  const preset = PROVIDERS[profile.provider];
  if (!preset) throw new Error(`Unsupported AI provider: ${profile.provider}`);
  return {
    ...preset,
    baseUrl: normalizeBaseUrl(
      preset.custom || preset.local
        ? (profile.base_url || preset.baseUrl)
        : preset.baseUrl
    ),
  };
}

function cleanJsonText(text) {
  const value = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const start = value.indexOf('{');
  if (start < 0) throw new Error('AI 返回内容中没有 JSON 对象');
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < value.length; i += 1) {
    const char = value[i];
    if (escaped) { escaped = false; continue; }
    if (char === '\\' && inString) { escaped = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (char === '{') depth += 1;
    if (char === '}') {
      depth -= 1;
      if (depth === 0) return value.slice(start, i + 1);
    }
  }
  throw new Error('AI 返回的 JSON 不完整');
}

async function fetchJson(url, options = {}, timeoutMs = 120000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, redirect: 'error', signal: controller.signal });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!response.ok) {
      const providerMessage = data?.error?.message || data?.message || data?.raw;
      const safeMessage = String(providerMessage || `HTTP ${response.status}`).slice(0, 500);
      throw new Error(`AI provider error (${response.status}): ${safeMessage}`);
    }
    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function authHeaders(config, apiKey) {
  if (config.protocol === 'anthropic') {
    return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' };
  }
  return { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
}

async function listModels(profile, apiKey) {
  const config = providerConfig(profile);
  if (config.local) throw new Error('Ollama 模型列表需由浏览器直接读取本机服务');
  if (profile.provider === 'custom') await assertSafeCustomUrl(config.baseUrl);

  if (config.protocol === 'gemini') {
    const data = await fetchJson(`${config.baseUrl}/models?key=${encodeURIComponent(apiKey)}`);
    return (data.models || []).map(item => String(item.name || '').replace(/^models\//, '')).filter(Boolean);
  }
  const data = await fetchJson(`${config.baseUrl}/models`, { headers: authHeaders(config, apiKey) }, 30000);
  return (data.data || data.models || []).map(item => item.id || item.name).filter(Boolean);
}

function buildOpenAIContent(messages, images) {
  if (!images?.length) return messages;
  const next = messages.map(message => ({ ...message }));
  const target = next.length - 1;
  next[target] = {
    ...next[target],
    content: [
      { type: 'text', text: String(next[target].content || '') },
      ...images.map(image => ({ type: 'image_url', image_url: { url: image } })),
    ],
  };
  return next;
}

async function generateOpenAI(profile, apiKey, request) {
  const config = providerConfig(profile);
  if (profile.provider === 'custom') await assertSafeCustomUrl(config.baseUrl);
  const body = {
    model: request.model || profile.model,
    messages: buildOpenAIContent(request.messages, request.images),
    temperature: request.temperature ?? 0.3,
    max_tokens: request.maxTokens || 4096,
    stream: false,
  };
  if (request.structured) body.response_format = { type: 'json_object' };
  const data = await fetchJson(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: authHeaders(config, apiKey),
    body: JSON.stringify(body),
  });
  return data.choices?.[0]?.message?.content || '';
}

async function generateAnthropic(profile, apiKey, request) {
  const config = providerConfig(profile);
  const system = request.messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const filteredMessages = request.messages.filter(m => m.role !== 'system');
  if (request.structured && filteredMessages.length) {
    const last = filteredMessages.length - 1;
    filteredMessages[last] = {
      ...filteredMessages[last],
      content: `${filteredMessages[last].content}\n\nReturn ONLY a valid JSON object. Do not use markdown fences.`,
    };
  }
  const messages = filteredMessages.map((message, index, all) => {
    if (request.images?.length && index === all.length - 1 && message.role === 'user') {
      return {
        role: 'user',
        content: [
          { type: 'text', text: message.content },
          ...request.images.map(image => {
            const [meta, data] = image.split(',');
            return { type: 'image', source: { type: 'base64', media_type: meta.match(/data:([^;]+)/)?.[1] || 'image/jpeg', data } };
          }),
        ],
      };
    }
    return message;
  });
  const data = await fetchJson(`${config.baseUrl}/messages`, {
    method: 'POST',
    headers: authHeaders(config, apiKey),
    body: JSON.stringify({
      model: request.model || profile.model,
      system: system || undefined,
      messages,
      temperature: request.temperature ?? 0.3,
      max_tokens: request.maxTokens || 4096,
    }),
  });
  return (data.content || []).filter(item => item.type === 'text').map(item => item.text).join('\n');
}

async function generateGemini(profile, apiKey, request) {
  const config = providerConfig(profile);
  const system = request.messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const conversational = request.messages.filter(m => m.role !== 'system');
  const contents = conversational.map((message, index) => ({
    role: message.role === 'assistant' ? 'model' : 'user',
    parts: [
      { text: message.content },
      ...(request.images?.length && index === conversational.length - 1
        ? request.images.map(image => {
          const [meta, data] = image.split(',');
          return { inlineData: { mimeType: meta.match(/data:([^;]+)/)?.[1] || 'image/jpeg', data } };
        })
        : []),
    ],
  }));
  const model = request.model || profile.model;
  const data = await fetchJson(`${config.baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: system ? { parts: [{ text: system }] } : undefined,
      contents,
      generationConfig: {
        temperature: request.temperature ?? 0.3,
        maxOutputTokens: request.maxTokens || 4096,
        responseMimeType: request.structured ? 'application/json' : undefined,
      },
    }),
  });
  return (data.candidates?.[0]?.content?.parts || []).map(item => item.text || '').join('');
}

async function generate(profile, apiKey, request) {
  const config = providerConfig(profile);
  if (!request.model && !profile.model) throw new Error('请先为该配置选择模型');
  if (!apiKey && !config.local) throw new Error('该配置没有 API Key');
  if (config.local) throw new Error('Ollama 请求需要由浏览器直接访问本机服务');
  if (config.protocol === 'anthropic') return generateAnthropic(profile, apiKey, request);
  if (config.protocol === 'gemini') return generateGemini(profile, apiKey, request);
  return generateOpenAI(profile, apiKey, request);
}

async function generateStructured(profile, apiKey, request) {
  const text = await generate(profile, apiKey, { ...request, structured: true });
  try {
    return JSON.parse(cleanJsonText(text));
  } catch (firstError) {
    const repaired = await generate(profile, apiKey, {
      ...request,
      structured: true,
      temperature: 0,
      messages: [
        {
          role: 'system',
          content: 'You repair malformed model output. Return one valid JSON object only, preserving the original meaning and field names.',
        },
        {
          role: 'user',
          content: `Repair this output into valid JSON:\n\n${String(text).slice(0, 20000)}`,
        },
      ],
    });
    try {
      return JSON.parse(cleanJsonText(repaired));
    } catch {
      throw firstError;
    }
  }
}

module.exports = {
  PROVIDERS,
  serializeProviderCatalog,
  inferCapabilities,
  assertSafeCustomUrl,
  listModels,
  generate,
  generateStructured,
};
