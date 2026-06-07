import React, { useState, useEffect } from 'react';
import { useStore } from '../../store/useStore';
import { RenameIcon, CloseIcon } from '../ui/Icons';
import { literatureProjectsApi } from '../../lib/literature-api';
import { literaturePapersApi, literatureCustomFieldsApi } from '../../lib/literature-api';

export default function ProjectSidebar() {
  const {
    litProjects, setLitProjects, selectedLitProjectId, selectLitProject,
    setLitPapers, setLitCustomFields,
  } = useStore();

  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  useEffect(() => {
    literatureProjectsApi.list().then(setLitProjects).catch(console.error);
  }, []);

  const handleCreate = async () => {
    if (!newProjectName.trim()) return;
    try {
      const project = await literatureProjectsApi.create({ name: newProjectName.trim() });
      setLitProjects([...litProjects, project]);
      setNewProjectName('');
      setShowNewProject(false);
      selectLitProject(project.id);
      literaturePapersApi.list(project.id).then(setLitPapers).catch(console.error);
      literatureCustomFieldsApi.list(project.id).then(setLitCustomFields).catch(console.error);
    } catch (err) {
      console.error('Failed to create project', err);
    }
  };

  const handleSelect = async (id: string) => {
    selectLitProject(id);
    literaturePapersApi.list(id).then(setLitPapers).catch(console.error);
    literatureCustomFieldsApi.list(id).then(setLitCustomFields).catch(console.error);
  };

  const handleRename = async (id: string) => {
    if (!editName.trim()) { setEditingId(null); return; }
    try {
      const updated = await literatureProjectsApi.update(id, { name: editName.trim() });
      setLitProjects(litProjects.map(p => p.id === id ? { ...p, ...updated } : p));
      setEditingId(null);
    } catch (err) {
      console.error('Failed to rename project', err);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await literatureProjectsApi.delete(id);
      setLitProjects(litProjects.filter(p => p.id !== id));
      if (selectedLitProjectId === id) {
        selectLitProject(null);
        setLitPapers([]);
      }
    } catch (err) {
      console.error('Failed to delete project', err);
    }
  };

  return (
    <div className="sidebar-content">
      {litProjects.length === 0 ? (
        <div className="empty-state" style={{ padding: '1rem', fontSize: '0.85rem' }}>
          <p>No literature projects yet.</p>
          <button className="btn btn-primary btn-sm" onClick={() => setShowNewProject(true)}>
            Create Project
          </button>
        </div>
      ) : (
        <>
          {litProjects.map(project => (
            <div key={project.id}>
              {editingId === project.id ? (
                <div style={{ padding: '0.25rem 0.5rem' }}>
                  <input
                    autoFocus
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleRename(project.id); if (e.key === 'Escape') setEditingId(null); }}
                    onBlur={() => handleRename(project.id)}
                    style={{ width: '100%', padding: '0.25rem 0.375rem', fontSize: '0.8rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-text)' }}
                  />
                </div>
              ) : (
                <div
                  className={`lit-project-item ${selectedLitProjectId === project.id ? 'active' : ''}`}
                  onClick={() => handleSelect(project.id)}
                >
                  <span className="lit-project-name">{project.name}</span>
                  <button
                    className="btn btn-ghost btn-icon btn-xs"
                    title="Rename"
                    onClick={e => { e.stopPropagation(); setEditingId(project.id); setEditName(project.name); }}
                    style={{ opacity: 0.5, fontSize: '0.7rem', padding: '2px 4px' }}
                  ><RenameIcon size="sm" /></button>
                  <button
                    className="btn btn-ghost btn-icon btn-xs"
                    title="Delete"
                    onClick={e => { e.stopPropagation(); handleDelete(project.id); }}
                    style={{ opacity: 0.5, fontSize: '0.7rem', padding: '2px 4px', color: 'var(--color-danger)' }}
                  ><CloseIcon size="sm" /></button>
                </div>
              )}
            </div>
          ))}
        </>
      )}

      {showNewProject ? (
        <div style={{ padding: '0.5rem', borderTop: '1px solid var(--color-border)' }}>
          <input
            autoFocus
            placeholder="Project name"
            value={newProjectName}
            onChange={e => setNewProjectName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCreate()}
            style={{ width: '100%', padding: '0.375rem 0.5rem', fontSize: '0.85rem', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-sm)', background: 'var(--color-bg)', color: 'var(--color-text)', marginBottom: '0.375rem' }}
          />
          <div className="flex gap-1">
            <button className="btn btn-primary btn-sm" onClick={handleCreate}>Create</button>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowNewProject(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <div style={{ padding: '0.5rem' }}>
          <button className="btn btn-ghost btn-sm" style={{ width: '100%' }} onClick={() => setShowNewProject(true)}>
            + New Project
          </button>
        </div>
      )}
    </div>
  );
}
