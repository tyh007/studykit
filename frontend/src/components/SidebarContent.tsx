import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useStore } from '../store/useStore';
import { modulesApi, lecturesApi } from '../lib/api';
import { db } from '../lib/db';
import ProjectSidebar from './literature/ProjectSidebar';
import { ModulesIcon, LiteratureIcon, RenameIcon, CopyIcon, TrashIcon, CloseIcon, ChevronUpIcon, ChevronDownIcon, RestoreIcon, DragIcon, BackIcon, AddIcon, MoreIcon } from '../components/ui/Icons';
import ZoteroConnectionPanel from './literature/ZoteroConnectionPanel';
import ZoteroImportPanel from './literature/ZoteroImportPanel';
import type { Module, Lecture } from '../types';

interface SidebarContentProps {
  onShowNewModule: () => void;
  onShowNewLecture: () => void;
}

type SelectableItem = { type: 'module'; id: string } | { type: 'lecture'; id: string };

export default function SidebarContent({ onShowNewModule, onShowNewLecture }: SidebarContentProps) {
  const {
    modules, setModules, selectedModuleId, selectModule,
    lectures, setLectures, selectedLectureId, selectLecture,
    addModule, addLecture, removeModule, removeLecture,
    updateModule, updateLecture,
  } = useStore();

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: SelectableItem } | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{
    items: SelectableItem[];
    checkboxAccepted: boolean;
  } | null>(null);
  const [showTrash, setShowTrash] = useState(false);

  const dragItem = useRef<SelectableItem | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  const [renamingItem, setRenamingItem] = useState<SelectableItem | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  useEffect(() => {
    if (renamingItem && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingItem]);

  const getModuleLectures = useCallback((moduleId: string) => {
    return lectures.filter((l) => l.module_id === moduleId);
  }, [lectures]);

  const getItemTitle = useCallback((item: SelectableItem): string => {
    if (item.type === 'module') {
      return modules.find((m) => m.id === item.id)?.title || '';
    }
    return lectures.find((l) => l.id === item.id)?.title || '';
  }, [modules, lectures]);

  const isSelected = (id: string) => selectedIds.has(id);

  const toggleSelect = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    if (e.ctrlKey || e.metaKey || e.shiftKey) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
    } else {
      setSelectedIds(new Set([id]));
    }
  };

  const clearSelection = () => setSelectedIds(new Set());

  const startRename = (item: SelectableItem) => {
    setRenamingItem(item);
    setRenameValue(getItemTitle(item));
    setContextMenu(null);
  };

  const confirmRename = async () => {
    if (!renamingItem || !renameValue.trim()) {
      setRenamingItem(null);
      return;
    }
    const newTitle = renameValue.trim();
    try {
      if (renamingItem.type === 'module') {
        await modulesApi.update(renamingItem.id, { title: newTitle });
        updateModule(renamingItem.id, { title: newTitle as any });
      } else {
        await lecturesApi.update(renamingItem.id, { title: newTitle });
        updateLecture(renamingItem.id, { title: newTitle as any });
      }
    } catch (err) {
      console.error('Rename failed:', err);
    }
    setRenamingItem(null);
  };

  const cancelRename = () => {
    setRenamingItem(null);
  };

  const handleCopy = useCallback(async (item: SelectableItem) => {
    try {
      if (item.type === 'module') {
        const mod = modules.find((m) => m.id === item.id);
        if (!mod) return;
        const copy = await modulesApi.create({
          title: `${mod.title} (Copy)`,
          code: mod.code,
          colour: mod.colour,
        });
        addModule(copy);
        const moduleLectures = lectures.filter((l) => l.module_id === item.id);
        for (const lec of moduleLectures) {
          await lecturesApi.create({
            module_id: copy.id,
            title: `${lec.title} (Copy)`,
            week_label: lec.week_label,
          });
        }
        const updated = await lecturesApi.list(copy.id);
        setLectures([...lectures, ...updated]);
      } else {
        const lec = lectures.find((l) => l.id === item.id);
        if (!lec) return;
        const copy = await lecturesApi.create({
          module_id: lec.module_id,
          title: `${lec.title} (Copy)`,
          week_label: lec.week_label,
        });
        addLecture(copy);
      }
      setContextMenu(null);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  }, [modules, lectures, addModule, addLecture, setLectures]);

  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteConfirm) return;
    try {
      for (const item of deleteConfirm.items) {
        if (item.type === 'module') {
          await modulesApi.delete(item.id);
          removeModule(item.id);
          const moduleLectures = lectures.filter((l) => l.module_id === item.id);
          for (const lec of moduleLectures) {
            await db.noteBlocks.where('lecture_id').equals(lec.id).modify({ deleted_at: new Date().toISOString() });
            removeLecture(lec.id);
          }
        } else {
          await lecturesApi.delete(item.id);
          removeLecture(item.id);
        }
      }
      setDeleteConfirm(null);
      clearSelection();
    } catch (err) {
      console.error('Delete failed:', err);
    }
  }, [deleteConfirm, lectures, removeModule, removeLecture]);

  const handleDragStart = (e: React.DragEvent, item: SelectableItem) => {
    dragItem.current = item;
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => {
      (e.target as HTMLElement).style.opacity = '0.5';
    }, 0);
  };

  const handleDragEnd = (e: React.DragEvent) => {
    (e.target as HTMLElement).style.opacity = '1';
    setDragOverId(null);
    dragItem.current = null;
  };

  const handleDragOver = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(targetId);
  };

  const handleDragLeave = () => {
    setDragOverId(null);
  };

  const handleDrop = async (e: React.DragEvent, targetItem: SelectableItem) => {
    e.preventDefault();
    setDragOverId(null);
    const source = dragItem.current;
    if (!source || source.id === targetItem.id) return;

    (e.target as HTMLElement).style.opacity = '1';

    try {
      if (source.type === 'module' && targetItem.type === 'module') {
        const sourceIdx = modules.findIndex((m) => m.id === source.id);
        const targetIdx = modules.findIndex((m) => m.id === targetItem.id);
        if (sourceIdx === -1 || targetIdx === -1) return;
        const reordered = [...modules];
        const [moved] = reordered.splice(sourceIdx, 1);
        reordered.splice(targetIdx, 0, moved);
        for (let i = 0; i < reordered.length; i++) {
          await modulesApi.update(reordered[i].id, { sort_order: i });
        }
        setModules(reordered);
      } else if (source.type === 'lecture' && targetItem.type === 'lecture') {
        const sourceLecture = lectures.find((l) => l.id === source.id);
        const targetLecture = lectures.find((l) => l.id === targetItem.id);
        if (!sourceLecture || !targetLecture) return;
        if (sourceLecture.module_id !== targetLecture.module_id) return;
        const moduleLectures = lectures
          .filter((l) => l.module_id === targetLecture.module_id)
          .sort((a, b) => a.sort_order - b.sort_order);
        const sourceIdx = moduleLectures.findIndex((l) => l.id === source.id);
        const targetIdx = moduleLectures.findIndex((l) => l.id === targetItem.id);
        if (sourceIdx === -1 || targetIdx === -1) return;
        const reordered = [...moduleLectures];
        const [moved] = reordered.splice(sourceIdx, 1);
        reordered.splice(targetIdx, 0, moved);
        for (let i = 0; i < reordered.length; i++) {
          await lecturesApi.update(reordered[i].id, { sort_order: i });
        }
        setLectures(lectures.map((l) => {
          const updated = reordered.find((r) => r.id === l.id);
          return updated ? { ...l, sort_order: updated.sort_order } : l;
        }));
      } else if (source.type === 'lecture' && targetItem.type === 'module') {
        const lecture = lectures.find((l) => l.id === source.id);
        const targetModule = modules.find((m) => m.id === targetItem.id);
        if (!lecture || !targetModule) return;
        if (lecture.module_id === targetItem.id) return;
        await lecturesApi.update(source.id, { module_id: targetItem.id });
        const targetLectures = lectures
          .filter((l) => l.module_id === targetItem.id && l.id !== source.id)
          .sort((a, b) => a.sort_order - b.sort_order);
        const newSortOrder = targetLectures.length > 0
          ? targetLectures[targetLectures.length - 1].sort_order + 1
          : 0;
        await lecturesApi.update(source.id, { sort_order: newSortOrder });
        updateLecture(source.id, { module_id: targetItem.id, sort_order: newSortOrder } as any);
      }
    } catch (err) {
      console.error('Reorder/move failed:', err);
    }
    dragItem.current = null;
  };

  const batchDelete = () => {
    const items: SelectableItem[] = [];
    selectedIds.forEach((id) => {
      if (modules.some((m) => m.id === id)) items.push({ type: 'module', id });
      else if (lectures.some((l) => l.id === id)) items.push({ type: 'lecture', id });
    });
    if (items.length > 0) setDeleteConfirm({ items, checkboxAccepted: false });
  };

  const batchCopy = async () => {
    try {
      for (const id of selectedIds) {
        if (modules.some((m) => m.id === id)) {
          await handleCopy({ type: 'module', id });
        } else if (lectures.some((l) => l.id === id)) {
          await handleCopy({ type: 'lecture', id });
        }
      }
      clearSelection();
    } catch (err) {
      console.error('Batch copy failed:', err);
    }
  };

  const isLectureDragging = () => {
    return dragItem.current?.type === 'lecture';
  };

  const contextActions = (item: SelectableItem) => (
    <div className="context-menu" style={{ position: 'fixed', left: contextMenu!.x, top: contextMenu!.y, zIndex: 1000 }}>
      <button onClick={() => startRename(item)}><RenameIcon size="sm" /> Rename</button>
      <button onClick={() => { handleCopy(item); setContextMenu(null); }}><CopyIcon size="sm" /> Copy</button>
      <button onClick={() => { setContextMenu(null); setDeleteConfirm({ items: [item], checkboxAccepted: false }); }}><TrashIcon size="sm" /> Delete</button>
      {item.type === 'lecture' && (
        <>
          <button onClick={async () => {
            const lec = lectures.find((l) => l.id === item.id);
            const lecs = lectures.filter((l) => l.module_id === lec?.module_id).sort((a, b) => a.sort_order - b.sort_order);
            const idx = lecs.findIndex((l) => l.id === item.id);
            if (idx > 0) {
              await lecturesApi.update(item.id, { sort_order: lecs[idx - 1].sort_order });
              await lecturesApi.update(lecs[idx - 1].id, { sort_order: lecs[idx].sort_order });
              const swapped = [...lecs];
              [swapped[idx - 1], swapped[idx]] = [swapped[idx], swapped[idx - 1]];
              setLectures(lectures.map((l) => {
                const updated = swapped.find((s) => s.id === l.id);
                return updated ? { ...l, sort_order: updated.sort_order } : l;
              }));
            }
            setContextMenu(null);
          }}><ChevronUpIcon size="sm" /> Move Up</button>
          <button onClick={async () => {
            const lec = lectures.find((l) => l.id === item.id);
            const lecs = lectures.filter((l) => l.module_id === lec?.module_id).sort((a, b) => a.sort_order - b.sort_order);
            const idx = lecs.findIndex((l) => l.id === item.id);
            if (idx < lecs.length - 1) {
              await lecturesApi.update(item.id, { sort_order: lecs[idx + 1].sort_order });
              await lecturesApi.update(lecs[idx + 1].id, { sort_order: lecs[idx].sort_order });
              const swapped = [...lecs];
              [swapped[idx], swapped[idx + 1]] = [swapped[idx + 1], swapped[idx]];
              setLectures(lectures.map((l) => {
                const updated = swapped.find((s) => s.id === l.id);
                return updated ? { ...l, sort_order: updated.sort_order } : l;
              }));
            }
            setContextMenu(null);
          }}><ChevronDownIcon size="sm" /> Move Down</button>
        </>
      )}
      {item.type === 'module' && (
        <>
          <button onClick={async () => {
            const idx = modules.findIndex((m) => m.id === item.id);
            if (idx > 0) {
              for (let i = 0; i < modules.length; i++) {
                const newOrder = i === idx ? modules[idx - 1].sort_order : i === idx - 1 ? modules[idx].sort_order : modules[i].sort_order;
                const targetId = i === idx ? item.id : i === idx - 1 ? modules[idx - 1].id : null;
                if (targetId) await modulesApi.update(targetId, { sort_order: newOrder });
              }
              const reordered = [...modules];
              [reordered[idx - 1], reordered[idx]] = [reordered[idx], reordered[idx - 1]];
              setModules(reordered);
            }
            setContextMenu(null);
          }}><ChevronUpIcon size="sm" /> Move Up</button>
          <button onClick={async () => {
            const idx = modules.findIndex((m) => m.id === item.id);
            if (idx < modules.length - 1) {
              for (let i = 0; i < modules.length; i++) {
                const newOrder = i === idx ? modules[idx + 1].sort_order : i === idx + 1 ? modules[idx].sort_order : modules[i].sort_order;
                const targetId = i === idx ? item.id : i === idx + 1 ? modules[idx + 1].id : null;
                if (targetId) await modulesApi.update(targetId, { sort_order: newOrder });
              }
              const reordered = [...modules];
              [reordered[idx], reordered[idx + 1]] = [reordered[idx + 1], reordered[idx]];
              setModules(reordered);
            }
            setContextMenu(null);
          }}><ChevronDownIcon size="sm" /> Move Down</button>
        </>
      )}
    </div>
  );

  const { sidebarMode, setSidebarMode } = useStore();

  return (
    <>
      {/* Mode toggle: Modules / Literature */}
      <div className="lit-mode-toggle">
        <button className={sidebarMode === 'modules' ? 'active' : ''} onClick={() => setSidebarMode('modules')}>
          <ModulesIcon size="sm" /> Modules
        </button>
        <button className={sidebarMode === 'literature' ? 'active' : ''} onClick={() => setSidebarMode('literature')}>
          <LiteratureIcon size="sm" /> Literature
        </button>
      </div>

      {sidebarMode === 'literature'
        ? <div className="sidebar-literature">
            <div style={{ padding: '0.375rem 0.5rem 0.25rem', fontSize: '0.65rem', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--color-text-muted)', borderBottom: '1px solid var(--color-border)' }}>
              Zotero
            </div>
            <ZoteroConnectionPanel />
            <ZoteroImportPanel />
            <div style={{ margin: '0.25rem 0.5rem', borderTop: '1px solid var(--color-border)' }} />
            <ProjectSidebar />
          </div>
        : <div className="sidebar-modules">
      <div className="sidebar-header">
        <h2>{showTrash ? 'Trash' : 'Modules'}</h2>
        <div className="flex gap-1">
          <button className="btn btn-ghost btn-sm" onClick={() => { setShowTrash(!showTrash); clearSelection(); }} title={showTrash ? 'Back to modules' : 'Trash'}>
            {showTrash ? <><BackIcon size="sm" /> Back</> : <TrashIcon size="sm" />}
          </button>
          {!showTrash && <button className="btn btn-ghost btn-sm" onClick={onShowNewModule}>+ New</button>}
        </div>
      </div>

      <div className="sidebar-content">
        {showTrash ? (
          <TrashView onRestore={() => {
            modulesApi.list().then(setModules).catch(console.error);
            if (selectedModuleId) lecturesApi.list(selectedModuleId).then(setLectures).catch(console.error);
          }} />
        ) : (
          <>
            {modules.length === 0 && (
              <p className="text-sm text-muted" style={{ padding: '0.75rem' }}>No modules yet. Create your first module to get started.</p>
            )}

            {selectedIds.size > 0 && (
              <div className="batch-bar">
                <span className="text-xs">{selectedIds.size} selected</span>
                <button className="btn btn-ghost btn-sm" onClick={clearSelection}><CloseIcon size="sm" /></button>
                <button className="btn btn-ghost btn-sm" onClick={batchCopy}><CopyIcon size="sm" /> Copy</button>
                <button className="btn btn-ghost btn-sm" onClick={batchDelete}><TrashIcon size="sm" /> Delete</button>
              </div>
            )}

            {modules.map((mod) => {
              const isDragOver = dragOverId === mod.id;
              const lectureDropHint = isLectureDragging();

              return (
                <div key={mod.id}>
                  <div className={`module-item ${selectedModuleId === mod.id ? 'active' : ''} ${isSelected(mod.id) ? 'selected' : ''} ${isDragOver && lectureDropHint ? 'drag-over drop-target' : ''} ${isDragOver && !lectureDropHint ? 'drag-over-same' : ''}`}
                    draggable
                    onDragStart={(e) => handleDragStart(e, { type: 'module', id: mod.id })}
                    onDragEnd={handleDragEnd}
                    onDragOver={(e) => handleDragOver(e, mod.id)}
                    onDragLeave={handleDragLeave}
                    onDrop={(e) => handleDrop(e, { type: 'module', id: mod.id })}
                    onClick={(e) => {
                      if (renamingItem) return;
                      if (e.ctrlKey || e.metaKey || e.shiftKey) { toggleSelect(mod.id, e); }
                      else { clearSelection(); selectModule(mod.id); }
                    }}
                    onDoubleClick={() => startRename({ type: 'module', id: mod.id })}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      setContextMenu({ x: e.clientX, y: e.clientY, item: { type: 'module', id: mod.id } });
                    }}
                  >
                    <input type="checkbox" className="item-checkbox" aria-label={`Select ${mod.title}`} checked={isSelected(mod.id)}
                      onChange={(e) => { e.stopPropagation(); toggleSelect(mod.id, e as any); }} onClick={(e) => e.stopPropagation()} />
                    <span className="colour-dot" style={{ background: mod.colour || 'var(--color-primary)' }} />
                    {renamingItem?.type === 'module' && renamingItem.id === mod.id ? (
                      <input ref={renameInputRef} className="rename-input" value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={confirmRename}
                        onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') cancelRename(); }}
                        onClick={(e) => e.stopPropagation()} />
                    ) : (
                      <span className="module-title">{mod.title}</span>
                    )}
                    {mod.code && !renamingItem && <span className="module-code">{mod.code}</span>}
                    <span className="drag-handle" title="Drag to reorder"><DragIcon size="sm" /></span>
                  </div>

                  {selectedModuleId === mod.id && (
                    <div className={`lecture-list ${isDragOver && lectureDropHint ? 'drag-over-zone' : ''}`}
                      onDragOver={(e) => { if (lectureDropHint) { e.preventDefault(); setDragOverId(mod.id); } }}
                      onDragLeave={handleDragLeave}
                      onDrop={(e) => { if (lectureDropHint) handleDrop(e, { type: 'module', id: mod.id }); }}
                    >
                      {getModuleLectures(mod.id).length > 0 ? (
                        getModuleLectures(mod.id).sort((a, b) => a.sort_order - b.sort_order).map((lec) => (
                          <div key={lec.id}
                            className={`lecture-item ${selectedLectureId === lec.id ? 'active' : ''} ${isSelected(lec.id) ? 'selected' : ''} ${dragOverId === lec.id ? 'drag-over' : ''}`}
                            draggable
                            onDragStart={(e) => handleDragStart(e, { type: 'lecture', id: lec.id })}
                            onDragEnd={handleDragEnd}
                            onDragOver={(e) => handleDragOver(e, lec.id)}
                            onDragLeave={handleDragLeave}
                            onDrop={(e) => handleDrop(e, { type: 'lecture', id: lec.id })}
                            onClick={(e) => {
                              if (renamingItem) return;
                              if (e.ctrlKey || e.metaKey || e.shiftKey) { toggleSelect(lec.id, e); }
                              else { clearSelection(); selectLecture(lec.id); }
                            }}
                            onDoubleClick={() => startRename({ type: 'lecture', id: lec.id })}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              setContextMenu({ x: e.clientX, y: e.clientY, item: { type: 'lecture', id: lec.id } });
                            }}
                          >
                            <input type="checkbox" className="item-checkbox" aria-label={`Select ${lec.title}`} checked={isSelected(lec.id)}
                              onChange={(e) => { e.stopPropagation(); toggleSelect(lec.id, e as any); }} onClick={(e) => e.stopPropagation()} />
                            <div style={{ flex: 1 }}>
                              {renamingItem?.type === 'lecture' && renamingItem.id === lec.id ? (
                                <input ref={renameInputRef} className="rename-input" value={renameValue}
                                  onChange={(e) => setRenameValue(e.target.value)}
                                  onBlur={confirmRename}
                                  onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') cancelRename(); }}
                                  onClick={(e) => e.stopPropagation()} />
                              ) : (
                                <div>{lec.title}</div>
                              )}
                              {lec.week_label && <div className="lecture-week">{lec.week_label}</div>}
                            </div>
                            <span className="drag-handle" title="Drag to reorder"><DragIcon size="sm" /></span>
                          </div>
                        ))
                      ) : (
                        <p className="text-xs text-muted" style={{ padding: '0.375rem 0.625rem' }}>No lectures yet</p>
                      )}
                      <div style={{ padding: '0.375rem 0.625rem' }}>
                        <button className="btn btn-ghost btn-sm" onClick={onShowNewLecture} style={{ fontSize: '0.8rem', color: 'var(--color-text-muted)' }}>+ Add lecture</button>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}
      </div>

      {contextMenu && contextActions(contextMenu.item)}

      {deleteConfirm && (
        <div className="modal-overlay glass-overlay" onClick={() => setDeleteConfirm(null)}>
          <div className="modal-content glass-dialog" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 380 }}>
            <h2>Move to Trash?</h2>
            <p className="text-sm" style={{ marginBottom: '0.75rem', color: 'var(--color-text-secondary)' }}>
              {deleteConfirm.items.length === 1
                ? `Are you sure you want to delete "${deleteConfirm.items[0].type === 'module'
                  ? modules.find((m) => m.id === deleteConfirm.items[0].id)?.title
                  : lectures.find((l) => l.id === deleteConfirm.items[0].id)?.title}"?`
                : `Are you sure you want to delete ${deleteConfirm.items.length} items?`}
            </p>
            <p className="text-xs text-muted" style={{ marginBottom: '0.75rem' }}>
              Deleted items will be moved to trash. Notes and annotations will also be soft-deleted.
            </p>
            <label className="delete-checkbox" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem', cursor: 'pointer', fontSize: '0.85rem' }}>
              <input type="checkbox" checked={deleteConfirm.checkboxAccepted}
                onChange={(e) => setDeleteConfirm({ ...deleteConfirm, checkboxAccepted: e.target.checked })} />
              I understand, move to trash
            </label>
            <div className="flex gap-1" style={{ justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setDeleteConfirm(null)}>Cancel</button>
              <button className="btn btn-danger btn-sm" disabled={!deleteConfirm.checkboxAccepted} onClick={handleDeleteConfirm}>Move to Trash</button>
            </div>
          </div>
        </div>
      )}
      </div>
      }
    </>
  );
}

function TrashView({ onRestore }: { onRestore: () => void }) {
  const { modules, setModules, removeModule, lectures, setLectures, removeLecture, selectedModuleId } = useStore();
  const [loading, setLoading] = useState(true);
  const [trashedModules, setTrashedModules] = useState<any[]>([]);
  const [trashedLectures, setTrashedLectures] = useState<any[]>([]);

  useEffect(() => {
    const load = async () => {
      try {
        const dbModules = await db.modules.toArray();
        const dbLectures = await db.lectures.toArray();
        setTrashedModules(dbModules.filter((m: any) => m.deleted_at));
        setTrashedLectures(dbLectures.filter((l: any) => l.deleted_at));
      } catch (err) { console.error('Failed to load trash:', err); }
      setLoading(false);
    };
    load();
  }, []);

  const handleRestore = async (type: 'module' | 'lecture', id: string) => {
    try {
      if (type === 'module') {
        await modulesApi.restore(id);
        await db.modules.update(id, { deleted_at: undefined as any });
        setTrashedModules((prev) => prev.filter((m) => m.id !== id));
        modulesApi.list().then(setModules).catch(console.error);
      } else {
        await lecturesApi.restore(id);
        await db.lectures.update(id, { deleted_at: undefined as any });
        setTrashedLectures((prev) => prev.filter((l) => l.id !== id));
        if (selectedModuleId) lecturesApi.list(selectedModuleId).then(setLectures).catch(console.error);
      }
    } catch (err) { console.error('Restore failed:', err); }
  };

  const handlePermanentDelete = async (type: 'module' | 'lecture', id: string) => {
    try {
      if (type === 'module') {
        await modulesApi.permanentDelete(id);
        await db.modules.delete(id);
        const moduleLectures = await db.lectures.where('module_id').equals(id).toArray();
        for (const lec of moduleLectures) await db.lectures.delete(lec.id);
        setTrashedModules((prev) => prev.filter((m) => m.id !== id));
        setTrashedLectures((prev) => prev.filter((l) => !moduleLectures.some((ml) => ml.id === l.id)));
      } else {
        await lecturesApi.permanentDelete(id);
        await db.lectures.delete(id);
        setTrashedLectures((prev) => prev.filter((l) => l.id !== id));
      }
    } catch (err) { console.error('Permanent delete failed:', err); }
  };

  if (loading) return <p className="text-sm text-muted" style={{ padding: '0.75rem' }}>Loading trash...</p>;
  if (trashedModules.length === 0 && trashedLectures.length === 0) {
    return <p className="text-sm text-muted" style={{ padding: '0.75rem', textAlign: 'center' }}>Trash is empty.</p>;
  }

  return (
    <div>
      <p className="text-xs text-muted" style={{ padding: '0 0 0.5rem 0' }}>Deleted items appear here. You can restore or permanently delete them.</p>
      {trashedModules.map((mod: any) => (
        <div key={mod.id} className="trash-item">
          <div className="trash-item-info"><span className="trash-item-type">Module</span><span>{mod.title}</span></div>
          <div className="flex gap-1">
            <button className="btn btn-ghost btn-sm" onClick={() => handleRestore('module', mod.id)}><RestoreIcon size="sm" /> Restore</button>
            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-danger)' }} onClick={() => handlePermanentDelete('module', mod.id)}><TrashIcon size="sm" /> Delete</button>
          </div>
        </div>
      ))}
      {trashedLectures.map((lec: any) => (
        <div key={lec.id} className="trash-item">
          <div className="trash-item-info"><span className="trash-item-type">Lecture</span><span>{lec.title}</span></div>
          <div className="flex gap-1">
            <button className="btn btn-ghost btn-sm" onClick={() => handleRestore('lecture', lec.id)}><RestoreIcon size="sm" /> Restore</button>
            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--color-danger)' }} onClick={() => handlePermanentDelete('lecture', lec.id)}><TrashIcon size="sm" /> Delete</button>
          </div>
        </div>
      ))}
    </div>
  );
}
