/**
 * Parse AI chat/model output into an optional "thinking" block and the final
 * response text. Two formats are supported:
 *
 *  1. The local prompt template (`prompt-builder.ts`) emits a leading
 *     "Here's a thinking process:" marker followed by a numbered list. The
 *     numbered steps are the model's reasoning; everything after the last
 *     numbered step is the user-facing answer.
 *  2. Some models (Qwen3 / DeepSeek-R1 / etc.) wrap reasoning in raw
 *     `<think>...</think>` XML tags. The contents of those tags are folded
 *     into the thinking block and stripped from the response.
 *
 * Returns `thinking: null` when no reasoning block can be detected so callers
 * can skip rendering the collapsible details UI.
 */
export interface ParsedAIResponse {
  thinking: string | null;
  response: string;
}

export function parseAIContent(text: string): ParsedAIResponse {
  if (!text) return { thinking: null, response: text };

  // 1. Raw <think>...</think> tags (case-insensitive, possibly multiline).
  const thinkTag = /<think>([\s\S]*?)<\/think>/i;
  const thinkMatch = text.match(thinkTag);
  if (thinkMatch) {
    const thinking = thinkMatch[1].trim();
    const response = text.replace(thinkTag, '').trim();
    if (thinking) return { thinking, response: response || text };
  }

  // 2. "Here's a thinking process:" marker + numbered steps.
  const marker = "Here's a thinking process:";
  const idx = text.indexOf(marker);
  if (idx === -1) return { thinking: null, response: text };

  const lines = text.split('\n');
  let markerLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(marker)) {
      markerLine = i;
      break;
    }
  }
  if (markerLine === -1) return { thinking: null, response: text };

  // Find the LAST numbered step (1., 2., etc.) after the marker.
  let lastNumLine = -1;
  for (let i = markerLine + 1; i < lines.length; i++) {
    if (/^\s*\d+\./.test(lines[i])) lastNumLine = i;
  }

  if (lastNumLine !== -1) {
    const thinking = lines.slice(0, lastNumLine + 1).join('\n').trim();
    const rest = lines
      .slice(lastNumLine + 1)
      .map((l) => l.trim())
      .filter(Boolean)
      .join('\n')
      .trim();
    return { thinking, response: rest || text };
  }
  return { thinking: null, response: text };
}