import { useState } from 'react'
import { PDFProcessor } from '../lib/literature/pdf-processor'
import { uploadPDFFile, validatePDFFiles } from '../lib/literature-pdf-upload'

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
    return uploadPDFFile(file, projectId)
  }

  const uploadFiles = async (files: File[], projectId: string): Promise<FileUploadResult> => {
    setIsUploading(true)
    const result: FileUploadResult = { success: 0, failed: 0, errors: [] }

    try {
      for (const file of files) {
        setUploadProgress(prev => [...prev, { fileName: file.name, status: 'processing', progress: 0 }])

        try {
          await uploadPDFFile(file, projectId)
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

  return { uploadFiles, validateFiles: validatePDFFiles, uploadProgress, isUploading }
}
