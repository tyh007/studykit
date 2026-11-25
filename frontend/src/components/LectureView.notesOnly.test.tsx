import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import type { Lecture, SourceDocument } from '../types';

const supports = vi.hoisted(() => ({ upload: false }));

vi.mock('./NoteEditor', () => ({
  default: ({ lectureId }: { lectureId: string }) => (
    <div data-testid="note-editor-stub">notes for {lectureId}</div>
  ),
}));
vi.mock('./LectureCaptureTrigger', () => ({ LectureCaptureTrigger: () => null }));
vi.mock('./PDFViewer', () => ({ default: () => <div data-testid="pdf-viewer-stub" /> }));
vi.mock('../application/dataApi', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    useSupports: (capability: string) =>
      capability === 'sourceDocuments.upload' ? supports.upload : false,
  };
});

import { LectureView } from '../App';

const lecture: Lecture = {
  id: 'lec-1',
  module_id: 'mod-1',
  title: 'Blank notes · 2026-11-25',
  sort_order: 0,
  settings_json: {} as Lecture['settings_json'],
  created_at: '2026-11-25T00:00:00.000Z',
  updated_at: '2026-11-25T00:00:00.000Z',
};

function doc(status: SourceDocument['processing_status']): SourceDocument {
  return {
    id: 'doc-1',
    lecture_id: 'lec-1',
    type: 'pdf',
    original_filename: 'slides.pdf',
    storage_key: 'k',
    mime_type: 'application/pdf',
    file_size_bytes: 1,
    processing_status: status,
    created_at: '2026-11-25T00:00:00.000Z',
    updated_at: '2026-11-25T00:00:00.000Z',
  };
}

function renderLecture(document: SourceDocument | null) {
  return render(
    <React.Suspense fallback={null}>
      <LectureView lecture={lecture} document={document} pages={[]} currentPageIndex={0} courseId="mod-1" />
    </React.Suspense>,
  );
}

afterEach(() => {
  cleanup();
  supports.upload = false;
});

describe('LectureView without slides', () => {
  it('opens the note editor for a lecture with no PDF instead of an upload-only dead end', async () => {
    renderLecture(null);
    expect(await screen.findByTestId('note-editor-stub')).toHaveTextContent('notes for lec-1');
    expect(screen.getByTestId('lecture-notes-only')).toBeInTheDocument();
    expect(screen.queryByText('Upload PDF Slides')).not.toBeInTheDocument();
  });

  it('does not offer a slide upload the workspace cannot perform', async () => {
    renderLecture(null);
    await screen.findByTestId('note-editor-stub');
    expect(screen.getByRole('status')).toHaveTextContent(/notes only/i);
    expect(screen.queryByText(/Attach slides/i)).not.toBeInTheDocument();
  });

  it('offers to attach slides alongside the notes when upload is supported', async () => {
    supports.upload = true;
    renderLecture(null);
    await screen.findByTestId('note-editor-stub');
    expect(screen.getByText('Attach slides (PDF)')).toBeInTheDocument();
  });

  it('keeps notes usable while slides are still processing', async () => {
    supports.upload = true;
    renderLecture(doc('processing'));
    expect(await screen.findByTestId('note-editor-stub')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/Processing slides/);
    expect(screen.queryByText(/Attach/)).not.toBeInTheDocument();
  });
});
