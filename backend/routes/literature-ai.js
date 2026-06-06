const express = require('express');
const db = require('../db');
const { v4: uuidv4 } = require('uuid');

const router = express.Router();

async function getWorkspaceId(userId) {
  const ws = await db.query(
    'SELECT id FROM workspaces WHERE owner_user_id = $1 AND deleted_at IS NULL LIMIT 1',
    [userId]
  );
  return ws.rows[0]?.id;
}

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

// POST /api/literature/ai/vision-extract — multi-modal PDF page extraction via Gemini Vision
router.post('/vision-extract', async (req, res) => {
  try {
    const { pages, prompt, geminiModel, userApiKey, temperature, maxTokens } = req.body;
    if (!pages || !Array.isArray(pages) || pages.length === 0) {
      return res.status(400).json({ error: 'pages array is required' });
    }

    const apiKey = userApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({
        success: false,
        error: 'No Gemini API key configured. Set GEMINI_API_KEY in environment or provide one.',
      });
    }

    const model = geminiModel || 'gemini-2.0-flash';
    const temp = temperature !== undefined ? temperature : 0.3;
    const maxOut = maxTokens || 4096;

    // Build inline data parts from pages (skip data:image/jpeg;base64, prefix)
    const pageParts = pages.map((b64, i) => {
      const clean = b64.includes('base64,') ? b64.split('base64,')[1] : b64;
      return {
        inlineData: { mimeType: 'image/jpeg', data: clean },
        text: `[Page ${i + 1}]`,
      };
    });

    // Flatten parts: system prompt text + page images interleaved
    const parts = [
      { text: prompt || 'Extract structured information from these academic PDF pages.' },
      ...pageParts.flatMap(p => [p, { text: '' }]),
      { text: 'Return ONLY valid JSON with the extracted fields. Do NOT wrap in markdown code blocks.' },
    ];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180000); // 3min for multi-page
    
    let response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ role: 'user', parts }],
            generationConfig: { temperature: temp, maxOutputTokens: maxOut },
          }),
          signal: controller.signal,
        }
      );
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error('Gemini Vision API error:', errText);
      return res.status(502).json({ success: false, error: `Gemini Vision API error: ${response.status}` });
    }

    const data = await response.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

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
    console.error('Vision extraction error:', err);
    res.status(500).json({ success: false, error: 'Vision extraction failed' });
  }
});


/**
 * POST /api/literature/ai/chat
 * Conversational AI chat about papers. Accepts conversation history + paper context.
 */
router.post('/chat', async (req, res) => {
  try {
    const { paperId, messages, scope, paperIds, geminiApiKey, geminiModel } = req.body;
    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    const apiKey = geminiApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({ error: 'No Gemini API key configured. Set GEMINI_API_KEY in environment or provide one.' });
    }

    const model = geminiModel || 'gemini-2.0-flash';

    // Build system context from paper(s)
    let systemContext = 'You are a research assistant helping analyze academic papers. Answer questions based on the provided paper content. If information is not in the provided text, say so.';
    let paperTitles = [];

    if (paperId) {
      // Load single paper context
      const paperResult = await db.query(
        `SELECT id, title, authors, year, journal, abstract, full_text, extracted_data FROM literature_papers WHERE id = $1 AND deleted_at IS NULL`,
        [paperId]
      );
      if (paperResult.rows.length > 0) {
        const p = paperResult.rows[0];
        paperTitles.push(p.title || 'Untitled');
        const extracted = p.extracted_data || {};
        const extractedStr = typeof extracted === 'string' ? extracted : JSON.stringify(extracted, null, 2);
        const fullText = p.full_text ? p.full_text.substring(0, 12000) : '(Full text not available)';
        systemContext = `You are a research assistant analyzing the following academic paper.

TITLE: ${p.title || 'Untitled'}
AUTHORS: ${p.authors || 'Unknown'}
YEAR: ${p.year || 'Unknown'}
JOURNAL: ${p.journal || 'Unknown'}
ABSTRACT: ${p.abstract || 'Not available'}
AI EXTRACTION:
${extractedStr}

FULL TEXT (first 12000 chars):
${fullText}

Answer the user's questions about this paper based on the content above. If asked about something not in the provided text, say so. Use specific details from the paper when relevant.`;
      }
    } else if (paperIds && paperIds.length > 0) {
      // Load multiple papers for cross-paper analysis
      const papersResult = await db.query(
        `SELECT id, title, authors, year, journal, abstract, extracted_data FROM literature_papers WHERE id = ANY($1) AND deleted_at IS NULL`,
        [paperIds]
      );
      if (papersResult.rows.length > 0) {
        const papersStr = papersResult.rows.map((p, i) => {
          paperTitles.push(p.title || 'Untitled');
          const extracted = p.extracted_data || {};
          const extractedStr = typeof extracted === 'string' ? extracted : JSON.stringify(extracted, null, 2);
          return `--- PAPER ${i + 1}: ${p.title || 'Untitled'} ---
AUTHORS: ${p.authors || 'Unknown'} (${p.year || 'Unknown'})
ABSTRACT: ${p.abstract || 'Not available'}
EXTRACTION:
${extractedStr}`;
        }).join('\n\n');
        systemContext = `You are a research assistant analyzing the following academic papers. Compare, contrast, and synthesize findings across papers as needed.

${papersStr}

Answer the user's questions based on these papers. Use specific examples. If information is not available, say so.`;
      }
    }

    // Build the full messages array for Gemini
    const geminiMessages = [
      { role: 'user', parts: [{ text: systemContext }] },
      { role: 'model', parts: [{ text: 'I have analyzed the paper(s). I am ready to answer your questions.' }] },
      ...messages.map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }))
    ];

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 120000);
    let response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: geminiMessages,
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
      return res.status(502).json({ error: `Gemini API error: ${response.status}`, detail: errText });
    }

    const data = await response.json();
    const replyText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';

    res.json({
      message: { role: 'assistant', content: replyText },
      sources: paperTitles,
    });
  } catch (err) {
    console.error('AI chat error:', err);
    res.status(500).json({ error: 'AI chat failed: ' + err.message });
  }
});
