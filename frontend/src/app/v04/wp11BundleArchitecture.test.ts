import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), 'utf8');
}

describe('WP-11 route chunk architecture', () => {
  it('keeps heavy legacy editors behind dynamic imports', () => {
    const app = source('../../App.tsx');
    for (const moduleName of [
      'PDFViewer',
      'NoteEditor',
      'LiteratureCanvas',
      'PaperWorkspace',
      'ReadingListsView',
      'ExportDialog',
    ]) {
      expect(app).toContain(`React.lazy(() => import('./components/`);
      expect(app).not.toMatch(new RegExp(`import\\s+${moduleName}\\s+from`));
    }
  });

  it('splits Study and Research surfaces without feature barrels', () => {
    const study = source('./studyRouter.tsx');
    const research = source('./researchRouter.tsx');
    expect(study).not.toContain("from '../../features/study'");
    expect(research).not.toContain("from '../../features/research'");
    // WP-11R2 adds the existing cognitive canvas as a
    // lazy Study surface; it remains the same shared
    // implementation used by Research.
    expect(study.match(/React\.lazy/g)?.length).toBe(4);
    // WP-11R2: the unified `Sources` surface is a
    // thin lazy wrapper that composes Library +
    // Discovery (both still lazy). The wrapper
    // itself is one more lazy chunk (11 total). v0.5 adds the
    // ResearchWorkbench as one more lazy chunk (12 total).
    expect(research.match(/React\.lazy/g)?.length).toBe(12);
  });

  it('does not reintroduce the App ↔ V04Shell cycle', () => {
    expect(source('./V04Shell.tsx')).not.toContain("from '../../App'");
  });
});
