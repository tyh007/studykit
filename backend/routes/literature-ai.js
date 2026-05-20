const express = require('express');

const router = express.Router();

// POST /api/literature/ai/check — health check (Ollama stays browser-side)
router.post('/check', async (req, res) => {
  res.json({ available: true });
});

// POST /api/literature/ai/extract — proxy for Gemini AI extraction
router.post('/extract', async (req, res) => {
  try {
    const { systemPrompt, userPrompt, detailLevel, userApiKey, geminiModel } = req.body;
    if (!userPrompt) return res.status(400).json({ error: 'userPrompt is required' });

    const apiKey = userApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({
        success: false,
        error: 'No Gemini API key configured. Set GEMINI_API_KEY in environment or provide one.',
      });
    }

    const model = geminiModel || 'gemini-2.0-flash';

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    let response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            system_instruction: systemPrompt ? { parts: [{ text: systemPrompt }] } : undefined,
            contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 4096,
            },
          }),
          signal: controller.signal,
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini API error:', errText);
      return res.status(502).json({ success: false, error: `Gemini API error: ${response.status}` });
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    // Extract JSON from the response (handle potential markdown wrapping)
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return res.status(422).json({ success: false, error: 'Failed to parse AI response as JSON' });
    }

    let extractedData;
    try {
      extractedData = JSON.parse(jsonMatch[0]);
    } catch {
      return res.status(422).json({ success: false, error: 'Invalid JSON from AI response' });
    }

    res.json({ success: true, extractedData });
  } catch (err) {
    console.error('AI extraction error:', err);
    res.status(500).json({ success: false, error: 'AI extraction failed' });
  }
});

// POST /api/literature/ai/proxy — CORS proxy for local LLM (Ollama/Custom API)
router.post('/proxy', async (req, res) => {
  try {
    const { url, method, headers, body } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });

    // Security: only allow local addresses
    let parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname;
    if (!['localhost', '127.0.0.1', '::1', 'host.docker.internal'].includes(hostname)) {
      return res.status(403).json({ error: 'Only local addresses are allowed' });
    }

    // In Docker, localhost refers to the container, not the host
    if (process.env.DOCKER_CONTAINER === 'true' && ['localhost', '127.0.0.1'].includes(hostname)) {
      parsedUrl.hostname = 'host.docker.internal';
    }
    const resolvedUrl = parsedUrl.toString();

    const controller = new AbortController();
    const proxyTimeout = setTimeout(() => controller.abort(), 300000);
    let response;
    try {
      const fetchOptions = {
        method: method || 'GET',
        headers: { 'Content-Type': 'application/json', ...(headers || {}) },
        signal: controller.signal,
      };
      if (body && method !== 'GET') {
        fetchOptions.body = typeof body === 'string' ? body : JSON.stringify(body);
      }

      response = await fetch(resolvedUrl, fetchOptions);
    } finally {
      clearTimeout(proxyTimeout);
    }

    let data;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    res.json({ success: response.ok, status: response.status, data });
  } catch (err) {
    console.error('Proxy error:', err.message);
    res.status(502).json({ success: false, error: err.message });
  }
});

module.exports = router;
