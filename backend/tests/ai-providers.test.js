const test = require('node:test');
const assert = require('node:assert/strict');
const { encryptCredential, decryptCredential, maskCredential } = require('../lib/ai-credentials');
const {
  serializeProviderCatalog,
  inferCapabilities,
  assertSafeCustomUrl,
  listModels,
  generateStructured,
} = require('../lib/ai-providers');

process.env.AI_CREDENTIAL_ENCRYPTION_KEY = '11'.repeat(32);

test('credentials use authenticated encryption and never serialize as plaintext', () => {
  const secret = 'sk-secret-value-1234';
  const encrypted = encryptCredential(secret);
  assert.notEqual(encrypted, secret);
  assert.equal(encrypted.includes(secret), false);
  assert.equal(decryptCredential(encrypted), secret);
  assert.equal(maskCredential(secret), 'sk-••••1234');
});

test('provider catalog includes international and Chinese presets', () => {
  const ids = new Set(serializeProviderCatalog().map(provider => provider.id));
  for (const id of ['openai', 'anthropic', 'gemini', 'deepseek', 'minimax', 'moonshot', 'zhipu', 'dashscope', 'volcengine', 'baidu', 'tencent', 'siliconflow', 'ollama', 'custom']) {
    assert.equal(ids.has(id), true, `missing provider ${id}`);
  }
});

test('capability inference prevents text-only DeepSeek from being selected for vision', () => {
  assert.equal(inferCapabilities('deepseek', 'deepseek-chat').vision, false);
  assert.equal(inferCapabilities('gemini', 'gemini-2.5-pro').vision, true);
  assert.equal(inferCapabilities('zhipu', 'glm-4.5v').vision, true);
});

test('custom provider rejects localhost and cloud metadata targets', async () => {
  await assert.rejects(() => assertSafeCustomUrl('http://localhost:8080/v1'), /本机|私有网络/);
  await assert.rejects(() => assertSafeCustomUrl('http://169.254.169.254/latest/meta-data'), /私有|保留/);
});

test('OpenAI-compatible adapter parses models and structured output', async () => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/models')) {
      return new Response(JSON.stringify({ data: [{ id: 'fixture-model' }] }), { status: 200 });
    }
    return new Response(JSON.stringify({
      choices: [{ message: { content: '{"results":"fixture"}' } }],
    }), { status: 200 });
  };

  try {
    const profile = { provider: 'deepseek', base_url: 'https://ignored.example/v1', model: 'fixture-model' };
    assert.deepEqual(await listModels(profile, 'test-key'), ['fixture-model']);
    const output = await generateStructured(profile, 'test-key', {
      messages: [{ role: 'user', content: 'return json' }],
    });
    assert.deepEqual(output, { results: 'fixture' });
    assert.equal(calls[1].url, 'https://api.deepseek.com/chat/completions');
    assert.equal(JSON.parse(calls[1].options.body).response_format.type, 'json_object');
  } finally {
    global.fetch = originalFetch;
  }
});

test('Chinese provider presets route through their official compatible endpoints', async t => {
  const endpoints = {
    deepseek: 'https://api.deepseek.com',
    minimax: 'https://api.minimaxi.com/v1',
    moonshot: 'https://api.moonshot.cn/v1',
    zhipu: 'https://open.bigmodel.cn/api/paas/v4',
    dashscope: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    volcengine: 'https://ark.cn-beijing.volces.com/api/v3',
    baidu: 'https://qianfan.baidubce.com/v2',
    tencent: 'https://api.hunyuan.cloud.tencent.com/v1',
    siliconflow: 'https://api.siliconflow.cn/v1',
  };

  for (const [provider, endpoint] of Object.entries(endpoints)) {
    await t.test(provider, async () => {
      const originalFetch = global.fetch;
      const calls = [];
      global.fetch = async (url, options = {}) => {
        calls.push({ url: String(url), options });
        return new Response(JSON.stringify({
          choices: [{ message: { content: '{"ok":true}' } }],
        }), { status: 200 });
      };
      try {
        const output = await generateStructured(
          { provider, base_url: 'https://attacker.invalid/v1', model: 'fixture-model' },
          'test-key',
          { messages: [{ role: 'user', content: 'fixture' }] }
        );
        assert.deepEqual(output, { ok: true });
        assert.equal(calls[0].url, `${endpoint}/chat/completions`);
        assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');
      } finally {
        global.fetch = originalFetch;
      }
    });
  }
});
