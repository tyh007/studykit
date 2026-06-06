import React, { useState, useEffect } from 'react';
import { db } from '../lib/db';
import { exportsApi } from '../lib/api';
import type { Lecture, Module, NoteBlock } from '../types';

const EXPIRY_DAYS = 30;

interface ExportDialogProps {
  lecture: Lecture;
  module?: Module;
  onClose: () => void;
}

export default function ExportDialog({ lecture, module, onClose }: ExportDialogProps) {
  const [exportType, setExportType] = useState<'pdf' | 'markdown'>('pdf');
  const [includeAnnotations, setIncludeAnnotations] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [result, setResult] = useState<{ message: string; isError?: boolean; jobId?: string; expired?: boolean } | null>(null);
  const [recentExports, setRecentExports] = useState<any[]>([]);

  // Load recent exports for this lecture (for retention info)
  useEffect(() => {
    exportsApi.list()
      .then((jobs) => {
        const lectureExports = (jobs || []).filter((j: any) => j.lecture_id === lecture.id);
        setRecentExports(lectureExports.slice(0, 5));
      })
      .catch(() => {});
  }, [lecture.id]);

  // Check if a date is expired (>30 days)
  const isExpired = (dateStr: string) => {
    const age = Math.floor((Date.now() - new Date(dateStr).getTime()) / (1000 * 60 * 60 * 24));
    return age >= EXPIRY_DAYS;
  };

  const handleExport = async () => {
    setExporting(true);
    setResult(null);

    try {
      // Create export job on server
      const job = await exportsApi.create({
        lecture_id: lecture.id,
        module_id: module?.id,
        export_type: exportType,
        template_id: 'slide_left_notes_right',
        include_annotations: includeAnnotations,
      });

      if (exportType === 'markdown') {
        // Poll for completion then download
        let attempts = 0;
        const poll = setInterval(async () => {
          attempts++;
          try {
            const status = await exportsApi.get(job.id);
            if (status.status === 'succeeded') {
              clearInterval(poll);
              const url = exportsApi.getDownloadUrl(job.id);
              // Trigger download via hidden iframe (works for file downloads)
              const a = document.createElement('a');
              a.href = url;
              a.download = `${lecture.title.replace(/\s+/g, '_')}.md`;
              document.body.appendChild(a);
              a.click();
              document.body.removeChild(a);
              setResult({
                message: `Markdown exported! ${status.report_json?.block_count || ''} blocks. File will be kept for ${EXPIRY_DAYS} days.`,
                jobId: job.id,
              });
              setExporting(false);
            } else if (status.status === 'failed') {
              clearInterval(poll);
              // Fall back to client-side markdown generation
              const blocks = await db.noteBlocks
                .where({ lecture_id: lecture.id })
                .filter((b: any) => !b.deleted_at)
                .sortBy('sort_order');
              const annoBlocks = includeAnnotations ? blocks.filter((b: any) => b.block_type === 'annotation') : [];
              const contentBlocks = blocks.filter((b: any) => b.block_type !== 'cue' && b.block_type !== 'summary' && b.block_type !== 'annotation');
              const markdown = generateMarkdown(lecture, contentBlocks, annoBlocks, module);
              downloadText(markdown, `${lecture.title.replace(/\s+/g, '_')}.md`, 'text/markdown');
              setResult({ message: `Server export failed — downloaded client-side instead. ${blocks.length} blocks.` });
              setExporting(false);
            }
          } catch {
            if (attempts > 20) {
              clearInterval(poll);
              // Fallback to client-side
              const blocks = await db.noteBlocks
                .where({ lecture_id: lecture.id })
                .filter((b: any) => !b.deleted_at)
                .sortBy('sort_order');
              const contentBlocks = blocks.filter((b: any) => b.block_type !== 'cue' && b.block_type !== 'summary' && b.block_type !== 'annotation');
              const markdown = generateMarkdown(lecture, contentBlocks, [], module);
              downloadText(markdown, `${lecture.title.replace(/\s+/g, '_')}.md`, 'text/markdown');
              setResult({ message: 'Markdown downloaded (client-side fallback).' });
              setExporting(false);
            }
          }
        }, 1000);
      } else {
        // PDF: use browser print, but job is tracked
        window.print();
        setResult({
          message: `PDF export job created. Use browser print (⌘P / Ctrl+P) to save as PDF. Download link expires in ${EXPIRY_DAYS} days.`,
          jobId: job.id,
        });
        setExporting(false);
      }
    } catch (err: any) {
      // Fallback to client-side export
      try {
        if (exportType === 'markdown') {
          const blocks = await db.noteBlocks
            .where({ lecture_id: lecture.id })
            .filter((b: any) => !b.deleted_at)
            .sortBy('sort_order');
          const contentBlocks = blocks.filter((b: any) => b.block_type !== 'cue' && b.block_type !== 'summary' && b.block_type !== 'annotation');
          const markdown = generateMarkdown(lecture, contentBlocks, [], module);
          downloadText(markdown, `${lecture.title.replace(/\s+/g, '_')}.md`, 'text/markdown');
          setResult({ message: `Markdown downloaded (client-side). ${blocks.length} blocks.` });
        } else {
          window.print();
          setResult({ message: 'PDF: Use browser print (⌘P / Ctrl+P) to save as PDF.' });
        }
      } catch {
        setResult({ message: `Export failed: ${err.message}`, isError: true });
      }
      setExporting(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h2>Export Lecture</h2>
        <p className="text-sm text-secondary mb-3">
          {module?.title} — {lecture.title}
        </p>

        <div className="form-group">
          <label>Format</label>
          <div className="flex gap-2">
            <button className={`btn btn-sm ${exportType === 'pdf' ? 'btn-primary' : ''}`} onClick={() => setExportType('pdf')}>PDF</button>
            <button className={`btn btn-sm ${exportType === 'markdown' ? 'btn-primary' : ''}`} onClick={() => setExportType('markdown')}>Markdown</button>
          </div>
        </div>

        <div className="form-group">
          <label>Include</label>
          <div className="flex gap-3">
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', fontSize: '0.85rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={includeAnnotations} onChange={(e) => setIncludeAnnotations(e.target.checked)} />
              Margin Annotations
            </label>
          </div>
        </div>

        {/* Retention policy info */}
        <div className="text-xs text-muted" style={{ padding: '0.375rem 0', marginBottom: '0.5rem', borderTop: '1px solid var(--color-border-light)', paddingTop: '0.5rem' }}>
          Export files are retained for <strong>{EXPIRY_DAYS} days</strong>. After that, re-export the lecture.
        </div>

        {result && (
          <div className={`text-sm ${result.isError ? 'error-message' : ''}`} style={{ padding: '0.5rem', background: result.isError ? 'transparent' : 'var(--color-bg-secondary)', borderRadius: 'var(--radius-sm)', marginBottom: '1rem' }}>
            {result.message}
            {result.expired && (
              <div style={{ marginTop: '0.375rem', color: 'var(--color-warning)' }}>
                ⚠️ This export has expired. Please re-export.
              </div>
            )}
          </div>
        )}

        {/* Recent exports list */}
        {recentExports.length > 0 && (
          <div style={{ marginBottom: '0.75rem' }}>
            <div className="text-xs text-muted" style={{ fontWeight: 600, marginBottom: '0.25rem' }}>Previous exports:</div>
            {recentExports.map((job: any) => {
              const expired = job.completed_at && isExpired(job.completed_at);
              return (
                <div key={job.id} className="text-xs" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.25rem 0' }}>
                  <span style={{ fontWeight: 500 }}>{job.export_type?.toUpperCase()}</span>
                  <span className="text-muted">{new Date(job.created_at).toLocaleDateString()}</span>
                  <span style={{ color: job.status === 'succeeded' ? 'var(--color-success)' : 'var(--color-text-muted)' }}>
                    {job.status}
                  </span>
                  {expired && <span style={{ color: 'var(--color-warning)' }}>Expired</span>}
                  {!expired && job.status === 'succeeded' && job.output_storage_key && (
                    <a
                      href={`/api/exports/${job.id}/download`}
                      className="btn btn-ghost btn-sm"
                      style={{ fontSize: '0.7rem', padding: '0.1rem 0.4rem', textDecoration: 'none' }}
                      download
                    >
                      Download
                    </a>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex gap-2 justify-between">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleExport} disabled={exporting}>
            {exporting ? 'Exporting...' : `Export ${exportType.toUpperCase()}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ===== Markdown Generator =====

interface ProsemirrorNode {
  type: string;
  attrs?: Record<string, any>;
  content?: ProsemirrorNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, any> }>;
}

function renderProseMirrorToMarkdown(node: ProsemirrorNode, indent: string = ''): string {
  let result = '';

  // Handle text marks (bold, italic, underline, code, link)
  function renderInline(n: ProsemirrorNode): string {
    let text = n.text || '';
    if (n.marks) {
      for (const mark of n.marks) {
        switch (mark.type) {
          case 'bold': text = `**${text}**`; break;
          case 'italic': text = `*${text}*`; break;
          case 'underline': text = `<u>${text}</u>`; break;
          case 'code': text = `\`${text}\``; break;
          case 'link': text = `[${text}](${mark.attrs?.href || ''})`; break;
        }
      }
    }
    return text;
  }

  switch (node.type) {
    case 'doc':
      if (node.content) {
        result = node.content.map((n) => renderProseMirrorToMarkdown(n)).join('\n\n');
      }
      break;
    case 'heading': {
      const level = node.attrs?.level || 2;
      const prefix = '#'.repeat(level);
      const text = node.content?.map(renderInline).join('') || '';
      result = `${prefix} ${text}`;
      break;
    }
    case 'paragraph': {
      const text = node.content?.map(renderInline).join('') || '';
      result = text;
      break;
    }
    case 'bulletList':
      if (node.content) {
        result = node.content.map((item) => {
          const itemText = item.content?.map((n) => renderProseMirrorToMarkdown(n, '  ')).join('\n') || '';
          return `- ${itemText}`;
        }).join('\n');
      }
      break;
    case 'orderedList': {
      let idx = node.attrs?.order || 1;
      if (node.content) {
        result = node.content.map((item) => {
          const itemText = item.content?.map((n) => renderProseMirrorToMarkdown(n, '  ')).join('\n') || '';
          return `${idx++}. ${itemText}`;
        }).join('\n');
      }
      break;
    }
    case 'listItem':
      result = node.content?.map((n) => renderProseMirrorToMarkdown(n, indent)).join('\n') || '';
      break;
    case 'codeBlock': {
      const lang = node.attrs?.language || '';
      const code = node.content?.map((n) => n.text || '').join('\n') || '';
      result = `\`\`\`${lang}\n${code}\n\`\`\``;
      break;
    }
    case 'blockquote': {
      const inner = node.content?.map((n) => renderProseMirrorToMarkdown(n)).join('\n') || '';
      result = inner.split('\n').map((line) => `> ${line}`).join('\n');
      break;
    }
    case 'equation': {
      const latex = node.attrs?.latex || '';
      const display = node.attrs?.display !== false;
      if (display) {
        result = `$$${latex}$$`;
      } else {
        result = `$${latex}$`;
      }
      break;
    }
    case 'image': {
      const src = node.attrs?.src || '';
      const alt = node.attrs?.alt || '';
      result = `![${alt}](${src})`;
      break;
    }
    case 'text':
      result = renderInline(node);
      break;
    default:
      if (node.text) result = renderInline(node);
      else if (node.content) result = node.content.map((n) => renderProseMirrorToMarkdown(n, indent)).join('\n');
      break;
  }

  return result;
}

function generateMarkdown(
  lecture: Lecture,
  blocks: NoteBlock[],
  annotations: NoteBlock[],
  module?: Module,
): string {
  const lines: string[] = [];

  // YAML frontmatter
  lines.push('---');
  lines.push(`title: "${lecture.title}"`);
  if (module?.title) lines.push(`module: "${module.title}"`);
  if (module?.code) lines.push(`code: "${module.code}"`);
  if (lecture.lecture_date) lines.push(`date: "${lecture.lecture_date}"`);
  if (lecture.week_label) lines.push(`week: "${lecture.week_label}"`);
  lines.push(`exported: "${new Date().toISOString()}"`);
  lines.push('---');
  lines.push('');

  // Title
  lines.push(`# ${lecture.title}`);
  lines.push('');

  if (module?.title) {
    lines.push(`**Module:** ${module.title}${module.code ? ` (${module.code})` : ''}`);
    if (lecture.lecture_date) lines.push(`**Date:** ${lecture.lecture_date}`);
    lines.push('');
  }

  // Build annotation map: paragraph index -> annotation text
  const annoMap = new Map<number, string>();
  for (const a of annotations) {
    const ref = a.linked_source_page_id || '';
    if (ref.startsWith('pos:')) {
      const idx = parseInt(ref.slice(4), 10);
      annoMap.set(idx, a.content_json?.plain_text || '');
    }
  }

  if (blocks.length === 0) {
    lines.push('*No notes for this lecture yet.*');
  } else {
    for (let bi = 0; bi < blocks.length; bi++) {
      const block = blocks[bi];
      const pmJson = block.content_json?.content;
      if (pmJson && pmJson.length > 0) {
        const doc: ProsemirrorNode = { type: 'doc', content: pmJson };
        const md = renderProseMirrorToMarkdown(doc);
        if (md.trim()) {
          lines.push(md);
          // Insert annotation as a margin note if present
          const anno = annoMap.get(bi);
          if (anno) {
            lines.push(`> 📝 *Annotation:* ${anno}`);
          }
          lines.push('');
        }
      } else if (block.content_json?.plain_text) {
        lines.push(block.content_json.plain_text);
        const anno = annoMap.get(bi);
        if (anno) {
          lines.push(`> 📝 *Annotation:* ${anno}`);
        }
        lines.push('');
      }
    }
  }

  // Collect citation references from blocks
  const citationIds = new Set<string>();
  for (const block of blocks) {
    const links = block.source_links_json || {};
    if (links.citations && Array.isArray(links.citations)) {
      links.citations.forEach((id: string) => citationIds.add(id));
    }
  }

  if (citationIds.size > 0) {
    lines.push('## References');
    lines.push('');
    lines.push(`*${citationIds.size} citation(s) referenced in this lecture. Full bibliography available in server-side export.*`);
    lines.push('');
  }

  // Footer
  lines.push('---');
  lines.push(`*Exported from StudyKit on ${new Date().toLocaleDateString()}*`);

  return lines.join('\n');
}

function downloadText(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
