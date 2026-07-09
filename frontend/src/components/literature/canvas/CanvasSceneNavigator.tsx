import React, { useState } from 'react';
import type { LiteratureCanvasScene } from '../../../types';
import { AddIcon, CloseIcon, ExportIcon, RenameIcon } from '../../ui/Icons';

interface Props {
  scenes: LiteratureCanvasScene[];
  disabled?: boolean;
  onAddScene: (name: string) => Promise<unknown> | unknown;
  onGoToScene: (scene: LiteratureCanvasScene) => void;
  onRenameScene: (sceneId: string, name: string) => Promise<unknown> | unknown;
  onReplaceScene: (sceneId: string) => Promise<unknown> | unknown;
  onDeleteScene: (sceneId: string) => void;
}

export default function CanvasSceneNavigator({
  scenes,
  disabled,
  onAddScene,
  onGoToScene,
  onRenameScene,
  onReplaceScene,
  onDeleteScene,
}: Props) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const submitScene = async () => {
    const clean = name.trim();
    if (!clean) return;
    await onAddScene(clean);
    setName('');
    setOpen(true);
  };

  return (
    <div className="canvas-scenes">
      <button
        type="button"
        className="canvas-scenes-toggle"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        aria-expanded={open}
        aria-controls="canvas-scenes-panel"
        title="Scenes"
      >
        Scenes
        <span>{scenes.length}</span>
      </button>
      {open && (
        <div id="canvas-scenes-panel" className="canvas-scenes-panel" role="dialog" aria-label="Canvas scenes">
          <div className="canvas-scenes-create">
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitScene();
                if (event.key === 'Escape') setOpen(false);
              }}
              placeholder="Scene name"
              aria-label="New scene name"
            />
            <button
              type="button"
              className="canvas-small-icon-btn"
              onClick={submitScene}
              disabled={!name.trim()}
              title="Save current view as scene"
              aria-label="Save current view as scene"
            >
              <AddIcon size="sm" />
            </button>
          </div>
          <div className="canvas-scenes-list">
            {scenes.length === 0 ? (
              <div className="canvas-scenes-empty">No scenes saved</div>
            ) : (
              scenes.map((scene) => (
                <div key={scene.id} className="canvas-scene-row">
                  {editingId === scene.id ? (
                    <input
                      value={draftName}
                      onChange={(event) => setDraftName(event.target.value)}
                      onBlur={() => {
                        const clean = draftName.trim();
                        if (clean) onRenameScene(scene.id, clean);
                        setEditingId(null);
                      }}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          const clean = draftName.trim();
                          if (clean) onRenameScene(scene.id, clean);
                          setEditingId(null);
                        }
                        if (event.key === 'Escape') setEditingId(null);
                      }}
                      autoFocus
                      aria-label="Rename scene"
                    />
                  ) : (
                    <button
                      type="button"
                      className="canvas-scene-name"
                      onClick={() => onGoToScene(scene)}
                    >
                      {scene.name}
                    </button>
                  )}
                  <button
                    type="button"
                    className="canvas-small-icon-btn"
                    onClick={() => onReplaceScene(scene.id)}
                    title="Replace with current view"
                    aria-label={`Replace ${scene.name} with current view`}
                  >
                    <ExportIcon size="sm" />
                  </button>
                  <button
                    type="button"
                    className="canvas-small-icon-btn"
                    onClick={() => {
                      setEditingId(scene.id);
                      setDraftName(scene.name);
                    }}
                    title="Rename scene"
                    aria-label={`Rename ${scene.name}`}
                  >
                    <RenameIcon size="sm" />
                  </button>
                  <button
                    type="button"
                    className="canvas-small-icon-btn"
                    onClick={() => onDeleteScene(scene.id)}
                    title="Delete scene"
                    aria-label={`Delete ${scene.name}`}
                  >
                    <CloseIcon size="sm" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
