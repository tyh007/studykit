import React, { useEffect, useCallback, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { LinkIcon, UnlinkIcon, CiteIcon } from './ui/Icons';
import Underline from '@tiptap/extension-underline';
import Highlight from '@tiptap/extension-highlight';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import ImageExt from '@tiptap/extension-image';
import LinkExt from '@tiptap/extension-link';
import { common, createLowlight } from 'lowlight';
import katex from 'katex';
import 'katex/dist/katex.min.css';
import { useStore } from '../store/useStore';
import { db } from '../lib/db';
import { getAuthToken, uploadsApi } from '../lib/api';
import { Equation } from './EquationNode';
import type { NoteBlock, BlockContent, BlockType } from '../types';
import { AddAnnotationButton } from './CornellPanel';
import CitationPicker from './literature/CitationPicker';

const lowlight = createLowlight(common);

interface NoteEditorProps {
  lectureId: string;
}

function generateId(): string {
  return crypto.randomUUID();
}

export default function NoteEditor({ lectureId }: NoteEditorProps) {
  const setNoteBlocks = useStore((s) => s.setNoteBlocks);
  const selectedModuleId = useStore((s) => s.selectedModuleId);
  const deviceId = useStore((s) => s.deviceId);
  const isSavingRef = useRef(false);
  const lastSavedJsonRef = useRef<string>('');

  // Save status: 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
  // 'dirty'  = has unsaved local edits, no save in flight
  // 'saving' = a save is currently in flight
  // 'saved'  = last save succeeded, content is in sync
  // 'error'  = last save attempt failed
  const [saveStatus, setSaveStatus] = useState<'idle' | 'dirty' | 'saving' | 'saved' | 'error'>('idle');
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  // Tick every 30s so "Saved Xs ago" stays fresh
  const [, setStatusTick] = useState(0);

  // Annotation anchoring (uses stable paragraph index, not block ID)
  const [activeParagraphIndex, setActiveParagraphIndex] = useState<number | null>(null);
  const [activeParagraphPreview, setActiveParagraphPreview] = useState('');
  const [annotatedPositions, setAnnotatedPositions] = useState<Set<number>>(new Set());
  const blockCountRef = useRef(0);

  // Equation dialog state
  const [showEquationInput, setShowEquationInput] = useState(false);
  const [equationLatex, setEquationLatex] = useState('');

  // Image dialog state
  const [showImageInput, setShowImageInput] = useState(false);
  const [imageUrl, setImageUrl] = useState('');
  const [imageCaption, setImageCaption] = useState('');
  const [imageUploadTab, setImageUploadTab] = useState<'url' | 'upload'>('url');
  const [selectedImageFile, setSelectedImageFile] = useState<File | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [imageUploadError, setImageUploadError] = useState<string | null>(null);
  const imageFileInputRef = useRef<HTMLInputElement>(null);

  // Keyboard shortcuts help
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Link dialog state
  const [showLinkInput, setShowLinkInput] = useState(false);
  const [showCitationPicker, setShowCitationPicker] = useState(false);
  const [linkUrl, setLinkUrl] = useState('');
  const [linkText, setLinkText] = useState('');
  const [resultMessage, setResultMessage] = useState<string | null>(null);

  // Hold the latest editor + lectureId/moduleId in refs so global listeners
  // (visibilitychange, beforeunload) can flush even if the component is
  // unmounted. This is what fixes "write -> switch lecture -> come back = lost".
  const editorRef = useRef<any>(null);
  const lectureIdRef = useRef<string>('');
  const moduleIdRef = useRef<string | null>('');

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        codeBlock: false,
      }),
      Placeholder.configure({
        placeholder: 'Start writing notes here... Use the toolbar above for formatting',
      }),
      Underline,
      Highlight.configure({ multicolor: true }),
      CodeBlockLowlight.configure({ lowlight }),
      Equation,
      ImageExt.configure({
        inline: false,
        allowBase64: true,
      }),
      LinkExt.configure({
        openOnClick: true,
        HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
      }),
    ],
    editorProps: {
      attributes: {
        class: 'prose prose-sm max-w-none focus:outline-none',
      },
      handlePaste: (view, event) => {
        const items = event.clipboardData?.items;
        if (!items) return false;
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          if (item.type.startsWith('image/')) {
            event.preventDefault();
            const file = item.getAsFile();
            if (file) {
              handleFileUploadToEditor(file);
            }
            return true;
          }
        }
        return false;
      },
      handleDrop: (view, event) => {
        const files = event.dataTransfer?.files;
        if (!files || files.length === 0) return false;
        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          if (file.type.startsWith('image/')) {
            event.preventDefault();
            handleFileUploadToEditor(file);
            return true;
          }
        }
        return false;
      },
    },
    onUpdate: ({ editor }) => {
      editorRef.current = editor;
      if (suppressNextUpdateRef.current) {
        suppressNextUpdateRef.current = false;
        return;
      }
      setSaveStatus('dirty');
      debouncedSave(editor);
    },
  });

  const debouncedSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const usedCitationIdsRef = useRef<string[]>([]);
  // When set, the next onUpdate is ignored — used to suppress autosave
  // immediately after setContent() during note loading.
  const suppressNextUpdateRef = useRef(false);

  // debouncedSave is defined as a ref to avoid circular-dependency issues
  // with saveBlocks (declared further down). We assign it inside a useEffect
  // so it always calls the latest saveBlocks.
  const debouncedSaveRef2 = useRef<(editor: any) => void>(() => {});
  const debouncedSave = useCallback((editor: any) => {
    if (debouncedSaveRef.current) clearTimeout(debouncedSaveRef.current);
    debouncedSaveRef.current = setTimeout(() => debouncedSaveRef2.current(editor), 1500);
  }, []);

  // Track cursor position to determine which paragraph the user is in
  useEffect(() => {
    if (!editor) return;
    const onSelectionUpdate = () => {
      const { from } = editor.state.selection;
      const doc = editor.state.doc;
      const childCount = doc.content.childCount;
      let pos = 0;
      for (let i = 0; i < childCount; i++) {
        const child = doc.content.child(i);
        const childSize = child.nodeSize;
        if (pos <= from && from < pos + childSize) {
          setActiveParagraphIndex(i);
          setActiveParagraphPreview(
            (child.textContent || '').slice(0, 80)
          );
          return;
        }
        pos += childSize;
      }
      setActiveParagraphIndex(null);
      setActiveParagraphPreview('');
    };
    editor.on('selectionUpdate', onSelectionUpdate);
    return () => { editor.off('selectionUpdate', onSelectionUpdate); };
  }, [editor]);

  // Load ALL notes + annotations for the lecture
  useEffect(() => {
    if (!lectureId || !editor) return;

    let cancelled = false;

    const loadNotes = async () => {
      try {
        // Local-first: prefer local Dexie (the source of truth for this
        // device) over the server. The server is only used to seed an empty
        // local DB on first visit or after a full data wipe. This avoids
        // a race where a fire-and-forget keepalive save (from a recent
        // lecture switch) hasn't reached the server yet, and the server
        // returns stale content.
        let blocks: NoteBlock[] = await db.noteBlocks
          .where('lecture_id')
          .equals(lectureId)
          .filter((b) => !b.deleted_at && b.block_type !== 'cue' && b.block_type !== 'summary' && b.block_type !== 'annotation')
          .sortBy('sort_order');

        // If local is empty, try the server to seed the DB.
        if (blocks.length === 0) {
          try {
            const token = getAuthToken();
            if (token) {
              const response = await fetch(`/api/note-blocks?lecture_id=${lectureId}`, {
                headers: { 'Authorization': `Bearer ${token}` },
              });
              if (response.ok) {
                const serverBlocks: NoteBlock[] = await response.json();
                if (serverBlocks && serverBlocks.length > 0) {
                  blocks = serverBlocks;
                  for (const block of blocks) {
                    try { await db.noteBlocks.put(block as any); } catch {}
                  }
                }
              }
            }
          } catch (err) {
            console.warn('Failed to seed from server (staying local-only):', err);
          }
        }

        if (cancelled) return;
        setNoteBlocks(blocks);
        blockCountRef.current = blocks.length;

        // Load annotation positions: each annotation stores "pos:N" in linked_source_page_id
        const annoBlocks = await db.noteBlocks
          .where('lecture_id')
          .equals(lectureId)
          .filter((b) => !b.deleted_at && b.block_type === 'annotation')
          .toArray();
        const positions = new Set<number>();
        for (const a of annoBlocks) {
          const ref = a.linked_source_page_id || '';
          if (ref.startsWith('pos:')) {
            const idx = parseInt(ref.slice(4), 10);
            if (idx >= 0 && idx < blocks.length) positions.add(idx);
          }
        }
        setAnnotatedPositions(positions);

        if (blocks.length > 0) {
          const doc = blocksToProseMirror(blocks);
          suppressNextUpdateRef.current = true;
          editor.commands.setContent(doc);
          lastSavedJsonRef.current = JSON.stringify(doc);
        } else {
          suppressNextUpdateRef.current = true;
          editor.commands.setContent('');
          lastSavedJsonRef.current = '';
        }
        // After loading, the editor content matches the persisted state.
        setSaveStatus('saved');
        setLastSavedAt(Date.now());
      } catch (err) {
        console.error('Failed to load notes:', err);
      }
    };

    loadNotes();
    return () => { cancelled = true; };
  }, [lectureId, editor]);

  // Reload annotation positions when annotations are added/removed
  useEffect(() => {
    const reload = async () => {
      if (!lectureId) return;
      const blocks = await db.noteBlocks
        .where('lecture_id')
        .equals(lectureId)
        .filter((b) => !b.deleted_at && b.block_type !== 'annotation' && b.block_type !== 'cue' && b.block_type !== 'summary')
        .sortBy('sort_order');
      const annoBlocks = await db.noteBlocks
        .where('lecture_id')
        .equals(lectureId)
        .filter((b) => !b.deleted_at && b.block_type === 'annotation')
        .toArray();
      const positions = new Set<number>();
      for (const a of annoBlocks) {
        const ref = a.linked_source_page_id || '';
        if (ref.startsWith('pos:')) {
          const idx = parseInt(ref.slice(4), 10);
          if (idx >= 0 && idx < blocks.length) positions.add(idx);
        }
      }
      setAnnotatedPositions(positions);
    };
    window.addEventListener('studykit:annotation:changed', reload);
    return () => window.removeEventListener('studykit:annotation:changed', reload);
  }, [lectureId]);

  // Save ALL blocks for the lecture (replace all non-cue/non-summary/non-annotation blocks).
  // Reads lectureId/moduleId from refs so it can be called from global listeners
  // (visibilitychange, beforeunload) where the closure-captured values are stale.
  //
  // `silent` — when true, the server call uses navigator.sendBeacon (best-effort,
  // no awaiting, no console noise) instead of fetch. Used for page-unload paths
  // where the browser will tear down the request before fetch can complete.
  const saveBlocks = useCallback(async (editorOverride?: any, silent = false) => {
    const ed = editorOverride || editorRef.current;
    const lid = lectureIdRef.current;
    const mid = moduleIdRef.current;
    if (!ed || !lid || !mid) return;
    if (isSavingRef.current) return;

    const json = ed.getJSON();
    const jsonStr = JSON.stringify(json);
    if (jsonStr === lastSavedJsonRef.current) return;

    isSavingRef.current = true;
    setSaveStatus('saving');
    useStore.getState().setSyncStatus('pending');

    try {
      // Diff-based save: figure out which existing blocks survive, which are
      // gone, and which are new. This avoids the destructive "soft-delete
      // everything then reinsert" path that races with concurrent saves.
      const existingBlocks = await db.noteBlocks
        .where('lecture_id')
        .equals(lid)
        .filter((b) => !b.deleted_at && b.block_type !== 'cue' && b.block_type !== 'summary' && b.block_type !== 'annotation')
        .toArray();
      const existingByJson = new Map<string, NoteBlock>();
      for (const b of existingBlocks) {
        // Key by content signature so identical content from a previous save
        // is reused instead of being churned.
        const sig = `${b.block_type}::${JSON.stringify(b.content_json)}::${b.sort_order}`;
        existingByJson.set(sig, b);
      }

      const now = new Date().toISOString();
      const newBlocks = proseMirrorToBlocks(json, lid, mid, deviceId, now);

      // Attach citation references from current session
      if (usedCitationIdsRef.current.length > 0) {
        for (const block of newBlocks) {
          block.source_links_json = {
            ...block.source_links_json,
            citations: [...(block.source_links_json.citations || []), ...usedCitationIdsRef.current],
          };
        }
      }

      // Compute survivors vs. dropped. A block survives if its content signature
      // matches an existing block — we keep its id so external references
      // (annotations, citations linked by block id) stay valid.
      const newSigs = new Set<string>();
      const survivingIds = new Set<string>();
      for (const block of newBlocks) {
        const sig = `${block.block_type}::${JSON.stringify(block.content_json)}::${block.sort_order}`;
        newSigs.add(sig);
        const match = existingByJson.get(sig);
        if (match) {
          block.id = match.id;        // reuse id
          block.created_at = match.created_at;
          block.version = (match.version || 1) + 1;
          block.updated_at = now;
          survivingIds.add(match.id);
        }
      }

      // Soft-delete blocks that didn't survive
      for (const b of existingBlocks) {
        if (!survivingIds.has(b.id)) {
          try { await db.noteBlocks.update(b.id, { deleted_at: now }); } catch {}
        }
      }

      // Upsert all new blocks (idempotent)
      for (const block of newBlocks) {
        try { await db.noteBlocks.put(block); } catch {}
      }

      // Push to backend. Two paths:
      //   - silent (page unloading / lecture change): fire the fetch in the
      //     background WITHOUT awaiting. `await` is what surfaces "Failed to
      //     fetch" during unload — the request is going out fine, but the
      //     browser tears down the response channel before we can read it.
      //     Dropping the await and adding `keepalive: true` lets the request
      //     complete server-side even after the page is gone. If the payload
      //     is too big for keepalive, the browser rejects synchronously and
      //     we just rely on local Dexie (next session resyncs).
      //   - normal: awaited fetch so we can surface real errors to the user.
      const payload = JSON.stringify(newBlocks.map(b => ({
        id: b.id,
        lecture_id: b.lecture_id,
        module_id: b.module_id,
        block_type: b.block_type,
        content_json: b.content_json,
        source_links_json: b.source_links_json || {},
        sort_order: b.sort_order,
        created_by_device_id: b.created_by_device_id,
        version: b.version || 1,
      })));

      const token = getAuthToken();
      if (token) {
        if (silent) {
          // Fire-and-forget. The catch is just to keep the promise chain
          // silent — we don't care about the response, only that the request
          // was sent. If it fails (offline, payload too big), the local Dexie
          // write is the source of truth.
          fetch('/api/note-blocks', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': `Bearer ${token}`,
            },
            body: payload,
            keepalive: true,
          }).catch(() => { /* best-effort, ignore */ });
        } else {
          try {
            const res = await fetch('/api/note-blocks', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
              },
              body: payload,
            });
            if (!res.ok) {
              console.warn(`Server save returned ${res.status} (will resync from local on next load)`);
            }
          } catch (err: any) {
            // Genuine network error (offline, DNS, etc.). Local Dexie has the
            // data; next session resyncs. Use console.debug so it doesn't
            // fill the console.
            console.debug('Server save failed (will resync from local):', err?.message || err);
          }
        }
      }

      setNoteBlocks(newBlocks);
      lastSavedJsonRef.current = jsonStr;
      setSaveStatus('saved');
      setLastSavedAt(Date.now());
      useStore.getState().setSyncStatus('synced');
      window.dispatchEvent(new CustomEvent('studykit:notes:saved'));
    } catch (err) {
      console.error('Save failed:', err);
      setSaveStatus('error');
      useStore.getState().setSyncStatus('error');
    } finally {
      isSavingRef.current = false;
    }
  }, [deviceId]);

  // Keep refs in sync with current props — used by global flush paths
  useEffect(() => {
    lectureIdRef.current = lectureId;
    moduleIdRef.current = selectedModuleId;
  }, [lectureId, selectedModuleId]);

  useEffect(() => {
    editorRef.current = editor;
  }, [editor]);

  // Wire the latest saveBlocks into the debounced dispatcher
  useEffect(() => {
    debouncedSaveRef2.current = (ed: any) => { void saveBlocks(ed); };
  }, [saveBlocks]);

  // Manual save: clears the debounce timer first so we don't double-save
  const saveNow = useCallback(async () => {
    if (debouncedSaveRef.current) {
      clearTimeout(debouncedSaveRef.current);
      debouncedSaveRef.current = null;
    }
    await saveBlocks();
  }, [saveBlocks]);

  // Ctrl/Cmd + S = manual save
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        saveNow();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [saveNow]);

  // Immediate flush on lecture change / unmount. This is the fix for
  // "write -> switch page -> come back = notes reverted".
  // Silent: the component is about to unmount, so a server fetch would
  // race with React's cleanup and surface as a "Failed to fetch" warning.
  useEffect(() => {
    return () => {
      if (debouncedSaveRef.current) {
        clearTimeout(debouncedSaveRef.current);
        debouncedSaveRef.current = null;
      }
      // Fire-and-forget: must NOT be awaited, otherwise React warns about
      // state updates on an unmounted component. saveBlocks is idempotent.
      void saveBlocks(undefined, true);
    };
  }, [lectureId, saveBlocks]);

  // Immediate flush when the tab is hidden or the page is being unloaded.
  // Silent for the same reason: the browser will tear down the request
  // before fetch can complete, and we don't want console noise for a
  // local-first write that already succeeded.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (debouncedSaveRef.current) {
          clearTimeout(debouncedSaveRef.current);
          debouncedSaveRef.current = null;
        }
        void saveBlocks(undefined, true);
      }
    };
    const onBeforeUnload = () => {
      if (debouncedSaveRef.current) {
        clearTimeout(debouncedSaveRef.current);
        debouncedSaveRef.current = null;
      }
      void saveBlocks(undefined, true);
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [saveBlocks]);

  // Tick the "Saved Xs ago" display every 30s
  useEffect(() => {
    const id = setInterval(() => setStatusTick((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  // Handles image file upload via API and inserts into editor
  const handleFileUploadToEditor = async (file: File) => {
    if (!editor) return;
    if (!file.type.startsWith('image/')) {
      setImageUploadError('Only image files are supported (JPEG, PNG, GIF, WebP)');
      return;
    }
    setIsUploadingImage(true);
    setImageUploadError(null);
    try {
      const result = await uploadsApi.uploadImage(file);
      editor.chain().focus().setImage({ src: result.url }).run();
    } catch (err: any) {
      setImageUploadError(err.message || 'Upload failed');
    } finally {
      setIsUploadingImage(false);
    }
  };

  if (!editor) return null;

  return (
    <div>
      <div role="toolbar" aria-label="Note formatting tools" style={{ marginBottom: '0.5rem', display: 'flex', gap: '0.25rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn btn-ghost btn-sm" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1" aria-label="Heading 1" aria-pressed={editor.isActive('heading', { level: 1 })}>H1</button>
        <button className="btn btn-ghost btn-sm" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2" aria-label="Heading 2" aria-pressed={editor.isActive('heading', { level: 2 })}>H2</button>
        <button className="btn btn-ghost btn-sm" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} title="Heading 3" aria-label="Heading 3" aria-pressed={editor.isActive('heading', { level: 3 })}>H3</button>
        <span role="separator" aria-orientation="vertical" style={{ width: '1px', background: 'var(--color-border)', margin: '0 0.125rem' }} />
        <button className="btn btn-ghost btn-sm" onClick={() => editor.chain().focus().toggleBold().run()} title="Bold (Ctrl+B)" aria-label="Bold" aria-pressed={editor.isActive('bold')}><strong>B</strong></button>
        <button className="btn btn-ghost btn-sm" onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic (Ctrl+I)" aria-label="Italic" aria-pressed={editor.isActive('italic')}><em>I</em></button>
        <button className="btn btn-ghost btn-sm" onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline (Ctrl+U)" aria-label="Underline" aria-pressed={editor.isActive('underline')}><span style={{ textDecoration: 'underline' }}>U</span></button>
        <span className="highlight-colors" role="group" aria-label="Highlight colours">
          <button className="btn btn-ghost btn-sm" onClick={() => editor.chain().focus().toggleHighlight().run()} title="Remove highlight" aria-label="Remove highlight">🖍</button>
          <button className="hl-btn hl-yellow" onClick={() => editor.chain().focus().toggleHighlight({ color: '#fef08a' }).run()} title="Yellow highlight" aria-label="Yellow highlight" />
          <button className="hl-btn hl-green" onClick={() => editor.chain().focus().toggleHighlight({ color: '#bbf7d0' }).run()} title="Green highlight" aria-label="Green highlight" />
          <button className="hl-btn hl-blue" onClick={() => editor.chain().focus().toggleHighlight({ color: '#bfdbfe' }).run()} title="Blue highlight" aria-label="Blue highlight" />
          <button className="hl-btn hl-pink" onClick={() => editor.chain().focus().toggleHighlight({ color: '#fecdd3' }).run()} title="Pink highlight" aria-label="Pink highlight" />
          <button className="hl-btn hl-orange" onClick={() => editor.chain().focus().toggleHighlight({ color: '#fed7aa' }).run()} title="Orange highlight" aria-label="Orange highlight" />
          <button className="hl-btn hl-purple" onClick={() => editor.chain().focus().toggleHighlight({ color: '#d8b4fe' }).run()} title="Purple highlight" aria-label="Purple highlight" />
        </span>
        <span role="separator" aria-orientation="vertical" style={{ width: '1px', background: 'var(--color-border)', margin: '0 0.125rem' }} />
        <button className="btn btn-ghost btn-sm" onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list" aria-label="Bullet list" aria-pressed={editor.isActive('bulletList')}>• List</button>
        <button className="btn btn-ghost btn-sm" onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Ordered list" aria-label="Ordered list" aria-pressed={editor.isActive('orderedList')}>1. List</button>
        <button className="btn btn-ghost btn-sm" onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Callout/quote" aria-label="Callout or quote block" aria-pressed={editor.isActive('blockquote')}>❝ Quote</button>
        <button className="btn btn-ghost btn-sm" onClick={() => editor.chain().focus().toggleCodeBlock().run()} title="Code block" aria-label="Code block" aria-pressed={editor.isActive('codeBlock')}>{'</>'} Code</button>
        <button className="btn btn-ghost btn-sm" onClick={() => { setEquationLatex(''); setShowEquationInput(true); }} title="Insert equation (LaTeX)" aria-label="Insert equation using LaTeX">∑ Equation</button>
        <button className="btn btn-ghost btn-sm" onClick={() => { setImageUrl(''); setImageCaption(''); setShowImageInput(true); }} title="Insert image" aria-label="Insert image">🖼 Image</button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => {
            if (editor?.isActive('link')) {
              // Remove existing link
              editor.chain().focus().unsetLink().run();
              setResultMessage('Link removed.');
              setTimeout(() => setResultMessage(null), 2000);
              return;
            }
            const { from, to } = editor.state.selection ?? { from: 0, to: 0 };
            if (from === to) {
              setResultMessage('Please select some text first, then click the link button.');
              setTimeout(() => setResultMessage(null), 3000);
              return;
            }
            const selectedText = editor.state.doc.textBetween(from, to) || '';
            setLinkText(selectedText);
            setLinkUrl('');
            setShowLinkInput(true);
          }}
          title="Insert or remove link"
          aria-label="Insert or remove hyperlink"
          aria-pressed={editor?.isActive('link') ?? false}
        >{editor?.isActive("link") ? <><UnlinkIcon size="sm" /> Unlink</> : <><LinkIcon size="sm" /> Link</>}</button>
        <span style={{ width: '1px', background: 'var(--color-border)', margin: '0 0.125rem' }} />
        <button className="btn btn-ghost btn-sm" onClick={() => setShowCitationPicker(true)} title="Insert citation" aria-label="Insert citation"><CiteIcon size="sm" /> Cite</button>
        <span style={{ width: '1px', background: 'var(--color-border)', margin: '0 0.125rem' }} />
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => editor.chain().focus().undo().run()}
          disabled={!editor.can().undo()}
          title="Undo (Ctrl+Z)"
          aria-label="Undo"
        >↶ Undo</button>
        <button
          className="btn btn-ghost btn-sm"
          onClick={() => editor.chain().focus().redo().run()}
          disabled={!editor.can().redo()}
          title="Redo (Ctrl+Shift+Z)"
          aria-label="Redo"
        >↷ Redo</button>
        <span style={{ width: '1px', background: 'var(--color-border)', margin: '0 0.125rem' }} />
        <button
          className="btn btn-ghost btn-sm"
          onClick={saveNow}
          disabled={saveStatus === 'saving' || saveStatus === 'saved'}
          title="Save now (Ctrl+S)"
          aria-label="Save notes"
        >💾 {saveStatus === 'saving' ? 'Saving…' : 'Save'}</button>
        <SaveStatusIndicator status={saveStatus} lastSavedAt={lastSavedAt} />
        <span style={{ width: '1px', background: 'var(--color-border)', margin: '0 0.125rem' }} />
        <button className="btn btn-ghost btn-sm" onClick={() => setShowShortcuts(true)} title="Keyboard shortcuts" aria-label="Show keyboard shortcuts">⌨</button>
        <span style={{ width: '1px', background: 'var(--color-border)', margin: '0 0.125rem' }} />
        {activeParagraphIndex !== null && (
          <AddAnnotationButton
            paragraphIndex={activeParagraphIndex}
            paragraphPreview={activeParagraphPreview}
            hasAnnotation={annotatedPositions.has(activeParagraphIndex)}
          />
        )}
        {activeParagraphIndex === null && (
          <span className="text-xs text-muted" style={{ fontStyle: 'italic' }}>Click a paragraph to annotate</span>
        )}
        {resultMessage && (
          <span className="text-xs" style={{ color: 'var(--color-warning)', marginLeft: '0.5rem', fontStyle: 'italic' }}>
            {resultMessage}
          </span>
        )}
      </div>
      <EditorContent editor={editor} />

      {/* Citation picker */}
      {showCitationPicker && (
        <CitationPicker
          onSelect={(citation) => {
            const authors = citation.creators_json || [];
            const authorStr = authors
              .map((c: any) => c.lastName || c.name || '')
              .filter(Boolean)
              .slice(0, 2)
              .join(', ');
            const year = citation.issued_year || '';
            const text = authorStr
              ? `(${authorStr}${year ? `, ${year}` : ''})`
              : `(${citation.title?.substring(0, 40)}${year ? `, ${year}` : ''})`;

            // Insert citation reference text at cursor
            editor?.chain().focus().insertContent(text).run();

            // Track citation ID for source_links_json
            if (!usedCitationIdsRef.current.includes(citation.id)) {
              usedCitationIdsRef.current.push(citation.id);
            }

            setShowCitationPicker(false);
          }}
          onClose={() => setShowCitationPicker(false)}
        />
      )}

      {/* Equation input dialog */}
      {showEquationInput && (
        <div className="modal-overlay" onClick={() => setShowEquationInput(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h2>Insert Equation</h2>
            <p className="text-sm text-muted" style={{ marginBottom: '0.75rem' }}>
              Enter LaTeX equation code. Example: <code>z = {'\\frac{x - \\mu}{\\sigma}'}</code>
            </p>
            <div className="form-group">
              <label htmlFor="eq-latex">LaTeX</label>
              <input
                id="eq-latex"
                value={equationLatex}
                onChange={(e) => setEquationLatex(e.target.value)}
                placeholder="z = \frac{x - \mu}{\sigma}"
                style={{ width: '100%', padding: '0.5rem 0.75rem', fontSize: '0.9rem', fontFamily: 'var(--font-mono)' }}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && equationLatex.trim()) {
                    e.preventDefault();
                    editor?.chain().focus().insertEquation(equationLatex.trim()).run();
                    setShowEquationInput(false);
                    setEquationLatex('');
                  }
                  if (e.key === 'Escape') {
                    setShowEquationInput(false);
                    setEquationLatex('');
                  }
                }}
              />
            </div>
            {/* Live preview */}
            {equationLatex.trim() && (
              <div className="equation-preview" style={{ padding: '0.75rem', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-sm)', marginBottom: '0.75rem', textAlign: 'center' }}>
                <span ref={(el) => {
                  if (el && equationLatex.trim()) {
                    try {
                      katex.render(equationLatex.trim(), el, { displayMode: true, throwOnError: false });
                    } catch {}
                  }
                }} />
              </div>
            )}
            <div className="flex gap-2 justify-between">
              <button className="btn" onClick={() => { setShowEquationInput(false); setEquationLatex(''); }}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={!equationLatex.trim()}
                onClick={() => {
                  editor?.chain().focus().insertEquation(equationLatex.trim()).run();
                  setShowEquationInput(false);
                  setEquationLatex('');
                }}
              >
                Insert Equation
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Image input dialog — URL or file upload */}
      {showImageInput && (
        <div className="modal-overlay" onClick={() => setShowImageInput(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h2>Insert Image</h2>

            {/* Tab bar */}
            <div style={{ display: 'flex', gap: 0, marginBottom: '1rem', borderBottom: '1px solid var(--color-border)' }}>
              <button
                className={imageUploadTab === 'url' ? 'tab-active' : 'tab-inactive'}
                onClick={() => setImageUploadTab('url')}
                style={{
                  flex: 1, padding: '0.5rem 1rem', border: 'none', cursor: 'pointer',
                  background: imageUploadTab === 'url' ? 'var(--color-bg)' : 'var(--color-bg-secondary)',
                  borderBottom: imageUploadTab === 'url' ? '2px solid var(--color-primary)' : '2px solid transparent',
                  fontWeight: imageUploadTab === 'url' ? 600 : 400,
                  fontSize: '0.9rem', borderRadius: 0,
                }}
              >
                URL
              </button>
              <button
                className={imageUploadTab === 'upload' ? 'tab-active' : 'tab-inactive'}
                onClick={() => setImageUploadTab('upload')}
                style={{
                  flex: 1, padding: '0.5rem 1rem', border: 'none', cursor: 'pointer',
                  background: imageUploadTab === 'upload' ? 'var(--color-bg)' : 'var(--color-bg-secondary)',
                  borderBottom: imageUploadTab === 'upload' ? '2px solid var(--color-primary)' : '2px solid transparent',
                  fontWeight: imageUploadTab === 'upload' ? 600 : 400,
                  fontSize: '0.9rem', borderRadius: 0,
                }}
              >
                Upload Local File
              </button>
            </div>

            {/* URL tab */}
            {imageUploadTab === 'url' && (
              <>
                <div className="form-group">
                  <label htmlFor="img-url">Image URL</label>
                  <input
                    id="img-url"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="https://example.com/diagram.png"
                    style={{ width: '100%', padding: '0.5rem 0.75rem', fontSize: '0.9rem' }}
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && imageUrl.trim()) {
                        e.preventDefault();
                        editor?.chain().focus().setImage({ src: imageUrl.trim() }).run();
                        setShowImageInput(false);
                        setImageUrl('');
                      }
                      if (e.key === 'Escape') {
                        setShowImageInput(false);
                        setImageUrl('');
                      }
                    }}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="img-caption">Caption (optional)</label>
                  <input
                    id="img-caption"
                    value={imageCaption}
                    onChange={(e) => setImageCaption(e.target.value)}
                    placeholder="Diagram description"
                    style={{ width: '100%', padding: '0.5rem 0.75rem', fontSize: '0.9rem' }}
                  />
                </div>
                {imageUrl.trim() && (
                  <div style={{ marginBottom: '0.75rem', textAlign: 'center' }}>
                    <img
                      src={imageUrl.trim()}
                      alt="Preview"
                      style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 'var(--radius-sm)', border: '1px solid var(--color-border)' }}
                      onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />
                  </div>
                )}
                <div className="flex gap-2 justify-between">
                  <button className="btn" onClick={() => { setShowImageInput(false); setImageUrl(''); setImageCaption(''); }}>Cancel</button>
                  <button
                    className="btn btn-primary"
                    disabled={!imageUrl.trim()}
                    onClick={() => {
                      editor?.chain().focus().setImage({ src: imageUrl.trim() }).run();
                      if (imageCaption.trim()) {
                        editor?.chain().focus().insertContent({ type: 'paragraph', content: [{ type: 'text', text: imageCaption.trim() }] }).run();
                      }
                      setShowImageInput(false);
                      setImageUrl('');
                      setImageCaption('');
                    }}
                  >
                    Insert Image
                  </button>
                </div>
              </>
            )}

            {/* Local file upload tab */}
            {imageUploadTab === 'upload' && (
              <>
                <div
                  style={{
                    border: '2px dashed var(--color-border)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '2rem 1rem',
                    textAlign: 'center',
                    marginBottom: '0.75rem',
                    cursor: 'pointer',
                    background: 'var(--color-bg-secondary)',
                    transition: 'border-color 0.2s',
                  }}
                  onClick={() => imageFileInputRef.current?.click()}
                  onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
                  onDragLeave={(e) => { e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.currentTarget.style.borderColor = 'var(--color-border)';
                    const file = e.dataTransfer.files[0];
                    if (file && file.type.startsWith('image/')) {
                      setSelectedImageFile(file);
                    }
                  }}
                >
                  <input
                    ref={imageFileInputRef}
                    type="file"
                    accept="image/*"
                    style={{ display: 'none' }}
                    onChange={(e) => {
                      const file = e.target.files?.[0] || null;
                      setSelectedImageFile(file);
                    }}
                  />
                  {selectedImageFile ? (
                    <div>
                      <img
                        src={URL.createObjectURL(selectedImageFile)}
                        alt="Preview"
                        style={{ maxWidth: '100%', maxHeight: 200, borderRadius: 'var(--radius-sm)', marginBottom: '0.5rem' }}
                      />
                      <p className="text-sm" style={{ color: 'var(--color-text-secondary)' }}>
                        {selectedImageFile.name} ({(selectedImageFile.size / 1024).toFixed(1)} KB)
                      </p>
                    </div>
                  ) : (
                    <div>
                      <p style={{ fontSize: '2rem', marginBottom: '0.5rem', opacity: 0.5 }}>🖼</p>
                      <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.9rem' }}>
                        Click to select an image, or drag & drop one here
                      </p>
                      <p className="text-xs text-muted" style={{ marginTop: '0.25rem' }}>
                        Supports JPEG, PNG, GIF, WebP
                      </p>
                    </div>
                  )}
                </div>

                {imageUploadError && (
                  <p style={{ color: 'var(--color-error)', fontSize: '0.85rem', marginBottom: '0.5rem' }}>{imageUploadError}</p>
                )}

                <div className="form-group">
                  <label htmlFor="img-caption-upload">Caption (optional)</label>
                  <input
                    id="img-caption-upload"
                    value={imageCaption}
                    onChange={(e) => setImageCaption(e.target.value)}
                    placeholder="Diagram description"
                    style={{ width: '100%', padding: '0.5rem 0.75rem', fontSize: '0.9rem' }}
                  />
                </div>

                <div className="flex gap-2 justify-between">
                  <button className="btn" onClick={() => { setShowImageInput(false); setImageUrl(''); setImageCaption(''); setSelectedImageFile(null); setImageUploadError(null); }}>Cancel</button>
                  <button
                    className="btn btn-primary"
                    disabled={!selectedImageFile || isUploadingImage}
                    onClick={async () => {
                      if (!selectedImageFile || !editor) return;
                      setIsUploadingImage(true);
                      setImageUploadError(null);
                      try {
                        const result = await uploadsApi.uploadImage(selectedImageFile);
                        editor.chain().focus().setImage({ src: result.url }).run();
                        if (imageCaption.trim()) {
                          editor?.chain().focus().insertContent({ type: 'paragraph', content: [{ type: 'text', text: imageCaption.trim() }] }).run();
                        }
                        setShowImageInput(false);
                        setImageUrl('');
                        setImageCaption('');
                        setSelectedImageFile(null);
                        setImageUploadError(null);
                      } catch (err: any) {
                        setImageUploadError(err.message || 'Upload failed');
                      } finally {
                        setIsUploadingImage(false);
                      }
                    }}
                  >
                    {isUploadingImage ? 'Uploading...' : 'Upload & Insert'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Link input dialog */}
      {showLinkInput && (
        <div className="modal-overlay" onClick={() => setShowLinkInput(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 460 }}>
            <h2>Insert Link</h2>
            <p className="text-sm text-muted" style={{ marginBottom: '0.75rem' }}>
              Creating a link for: <strong>"{linkText}"</strong>
            </p>
            <div className="form-group">
              <label htmlFor="link-url">URL</label>
              <input
                id="link-url"
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                placeholder="https://example.com/reference"
                style={{ width: '100%', padding: '0.5rem 0.75rem', fontSize: '0.9rem' }}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && linkUrl.trim()) {
                    e.preventDefault();
                    editor?.chain().focus().setLink({ href: linkUrl.trim() }).run();
                    setShowLinkInput(false);
                    setLinkUrl('');
                  }
                  if (e.key === 'Escape') {
                    setShowLinkInput(false);
                    setLinkUrl('');
                  }
                }}
              />
            </div>
            <div className="flex gap-2 justify-between">
              <button className="btn" onClick={() => { setShowLinkInput(false); setLinkUrl(''); }}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={!linkUrl.trim()}
                onClick={() => {
                  editor?.chain().focus().setLink({ href: linkUrl.trim() }).run();
                  setShowLinkInput(false);
                  setLinkUrl('');
                }}
              >
                Insert Link
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Keyboard shortcuts dialog */}
      {showShortcuts && (
        <div className="modal-overlay" onClick={() => setShowShortcuts(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 400 }}>
            <h2>Keyboard Shortcuts</h2>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: '0.5rem 1rem', fontSize: '0.85rem', marginTop: '0.75rem' }}>
              <span>Bold</span><span className="shortcut-key">⌘B / Ctrl+B</span>
              <span>Italic</span><span className="shortcut-key">⌘I / Ctrl+I</span>
              <span>Underline</span><span className="shortcut-key">⌘U / Ctrl+U</span>
              <span>Heading 1-3</span><span className="shortcut-key">⌘⌥1-3 / Ctrl+Alt+1-3</span>
              <span>Bullet list</span><span className="shortcut-key">⌘⇧8 / Ctrl+Shift+8</span>
              <span>Ordered list</span><span className="shortcut-key">⌘⇧7 / Ctrl+Shift+7</span>
              <span>Code block</span><span className="shortcut-key">⌘⌥C / Ctrl+Alt+C</span>
              <span>Undo</span><span className="shortcut-key">⌘Z / Ctrl+Z</span>
              <span>Redo</span><span className="shortcut-key">⌘⇧Z / Ctrl+Shift+Z</span>
              <span>Save now</span><span className="shortcut-key">⌘S / Ctrl+S</span>
              <span>Auto-save</span><span className="shortcut-key">every 1.5s, flushes on tab switch &amp; page close</span>
            </div>
            <div className="flex gap-2" style={{ justifyContent: 'flex-end', marginTop: '1rem' }}>
              <button className="btn" onClick={() => setShowShortcuts(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ===== ProseMirror JSON <-> NoteBlock conversion =====

interface ProsemirrorNode {
  type: string;
  attrs?: Record<string, any>;
  content?: ProsemirrorNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, any> }>;
}

function proseMirrorToBlocks(
  doc: ProsemirrorNode, lectureId: string, moduleId: string,
  deviceId: string, now: string,
): NoteBlock[] {
  if (!doc?.content) return [];
  let order = 0;
  const blocks: NoteBlock[] = [];
  for (const node of doc.content) {
    const block = nodeToBlock(node, lectureId, moduleId, deviceId, now, order);
    if (block) { blocks.push(block); order++; }
  }
  return blocks;
}

function nodeToBlock(
  node: ProsemirrorNode, lectureId: string, moduleId: string,
  deviceId: string, now: string, order: number,
): NoteBlock | null {
  const plainText = extractPlainText(node);
  let blockType: BlockType;
  let contentJson: BlockContent;

  switch (node.type) {
    case 'heading': {
      const level = node.attrs?.level || 2;
      blockType = 'heading';
      contentJson = {
        schema_version: '1.0', type: 'heading', attrs: { level },
        content: node.content || [], plain_text: plainText,
        export_hints: { include_in_outline: true },
        accessibility: { semantic_label: `Heading level ${level}` },
      };
      break;
    }
    case 'paragraph': {
      blockType = 'paragraph';
      contentJson = {
        schema_version: '1.0', type: 'paragraph', attrs: {},
        content: node.content || [], plain_text: plainText,
        export_hints: {}, accessibility: {},
      };
      break;
    }
    case 'bulletList':
    case 'orderedList': {
      blockType = 'list';
      const ordered = node.type === 'orderedList';
      contentJson = {
        schema_version: '1.0', type: 'list',
        attrs: { list_style: ordered ? 'decimal' : 'bullet', ordered },
        content: (node.content || []).map((item) => ({ type: 'list_item', content: item.content || [] })),
        plain_text: plainText,
        export_hints: { markdown_list_style: ordered ? 'ordered' : 'unordered' },
        accessibility: { semantic_label: ordered ? 'Ordered list' : 'Unordered list' },
      };
      break;
    }
    case 'codeBlock': {
      blockType = 'code';
      contentJson = {
        schema_version: '1.0', type: 'code',
        attrs: { language: node.attrs?.language || 'text', executable: false },
        content: node.content || [], plain_text: plainText,
        export_hints: { markdown_fence_language: node.attrs?.language || 'text' },
        accessibility: { semantic_label: 'Code block' },
      };
      break;
    }
    case 'blockquote': {
      blockType = 'callout';
      contentJson = {
        schema_version: '1.0', type: 'callout', attrs: { callout_type: 'quote' },
        content: node.content || [], plain_text: plainText,
        export_hints: {}, accessibility: {},
      };
      break;
    }
    case 'equation': {
      blockType = 'equation';
      const latex = node.attrs?.latex || '';
      contentJson = {
        schema_version: '1.0', type: 'equation',
        attrs: { latex, display: node.attrs?.display ?? true, render_status: 'valid' },
        content: [], plain_text: latex,
        export_hints: { latex },
        accessibility: { alt_text: `Equation: ${latex}` },
      };
      break;
    }
    case 'image': {
      blockType = 'image';
      const src = node.attrs?.src || '';
      contentJson = {
        schema_version: '1.0', type: 'image',
        attrs: { attachment_id: '', src, caption: node.attrs?.alt || '' },
        content: [], plain_text: src,
        export_hints: { max_width: '100%' },
        accessibility: { alt_text: node.attrs?.alt || 'Image' },
      };
      break;
    }
    default:
      return null;
  }

  return {
    id: generateId(), lecture_id: lectureId, module_id: moduleId,
    block_type: blockType,
    content_json: contentJson, source_links_json: {},
    sort_order: order, created_by_device_id: deviceId,
    created_at: now, updated_at: now, version: 1,
  };
}

function blocksToProseMirror(blocks: NoteBlock[]): ProsemirrorNode {
  return {
    type: 'doc',
    content: blocks.map(blockToProseMirrorNode).filter(Boolean) as ProsemirrorNode[],
  };
}

function blockToProseMirrorNode(block: NoteBlock): ProsemirrorNode | null {
  const c = block.content_json;
  if (!c) return null;
  switch (block.block_type) {
    case 'heading':
      return { type: 'heading', attrs: { level: c.attrs?.level || 2 }, content: c.content || [] };
    case 'paragraph':
      return { type: 'paragraph', content: c.content || [] };
    case 'list': {
      const isOrdered = c.attrs?.ordered === true;
      return {
        type: isOrdered ? 'orderedList' : 'bulletList',
        attrs: isOrdered ? { order: 1 } : {},
        content: (c.content || []).map((item: any) => ({ type: 'listItem', content: item.content || [] })),
      };
    }
    case 'code':
      return { type: 'codeBlock', attrs: { language: c.attrs?.language || 'text' }, content: c.content || [] };
    case 'callout':
      return { type: 'blockquote', content: c.content || [] };
    case 'equation':
      return {
        type: 'equation',
        attrs: { latex: c.attrs?.latex || '', display: c.attrs?.display ?? true },
        content: [],
      };
    case 'image':
      return {
        type: 'image',
        attrs: { src: c.attrs?.src || '', alt: c.attrs?.caption || c.attrs?.alt || '' },
        content: [],
      };
    default:
      return { type: 'paragraph', content: c.content || [] };
  }
}

function extractPlainText(node: ProsemirrorNode): string {
  if (node.text) return node.text;
  if (!node.content) return '';
  return node.content.map(extractPlainText).join(' ');
}

// ===== Save status indicator =====

function SaveStatusIndicator({
  status,
  lastSavedAt,
}: {
  status: 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
  lastSavedAt: number | null;
}) {
  const [, force] = useState(0);
  // Re-render every 30s so "Saved 2 min ago" stays current
  useEffect(() => {
    const id = setInterval(() => force((n) => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  if (status === 'idle' || !lastSavedAt) {
    return (
      <span
        className="text-xs"
        style={{ color: 'var(--color-text-muted)', marginLeft: '0.25rem', fontStyle: 'italic' }}
        aria-live="polite"
      >
        ●&nbsp;Not saved yet
      </span>
    );
  }

  if (status === 'saving') {
    return (
      <span
        className="text-xs"
        style={{ color: 'var(--color-warning)', marginLeft: '0.25rem', fontStyle: 'italic' }}
        aria-live="polite"
      >
        ●&nbsp;Saving…
      </span>
    );
  }

  if (status === 'dirty') {
    return (
      <span
        className="text-xs"
        style={{ color: 'var(--color-warning)', marginLeft: '0.25rem', fontStyle: 'italic' }}
        aria-live="polite"
      >
        ●&nbsp;Unsaved changes
      </span>
    );
  }

  if (status === 'error') {
    return (
      <span
        className="text-xs"
        style={{ color: 'var(--color-error)', marginLeft: '0.25rem', fontStyle: 'italic' }}
        title="Last save failed. Click Save to retry."
        aria-live="polite"
      >
        ●&nbsp;Save failed
      </span>
    );
  }

  // status === 'saved'
  const ago = Math.max(0, Math.floor((Date.now() - lastSavedAt) / 1000));
  const label =
    ago < 5
      ? 'Saved just now'
      : ago < 60
        ? `Saved ${ago}s ago`
        : `Saved ${Math.floor(ago / 60)} min ago`;
  return (
    <span
      className="text-xs"
      style={{ color: 'var(--color-text-muted)', marginLeft: '0.25rem', fontStyle: 'italic' }}
      aria-live="polite"
    >
      ●&nbsp;{label}
    </span>
  );
}
