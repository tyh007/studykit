import { getAuthToken } from './api';

const API_BASE = (typeof window !== 'undefined' && (window as any).__ENV?.VITE_API_URL)
  ? `${(window as any).__ENV.VITE_API_URL}/api`
  : import.meta.env.VITE_API_URL
    ? `${import.meta.env.VITE_API_URL}/api`
    : '/api';

async function litRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  const token = getAuthToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_BASE}${endpoint}`, { ...options, headers });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

interface PaperCreate {
  project_id: string;
  file_name: string;
  file_size: number;
  file_type?: string;
  title?: string;
  authors?: string;
  year?: number;
  journal?: string;
  doi?: string;
  abstract?: string;
  full_text?: string;
  extracted_data?: any;
  processing_status?: string;
}

export const literatureProjectsApi = {
  list: () => litRequest<any[]>('/literature/projects'),
  create: (data: { name: string; description?: string }) =>
    litRequest<any>('/literature/projects', { method: 'POST', body: JSON.stringify(data) }),
  get: (id: string) => litRequest<any>(`/literature/projects/${id}`),
  update: (id: string, data: { name?: string; description?: string }) =>
    litRequest<any>(`/literature/projects/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) =>
    litRequest<{ success: boolean }>(`/literature/projects/${id}`, { method: 'DELETE' }),
  restore: (id: string) =>
    litRequest<any>(`/literature/projects/${id}/restore`, { method: 'POST' }),
};

export const literaturePapersApi = {
  list: (projectId: string, view?: 'library' | 'trash') =>
    litRequest<any[]>(`/literature/papers?projectId=${projectId}${view ? `&view=${view}` : ''}`),
  create: (paper: PaperCreate) =>
    litRequest<any>('/literature/papers', { method: 'POST', body: JSON.stringify(paper) }),
  get: (id: string) => litRequest<any>(`/literature/papers/${id}`),
  update: (id: string, updates: Record<string, any>) =>
    litRequest<any>(`/literature/papers/${id}`, { method: 'PATCH', body: JSON.stringify(updates) }),
  delete: (id: string) =>
    litRequest<{ success: boolean }>(`/literature/papers/${id}`, { method: 'DELETE' }),
  moveToTrash: (id: string) =>
    litRequest<any>(`/literature/papers/${id}`, { method: 'PATCH', body: JSON.stringify({ action: 'moveToTrash' }) }),
  restoreFromTrash: (id: string) =>
    litRequest<any>(`/literature/papers/${id}`, { method: 'PATCH', body: JSON.stringify({ action: 'restoreFromTrash' }) }),
};

export const literatureCustomFieldsApi = {
  list: (projectId: string) =>
    litRequest<any[]>(`/literature/custom-fields?projectId=${projectId}`),
  create: (data: { project_id: string; name: string; description?: string; prompt?: string }) =>
    litRequest<any>('/literature/custom-fields', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: { name?: string; description?: string; prompt?: string }) =>
    litRequest<any>(`/literature/custom-fields/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) =>
    litRequest<{ success: boolean }>(`/literature/custom-fields/${id}`, { method: 'DELETE' }),
};

export const literatureAiApi = {
  check: () => litRequest<{ available: boolean }>('/literature/ai/check', { method: 'POST' }),
  extract: (data: { systemPrompt: string; userPrompt: string; detailLevel?: string; geminiModel?: string; userApiKey?: string }) =>
    litRequest<{ success: boolean; extractedData: any; error?: string }>('/literature/ai/extract', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};

// ===== Stage Two: Zotero =====

export const zoteroApi = {
  connect: (data: { apiKey: string; userId: string }) =>
    litRequest<{ account: any }>('/zotero/connect', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  disconnect: () =>
    litRequest<{ success: boolean }>('/zotero/disconnect', { method: 'POST' }),
  status: () =>
    litRequest<{ status: string; account?: any }>('/zotero/status'),
  listCollections: () =>
    litRequest<{ collections: any[] }>('/zotero/collections'),
  importCollections: (data: { collectionIds: string[] }) =>
    litRequest<{ readingLists: any[] }>('/zotero/import-collections', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  importCollectionItems: (data: { collectionId?: string; readingListId?: string }) =>
    litRequest<{ citationItems: any[] }>('/zotero/import-items', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  syncEvents: () =>
    litRequest<any[]>('/zotero/sync-events'),
};

// ===== Stage Two: Citations =====

export const citationsApi = {
  list: (params?: { search?: string }) =>
    litRequest<any[]>(`/citations${params?.search ? `?search=${encodeURIComponent(params.search)}` : ''}`),
  get: (id: string) =>
    litRequest<any>(`/citations/${id}`),
  create: (data: {
    title: string;
    creators_json?: any[];
    issued_year?: number;
    item_type?: string;
    publisher?: string;
    doi?: string;
    url?: string;
    abstract?: string;
  }) =>
    litRequest<any>('/citations', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    litRequest<{ success: boolean }>(`/citations/${id}`, { method: 'DELETE' }),
};

// ===== Stage Two: Reading Lists =====

export const readingListsApi = {
  list: (moduleId?: string) =>
    litRequest<any[]>(`/reading-lists${moduleId ? `?module_id=${moduleId}` : ''}`),
  get: (id: string) =>
    litRequest<any>(`/reading-lists/${id}`),
  create: (data: { name: string; description?: string; module_id?: string }) =>
    litRequest<any>('/reading-lists', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  update: (id: string, data: { name?: string; description?: string }) =>
    litRequest<any>(`/reading-lists/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    }),
  delete: (id: string) =>
    litRequest<{ success: boolean }>(`/reading-lists/${id}`, { method: 'DELETE' }),
  addItem: (readingListId: string, citationItemId: string) =>
    litRequest<any>(`/reading-lists/${readingListId}/items`, {
      method: 'POST',
      body: JSON.stringify({ citation_item_id: citationItemId }),
    }),
  removeItem: (readingListId: string, itemId: string) =>
    litRequest<{ success: boolean }>(`/reading-lists/${readingListId}/items/${itemId}`, { method: 'DELETE' }),
};
