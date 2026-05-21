import React, { useState } from 'react';
import { literaturePapersApi } from '../../lib/literature-api';
import type { LiteraturePaper, ExtractedData } from '../../types';
import { createAIExtractionService } from '../../lib/literature/ai-extraction';
import LiteraturePDFViewer from './LiteraturePDFViewer';
import PaperAnnotationLayer from './PaperAnnotationLayer';

interface PaperDetailViewProps {
  paper: LiteraturePaper | null;
  onClose: () => void;
  projectId: string;
  onUpdated: () => void;
}

const FIELD_LABELS: Partial<Record<keyof ExtractedData, string>> = {
  background: 'Background', theory: 'Theory', methodology: 'Methodology',
  measures: 'Measures', results: 'Results', implications: 'Implications', limitations: 'Limitations',
  customFields: 'Custom Fields',
};

const EXTRACTED_FIELDS: Exclude<keyof ExtractedData, 'paperType' | 'customFields'>[] = [
  'background', 'theory', 'methodology', 'measures', 'results', 'implications', 'limitations'
];

function copyToClipboard(text: string) {
  navigator.clipboard.writeText(text).catch(console.error);
}

export default function PaperDetailView({ paper, onClose, projectId, onUpdated }: PaperDetailViewProps) {
  const [tab, setTab] = useState<'extracted' | 'metadata' | 'pdf'>('extracted');
  const [extracting, setExtracting] = useState(false);
  const [pdfPageIndex, setPdfPageIndex] = useState(0);
  const [pdfTotalPages, setPdfTotalPages] = useState(0);
  const [pdfZoom, setPdfZoom] = useState(100);

  if (!paper) return null;

  const handleReExtract = async () => {
    if (!paper.full_text) return;
    setExtracting(true);
    try {
      const service = createAIExtractionService();
      const { extractedData } = await service.extractWithFallback(
        paper.full_text,
        'brief',
      );
      await literaturePapersApi.update(paper.id, { extracted_data: extractedData, processing_status: 'completed' });
      onUpdated();
    } catch (err) {
      console.error('Re-extraction failed:', err);
    } finally {
      setExtracting(false);
    }
  };

  const fieldData = paper.extracted_data;

  return (
    <div className="lit-detail-overlay" onClick={onClose}>
      <div className="lit-detail-modal" onClick={e => e.stopPropagation()}>
        <div className="lit-detail-header">
          <h3>{paper.title || paper.file_name}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <div className="lit-tabs">
          <div className={`lit-tab ${tab === 'extracted' ? 'active' : ''}`} onClick={() => setTab('extracted')}>
            Extracted Data
          </div>
          <div className={`lit-tab ${tab === 'metadata' ? 'active' : ''}`} onClick={() => setTab('metadata')}>
            Metadata
          </div>
          {paper.storage_key && (
            <div className={`lit-tab ${tab === 'pdf' ? 'active' : ''}`} onClick={() => { setTab('pdf'); setPdfPageIndex(0); }}>
              View PDF
            </div>
          )}
        </div>

        <div className="lit-detail-body">
          {tab === 'extracted' && (
            <>
              <div style={{ marginBottom: '0.75rem', display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                {paper.full_text && (
                  <button className="btn btn-sm" onClick={handleReExtract} disabled={extracting}>
                    {extracting ? 'Extracting...' : 'Re-extract'}
                  </button>
                )}
                <span className="lit-badge">{paper.processing_status}</span>
                {paper.error_message && <span className="text-muted" style={{ fontSize: '0.75rem' }}>{paper.error_message}</span>}
              </div>
              {fieldData ? (
                EXTRACTED_FIELDS.map(field => {
                  const text = fieldData[field] as string | undefined;
                  if (!text || text === 'Not mentioned') return null;
                  return (
                    <div key={field} className="lit-detail-section">
                      <h4>{FIELD_LABELS[field]}</h4>
                      <p>{text}</p>
                    </div>
                  );
                })
              ) : (
                <p className="text-muted" style={{ fontSize: '0.85rem' }}>No extracted data available.</p>
              )}
              {fieldData?.customFields && Object.entries(fieldData.customFields).map(([key, value]) => (
                <div key={key} className="lit-detail-section">
                  <h4>{key}</h4>
                  <p>{value}</p>
                </div>
              ))}
            </>
          )}

          {tab === 'metadata' && (
            <div>
              <div className="lit-detail-meta">
                <div><strong>File:</strong> {paper.file_name}</div>
                <div><strong>Size:</strong> {(paper.file_size / 1024).toFixed(1)} KB</div>
                {paper.uploaded_at && <div><strong>Uploaded:</strong> {new Date(paper.uploaded_at).toLocaleDateString()}</div>}
                {paper.doi && <div><strong>DOI:</strong> {paper.doi}</div>}
                {paper.journal && <div><strong>Journal:</strong> {paper.journal}</div>}
              </div>
              {paper.abstract && (
                <div className="lit-detail-section">
                  <h4>Abstract</h4>
                  <p>{paper.abstract}</p>
                </div>
              )}
              {paper.full_text && (
                <div className="lit-detail-section">
                  <h4>Full Text <span className="lit-badge">{paper.full_text.length.toLocaleString()} chars</span></h4>
                  <button className="btn btn-ghost btn-sm" style={{ fontSize: '0.75rem' }}
                    onClick={() => copyToClipboard(paper.full_text || '')}>
                    Copy full text
                  </button>
                </div>
              )}
            </div>
          )}

          {tab === 'pdf' && paper.storage_key && (
            <div style={{ height: '70vh', overflow: 'auto' }}>
              <LiteraturePDFViewer
                paperId={paper.id}
                currentPageIndex={pdfPageIndex}
                totalPages={pdfTotalPages}
                onPageChange={setPdfPageIndex}
                onTotalPagesChange={setPdfTotalPages}
                zoom={pdfZoom}
                onZoomChange={setPdfZoom}
                annotationOverlay={
                  <PaperAnnotationLayer
                    paperId={paper.id}
                    pageNumber={pdfPageIndex + 1}
                  />
                }
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
