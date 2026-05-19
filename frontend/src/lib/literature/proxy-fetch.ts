// CORS proxy helper — routes LLM requests through the backend to avoid browser CORS issues
export async function proxyFetch(url: string, options: RequestInit = {}): Promise<any> {
  const body = options.body
    ? (typeof options.body === 'string' ? JSON.parse(options.body) : options.body)
    : undefined;

  const response = await fetch('/api/literature/ai/proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url,
      method: options.method || 'GET',
      headers: (options.headers as Record<string, string>) || {},
      body,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Proxy error: ${response.status} - ${errText}`);
  }

  const result = await response.json();
  if (!result.success) {
    throw new Error(`Request to ${url} failed: ${result.status}`);
  }

  return result.data;
}
