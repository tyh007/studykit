import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import CanvasToolbar from './CanvasToolbar';

const handlers = {
  onImportPapers: vi.fn(),
  onUploadPDF: vi.fn(),
  onAddText: vi.fn(),
  onAddNote: vi.fn(),
  onAddQuestion: vi.fn(),
  onAddShape: vi.fn(),
  onAddGroup: vi.fn(),
  onConnectorMode: vi.fn(),
  onFitView: vi.fn(),
};

describe('CanvasToolbar', () => {
  it('disables every canvas action while the canvas is not ready', () => {
    render(<CanvasToolbar {...handlers} disabled />);

    for (const name of [
      'Add project papers to canvas',
      'Upload PDF to canvas',
      'Add text card',
      'Add sticky note',
      'Add question card',
      'Add selectable shape',
      'Add group frame',
      'Connector tool',
      'Fit to content',
    ]) {
      expect(screen.getByRole('button', { name })).toBeDisabled();
    }
  });
});
