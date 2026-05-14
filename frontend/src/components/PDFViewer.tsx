import React, { useEffect, useRef, useState, useCallback, forwardRef } from 'react';
import * as pdfjsLib from 'pdfjs-dist';
import type { SourceDocument, SourcePage } from '../types';
import { useStore } from '../store/useStore';

// Set worker path
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString();

interface PDFViewerProps {
  document: SourceDocument;
  pages: SourcePage[];
  currentPageIndex: number;
  onPageChange: (index: number) => void;
  annotationOverlay?: React.ReactNode;
}

export default function PDFViewer({
  document,
  pages,
  currentPageIndex,
  onPageChange,
  annotationOverlay,
}: PDFViewerProps) {
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pdfDoc, setPdfDoc] = useState<any>(null);
  const zoom = useStore((s) => s.zoom);

  // Load PDF document
  useEffect(() => {
    if (!document?.storage_key) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    const apiBase = (typeof window !== 'undefined' && (window as any).__ENV?.VITE_API_URL)
      ? (window as any).__ENV.VITE_API_URL
      : import.meta.env.VITE_API_URL || '';
    const pdfUrl = apiBase ? `${apiBase}/uploads/${document.storage_key}` : `/uploads/${document.storage_key}`;

    pdfjsLib.getDocument(pdfUrl).promise
      .then((pdf) => {
        if (!cancelled) {
          setPdfDoc(pdf);
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          const message = err?.name === 'AbortException'
            ? 'Failed to load PDF. The file may still be processing.'
            : `Failed to load PDF: ${err?.message || 'Unknown error'}`;
          setError(message);
          setLoading(false);
          console.error('PDF load error:', err);
        }
      });

    return () => { cancelled = true; };
  }, [document?.storage_key]);

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
    if (currentPageIndex < pages.length - 1) onPageChange(currentPageIndex + 1);
  }, [currentPageIndex, pages.length, onPageChange]);

  if (error) {
    return (
      <div className="slide-canvas-container">
        <p className="text-sm text-muted">{error}</p>
      </div>
    );
  }

  return (
    <>
      <div className="slide-toolbar">
        <div className="slide-nav">
          <button className="btn btn-ghost btn-sm" onClick={handlePrev} disabled={currentPageIndex === 0}>
            ‹
          </button>
          <span>{currentPageIndex + 1} / {pages.length}</span>
          <button className="btn btn-ghost btn-sm" onClick={handleNext} disabled={currentPageIndex >= pages.length - 1}>
            ›
          </button>
        </div>
        <div className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={() => useStore.getState().setZoom(zoom - 25)} disabled={zoom <= 25}>−</button>
        <span className="text-xs text-muted" style={{ minWidth: '2.5rem', textAlign: 'center' }}>{zoom}%</span>
        <button className="btn btn-ghost btn-sm" onClick={() => useStore.getState().setZoom(zoom + 25)} disabled={zoom >= 200}>+</button>
      </div>
      <div className="slide-canvas-container" ref={canvasContainerRef}>
        {loading && <p className="text-sm text-muted">Loading PDF...</p>}
        <canvas ref={canvasRef} style={{ position: 'relative', zIndex: 1 }} />
        {annotationOverlay && (
          <div style={{ position: 'absolute', inset: 0, zIndex: 2 }}>
            {annotationOverlay}
          </div>
        )}
      </div>
    </>
  );
}
