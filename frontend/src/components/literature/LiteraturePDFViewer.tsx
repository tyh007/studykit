import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import { getAuthToken } from '../../lib/api';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

interface LiteraturePDFViewerProps {
  paperId: string;
  currentPageIndex: number;
  totalPages: number;
  onPageChange: (index: number) => void;
  onTotalPagesChange: (total: number) => void;
  zoom: number;
  onZoomChange: (zoom: number) => void;
  annotationOverlay?: React.ReactNode;
}

export default function LiteraturePDFViewer({
  paperId,
  currentPageIndex,
  totalPages,
  onPageChange,
  onTotalPagesChange,
  zoom,
  onZoomChange,
  annotationOverlay,
}: LiteraturePDFViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setPdfDoc(null);

    const apiBase = (typeof window !== 'undefined' && (window as any).__ENV?.VITE_API_URL)
      ? (window as any).__ENV.VITE_API_URL
      : import.meta.env.VITE_API_URL || '';
    const pdfUrl = `${apiBase}/api/literature/papers/${paperId}/download`;

    const token = getAuthToken();
    const httpHeaders: Record<string, string> = {};
    if (token) httpHeaders['Authorization'] = `Bearer ${token}`;

    pdfjsLib.getDocument({
      url: pdfUrl,
      httpHeaders,
    }).promise
      .then((pdf) => {
        if (!cancelled) {
          setPdfDoc(pdf);
          onTotalPagesChange(pdf.numPages);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || 'Failed to load PDF');
          setLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [paperId, onTotalPagesChange]);

  // Render current page
  useEffect(() => {
    if (!pdfDoc || !canvasRef.current) return;

    let cancelled = false;
    const renderPage = async () => {
      try {
        const page = await pdfDoc.getPage(currentPageIndex + 1);
        if (cancelled) return;

        const viewport = page.getViewport({ scale: zoom / 100 });
        const canvas = canvasRef.current;
        if (!canvas) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        await page.render({
          canvasContext: ctx,
          viewport,
        }).promise;
      } catch (err) {
        console.error('Page render error:', err);
      }
    };

    renderPage();
    return () => { cancelled = true; };
  }, [pdfDoc, currentPageIndex, zoom]);

  const handlePrev = useCallback(() => {
    if (currentPageIndex > 0) onPageChange(currentPageIndex - 1);
  }, [currentPageIndex, onPageChange]);

  const handleNext = useCallback(() => {
    if (currentPageIndex < totalPages - 1) onPageChange(currentPageIndex + 1);
  }, [currentPageIndex, totalPages, onPageChange]);

  if (error) {
    return (
      <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
        {error}
      </div>
    );
  }

  return (
    <>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0.25rem 0', borderBottom: '1px solid var(--color-border)', marginBottom: '0.5rem',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem' }}>
          <button className="btn btn-ghost btn-sm" onClick={handlePrev} disabled={currentPageIndex === 0 || !pdfDoc}>
            ‹
          </button>
          <span style={{ fontSize: '0.8rem', minWidth: '4rem', textAlign: 'center' }}>
            {pdfDoc ? `${currentPageIndex + 1} / ${totalPages}` : '—'}
          </span>
          <button className="btn btn-ghost btn-sm" onClick={handleNext} disabled={currentPageIndex >= totalPages - 1 || !pdfDoc}>
            ›
          </button>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
          <button className="btn btn-ghost btn-sm" onClick={() => onZoomChange(Math.max(25, zoom - 25))} disabled={zoom <= 25}>−</button>
          <span style={{ fontSize: '0.75rem', minWidth: '2.5rem', textAlign: 'center', color: 'var(--color-text-muted)' }}>{zoom}%</span>
          <button className="btn btn-ghost btn-sm" onClick={() => onZoomChange(Math.min(200, zoom + 25))} disabled={zoom >= 200}>+</button>
        </div>
      </div>
      <div style={{
        position: 'relative', display: 'flex', justifyContent: 'center',
        minHeight: 200, overflow: 'auto', background: '#f5f5f5',
      }}>
        {loading && (
          <div style={{ padding: '3rem', color: 'var(--color-text-muted)', fontSize: '0.85rem' }}>
            Loading PDF...
          </div>
        )}
        <div style={{ position: 'relative', display: loading ? 'none' : 'block' }}>
          <canvas ref={canvasRef} style={{ display: 'block', maxWidth: '100%' }} />
          {annotationOverlay && (
            <div style={{ position: 'absolute', inset: 0 }}>
              {annotationOverlay}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
