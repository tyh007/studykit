const express = require('express');

const router = express.Router();

// POST /api/literature/ai/check — health check (Ollama stays browser-side)
router.post('/check', async (req, res) => {
  res.json({ available: true });
});

// POST /api/literature/ai/extract — proxy for Gemini AI extraction
router.post('/extract', async (req, res) => {
  try {
    const { paperText, detailLevel, customFields, userApiKey, geminiModel } = req.body;
    if (!paperText) return res.status(400).json({ error: 'paperText is required' });

    const apiKey = userApiKey || process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(400).json({
        success: false,
        error: 'No Gemini API key configured. Set GEMINI_API_KEY in environment or provide one.',
      });
    }

    const model = geminiModel || 'gemini-2.0-flash';

    // Build prompt matching the existing prompt-builder pattern
    const detailInstruction = detailLevel === 'brief'
      ? 'Keep each field to 2-4 bullet points. Be concise but specific.'
      : 'Be comprehensive. Include specific statistics, effect sizes, and methodological details where provided.';

    const customFieldInstructions = customFields && customFields.length > 0
      ? customFields.map((cf) => `  - ${cf.name}: ${cf.description || ''} ${cf.prompt || ''}`).join('\n')
      : '';

    const prompt = `Analyze the following academic paper and extract structured information into these categories:

1. **Background**: What is the research context, problem statement, and motivation?
2. **Theory**: What theoretical framework or key concepts are used?
3. **Methodology**: What research design, sample, participants, and procedures?
4. **Measures**: What instruments, tools, or measurement techniques?
5. **Results**: What are the main findings, statistics, and effect sizes?
6. **Implications**: What are the practical/theoretical implications?
7. **Limitations**: What limitations do the authors acknowledge?

${customFieldInstructions ? `Additional fields:\n${customFieldInstructions}\n` : ''}
${detailInstruction}

Return ONLY valid JSON with these exact keys: background, theory, methodology, measures, results, implications, limitations${customFields && customFields.length > 0 ? ', plus keys for each custom field (use the field name as the key)' : ''}.

Paper text:
${paperText.substring(0, 32000)}`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            maxOutputTokens: 4096,
          },
        }),
      }
    );

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

module.exports = router;
