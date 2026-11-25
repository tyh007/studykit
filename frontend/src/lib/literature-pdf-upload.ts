import { getAuthToken } from './api';
import type { LiteraturePaper } from '../types';
import { PDFProcessor } from './literature/pdf-processor';

/**
 * Upload a single PDF to the server and return the created paper row.
 * Used by both the existing table upload flow and the canvas drop flow so
 * they share the same wire format and validation.
 */
export async function uploadPDFFile(
  file: File,
  projectId: string
): Promise<LiteraturePaper> {
  const validation = PDFProcessor.validatePDFFile(file);
  if (!validation.valid) {
    throw new Error(validation.error || 'Invalid PDF');
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('project_id', projectId);

  const token = getAuthToken();
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const response = await fetch('/api/literature/papers/upload', {
    method: 'POST',
    headers,
    body: formData,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(err.error || `HTTP ${response.status}`);
  }
  return response.json();
}

/**
 * Validate a list of dropped/selected files and partition into valid + invalid.
 */
export function validatePDFFiles(files: File[]): {
  valid: File[];
  invalid: Array<{ file: File; error: string }>;
} {
  const valid: File[] = [];
  const invalid: Array<{ file: File; error: string }> = [];
  for (const file of files) {
    const v = PDFProcessor.validatePDFFile(file);
    if (v.valid) valid.push(file);
    else invalid.push({ file, error: v.error || 'Invalid file' });
  }
  return { valid, invalid };
}
