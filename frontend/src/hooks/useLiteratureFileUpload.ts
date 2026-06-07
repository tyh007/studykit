import { useState } from 'react'
import { getAuthToken } from '../lib/api'
import { PDFProcessor } from '../lib/literature/pdf-processor'

export interface UploadProgress {
  fileName: string
  progress: number
  status: 'pending' | 'processing' | 'completed' | 'error'
  error?: string
}

export interface FileUploadResult {
  success: number
  failed: number
  errors: Array<{ fileName: string; error: string }>
}

export function useLiteratureFileUpload() {
  const [uploadProgress, setUploadProgress] = useState<UploadProgress[]>([])
  const [isUploading, setIsUploading] = useState(false)

  const processPDFFile = async (file: File, projectId: string): Promise<any> => {
    const validation = PDFProcessor.validatePDFFile(file)
    if (!validation.valid) throw new Error(validation.error)

    // Upload PDF to server (server extracts text, creates paper record, stores file)
    const formData = new FormData()
    formData.append('file', file)
    formData.append('project_id', projectId)

    const token = getAuthToken()
    const headers: Record<string, string> = {}
    if (token) headers['Authorization'] = `Bearer ${token}`

    const response = await fetch('/api/literature/papers/upload', {
      method: 'POST',
      headers,
      body: formData,
    })

    if (!response.ok) {
      const err = await response.json().catch(() => ({ error: 'Upload failed' }))
      throw new Error(err.error || `HTTP ${response.status}`)
    }

    return response.json()
  }

  const uploadFiles = async (files: File[], projectId: string): Promise<FileUploadResult> => {
    setIsUploading(true)
    const result: FileUploadResult = { success: 0, failed: 0, errors: [] }

    try {
      for (const file of files) {
        setUploadProgress(prev => [...prev, { fileName: file.name, status: 'processing', progress: 0 }])

        try {
          await processPDFFile(file, projectId)
          result.success++
          setUploadProgress(prev =>
            prev.map(p => p.fileName === file.name ? { ...p, status: 'completed', progress: 100 } : p)
          )
        } catch (error) {
          result.failed++
          result.errors.push({ fileName: file.name, error: error instanceof Error ? error.message : 'Unknown error' })
          setUploadProgress(prev =>
            prev.map(p => p.fileName === file.name ? { ...p, status: 'error', progress: 0 } : p)
          )
        }
      }
    } finally {
      setIsUploading(false)
      setTimeout(() => setUploadProgress([]), 3000)
    }

    return result
  }

  const validateFiles = (files: File[]): { valid: File[]; invalid: Array<{ file: File; error: string }> } => {
    const valid: File[] = []
    const invalid: Array<{ file: File; error: string }> = []

    for (const file of files) {
      const validation = PDFProcessor.validatePDFFile(file)
      if (validation.valid) valid.push(file)
      else invalid.push({ file, error: validation.error || 'Invalid file' })
    }

    return { valid, invalid }
  }

  return { uploadFiles, validateFiles, uploadProgress, isUploading }
}
