const API_BASE = '/api';

let authToken: string | null = null;

export function setAuthToken(token: string | null) {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

async function request<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`;
  }

  // Don't set Content-Type for FormData (multipart)
  if (!(options.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }

  return response.json();
}

// ===== Auth =====

export interface AuthResponse {
  user: { id: string; email: string; display_name: string };
  token: string;
  workspace_id: string;
}

export const authApi = {
  register: (email: string, password: string, display_name?: string) =>
    request<AuthResponse>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, display_name }),
    }),

  login: (email: string, password: string) =>
    request<AuthResponse>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  me: () => request<{ user: any }>('/auth/me'),
};

// ===== Modules =====

export const modulesApi = {
  list: () => request<any[]>('/modules'),
  create: (data: { title: string; code?: string; academic_term?: string; colour?: string }) =>
    request<any>('/modules', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<any>) =>
    request<any>(`/modules/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<{ success: boolean }>(`/modules/${id}`, { method: 'DELETE' }),
  restore: (id: string) =>
    request<any>(`/modules/${id}/restore`, { method: 'POST' }),
  permanentDelete: (id: string) =>
    request<{ success: boolean }>(`/modules/${id}/permanent`, { method: 'DELETE' }),
};

// ===== Lectures =====

export const lecturesApi = {
  list: (moduleId: string) => request<any[]>(`/lectures?module_id=${moduleId}`),
  create: (data: { module_id: string; title: string; lecture_date?: string; week_label?: string }) =>
    request<any>('/lectures', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<any>) =>
    request<any>(`/lectures/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  delete: (id: string) =>
    request<{ success: boolean }>(`/lectures/${id}`, { method: 'DELETE' }),
  restore: (id: string) =>
    request<any>(`/lectures/${id}/restore`, { method: 'POST' }),
  permanentDelete: (id: string) =>
    request<{ success: boolean }>(`/lectures/${id}/permanent`, { method: 'DELETE' }),
};

// ===== Source Documents =====

// ===== Exports =====

export const exportsApi = {
  list: () => request<any[]>('/exports'),
  create: (data: { lecture_id: string; module_id?: string; export_type: 'pdf' | 'markdown'; template_id?: string; include_annotations?: boolean }) =>
    request<{ id: string; status: string; message: string }>('/exports', {
      method: 'POST',
      body: JSON.stringify(data),
    }),
  get: (id: string) => request<any>(`/exports/${id}`),
  getDownloadUrl: (id: string) => `/api/exports/${id}/download`,
};

export const sourceDocumentsApi = {
  upload: (lectureId: string, file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('lecture_id', lectureId);
    return request<any>('/source-documents/upload', {
      method: 'POST',
      body: formData,
    });
  },
  get: (id: string) => request<any>(`/source-documents/${id}`),
  getPages: (id: string) => request<any[]>(`/source-documents/${id}/pages`),
  process: (id: string) =>
    request<any>(`/source-documents/${id}/process`, { method: 'POST' }),
};

// ===== Sync =====

export interface SyncPushPayload {
  workspace_id: string;
  device_id: string;
  last_seen_server_cursor?: string;
  operations: Array<{
    id: string;
    sequence_number: number;
    target_table: string;
    target_id: string;
    operation_type: string;
    patch_json: any;
    base_version?: number;
  }>;
}

export interface SyncPullResponse {
  workspace_id: string;
  server_cursor: string;
  operations: any[];
  conflicts: any[];
}

export const syncApi = {
  registerDevice: (deviceId: string, label?: string) =>
    request<any>('/sync/devices', {
      method: 'POST',
      body: JSON.stringify({ device_id: deviceId, label }),
    }),

  push: (payload: SyncPushPayload) =>
    request<{ applied: number; conflicts: any[]; server_cursor: string }>('/sync/push', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  pull: (workspaceId: string, since?: string) =>
    request<SyncPullResponse>(`/sync/pull?workspaceId=${workspaceId}${since ? `&since=${since}` : ''}`),

  syncAnnotations: (annotations: any[]) =>
    request<any[]>('/sync/annotations', {
      method: 'POST',
      body: JSON.stringify(annotations),
    }),

  getAnnotations: (lectureId: string) =>
    request<any[]>(`/sync/annotations?lecture_id=${lectureId}`),
};
