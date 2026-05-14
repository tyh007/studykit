import { create } from 'zustand';
import type {
  Module,
  Lecture,
  SourceDocument,
  SourcePage,
  NoteBlock,
  Annotation,
} from '../types';
import { db } from '../lib/db';

interface StudyKitState {
  // Workspace
  workspace_id: string | null;
  setWorkspaceId: (id: string | null) => void;

  // Modules
  modules: Module[];
  selectedModuleId: string | null;
  setModules: (modules: Module[]) => void;
  addModule: (mod: Module) => void;
  updateModule: (id: string, data: Partial<Module>) => void;
  removeModule: (id: string) => void;
  selectModule: (id: string | null) => void;

  // Lectures
  lectures: Lecture[];
  selectedLectureId: string | null;
  setLectures: (lectures: Lecture[]) => void;
  addLecture: (lecture: Lecture) => void;
  updateLecture: (id: string, data: Partial<Lecture>) => void;
  removeLecture: (id: string) => void;
  selectLecture: (id: string | null) => void;

  // Source Documents
  sourceDocuments: SourceDocument[];
  currentDocument: SourceDocument | null;
  currentPages: SourcePage[];
  setCurrentDocument: (doc: SourceDocument | null) => void;
  setCurrentPages: (pages: SourcePage[]) => void;
  selectedPageId: string | null;
  selectedPageIndex: number;
  selectPage: (pageId: string, index: number) => void;

  // Note Blocks
  noteBlocks: NoteBlock[];
  setNoteBlocks: (blocks: NoteBlock[]) => void;
  addNoteBlock: (block: NoteBlock) => void;
  updateNoteBlock: (id: string, data: Partial<NoteBlock>) => void;
  removeNoteBlock: (id: string) => void;

  // Annotations (session cache)
  annotations: Annotation[];
  setAnnotations: (annotations: Annotation[]) => void;
  addAnnotation: (annotation: Annotation) => void;
  updateAnnotation: (id: string, data: Partial<Annotation>) => void;
  removeAnnotation: (id: string) => void;

  // UI state
  sidebarOpen: boolean;
  toggleSidebar: () => void;
  cornellMode: boolean;
  setCornellMode: (mode: boolean) => void;
  currentLayout: 'slide_left_notes_right' | 'slide_top_notes_below';
  setCurrentLayout: (layout: 'slide_left_notes_right' | 'slide_top_notes_below') => void;
  zoom: number;
  setZoom: (zoom: number) => void;

  // Sync status
  syncStatus: 'synced' | 'pending' | 'error' | 'offline';
  setSyncStatus: (status: 'synced' | 'pending' | 'error' | 'offline') => void;

  // Device ID
  deviceId: string;
  getDeviceId: () => string;

  // Reset
  resetStore: () => void;
}

function generateDeviceId(): string {
  let stored = localStorage.getItem('studykit_device_id');
  if (!stored) {
    stored = crypto.randomUUID();
    localStorage.setItem('studykit_device_id', stored);
  }
  return stored;
}

export const useStore = create<StudyKitState>((set, get) => ({
  // Workspace
  workspace_id: null,
  setWorkspaceId: (id) => set({ workspace_id: id }),

  // Modules
  modules: [],
  selectedModuleId: null,
  setModules: (modules) => set({ modules }),
  addModule: (mod) => set((state) => ({ modules: [...state.modules, mod] })),
  updateModule: (id, data) =>
    set((state) => ({
      modules: state.modules.map((m) => (m.id === id ? { ...m, ...data } : m)),
    })),
  removeModule: (id) =>
    set((state) => ({
      modules: state.modules.filter((m) => m.id !== id),
      selectedModuleId: state.selectedModuleId === id ? null : state.selectedModuleId,
    })),
  selectModule: (id) => set({ selectedModuleId: id, selectedLectureId: null }),

  // Lectures
  lectures: [],
  selectedLectureId: null,
  setLectures: (lectures) => set({ lectures }),
  addLecture: (lecture) => set((state) => ({ lectures: [...state.lectures, lecture] })),
  updateLecture: (id, data) =>
    set((state) => ({
      lectures: state.lectures.map((l) => (l.id === id ? { ...l, ...data } : l)),
    })),
  removeLecture: (id) =>
    set((state) => ({
      lectures: state.lectures.filter((l) => l.id !== id),
      selectedLectureId: state.selectedLectureId === id ? null : state.selectedLectureId,
    })),
  selectLecture: (id) => set({ selectedLectureId: id, selectedPageId: null, selectedPageIndex: 0 }),

  // Source Documents
  sourceDocuments: [],
  currentDocument: null,
  currentPages: [],
  setCurrentDocument: (doc) => set({ currentDocument: doc }),
  setCurrentPages: (pages) => set({ currentPages: pages }),
  selectedPageId: null,
  selectedPageIndex: 0,
  selectPage: (pageId, index) => set({ selectedPageId: pageId, selectedPageIndex: index }),

  // Note Blocks
  noteBlocks: [],
  setNoteBlocks: (blocks) => set({ noteBlocks: blocks }),
  addNoteBlock: (block) => set((state) => ({ noteBlocks: [...state.noteBlocks, block] })),
  updateNoteBlock: (id, data) =>
    set((state) => ({
      noteBlocks: state.noteBlocks.map((b) => (b.id === id ? { ...b, ...data } : b)),
    })),
  removeNoteBlock: (id) =>
    set((state) => ({
      noteBlocks: state.noteBlocks.filter((b) => b.id !== id),
    })),

  // Annotations
  annotations: [],
  setAnnotations: (annotations) => set({ annotations }),
  addAnnotation: (annotation) => set((state) => ({ annotations: [...state.annotations, annotation] })),
  updateAnnotation: (id, data) =>
    set((state) => ({
      annotations: state.annotations.map((a) => (a.id === id ? { ...a, ...data } : a)),
    })),
  removeAnnotation: (id) =>
    set((state) => ({
      annotations: state.annotations.filter((a) => a.id !== id),
    })),

  // UI
  sidebarOpen: true,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  cornellMode: false,
  setCornellMode: (mode) => set({ cornellMode: mode }),
  currentLayout: 'slide_left_notes_right',
  setCurrentLayout: (layout) => set({ currentLayout: layout }),
  zoom: 100,
  setZoom: (zoom) => set({ zoom: Math.max(25, Math.min(200, zoom)) }),

  // Sync
  syncStatus: 'offline',
  setSyncStatus: (status) => set({ syncStatus: status }),

  // Device
  deviceId: generateDeviceId(),
  getDeviceId: () => get().deviceId,

  // Reset
  resetStore: () => set({
    workspace_id: null,
    modules: [],
    selectedModuleId: null,
    lectures: [],
    selectedLectureId: null,
    sourceDocuments: [],
    currentDocument: null,
    currentPages: [],
    selectedPageId: null,
    selectedPageIndex: 0,
    noteBlocks: [],
    annotations: [],
    sidebarOpen: true,
    cornellMode: false,
    currentLayout: 'slide_left_notes_right',
    zoom: 100,
    syncStatus: 'offline',
    deviceId: generateDeviceId(),
  }),
}));
