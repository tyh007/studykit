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
  extract: (data: { paperText: string; detailLevel?: string; customFields?: any[]; userApiKey?: string }) =>
    litRequest<{ success: boolean; extractedData: any; error?: string }>('/literature/ai/extract', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
};
