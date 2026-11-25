import React from 'react';
import { makeAppLocation, type AppLocation, type ContainerRef } from '../../domain/workspace';
import { useResearchDepsOptional } from '../../features/research/researchContext';
import { useStudyDepsOptional } from '../../features/study/studyContext';
import { locationStore, useLocation } from './locationStore';

interface NavItem {
  readonly label: string;
  readonly location: AppLocation;
  readonly matches: (location: AppLocation) => boolean;
  readonly testId: string;
}

function scopedLocation(
  mode: 'study' | 'research',
  surface: AppLocation['surface'],
  container: ContainerRef,
  params?: Readonly<Record<string, string>>,
): AppLocation {
  return makeAppLocation({ mode, surface, container, ...(params ? { params } : {}) });
}

/** The sidebar switches context; creation stays in the active workspace. */
export function WorkspaceSidebar(): React.ReactElement {
  const location = useLocation();
  const study = useStudyDepsOptional();
  const research = useResearchDepsOptional();
  const [reviewAvailable, setReviewAvailable] = React.useState(false);
  const [firstOutputId, setFirstOutputId] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      if (!study || location.mode !== 'study' || location.container?.kind !== 'course') {
        if (!cancelled) setReviewAvailable(false);
        return;
      }
      const rows = await study.repository.listQuestions({ containerId: location.container.id });
      if (!cancelled) {
        setReviewAvailable(rows.some((row) => row.review !== 'understood' && row.status !== 'reviewed'));
      }
    };
    void refresh();
    const off = study?.repository.subscribe(() => void refresh()) ?? (() => undefined);
    return () => { cancelled = true; off(); };
  }, [location.container, location.mode, study]);

  React.useEffect(() => {
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      if (!research || location.mode !== 'research' || location.container?.kind !== 'project') {
        if (!cancelled) setFirstOutputId(null);
        return;
      }
      const rows = await research.repository.listOutputs({ projectId: location.container.id });
      if (!cancelled) setFirstOutputId(rows[0]?.id ?? null);
    };
    void refresh();
    const off = research?.repository.subscribe(() => void refresh()) ?? (() => undefined);
    return () => { cancelled = true; off(); };
  }, [location.container, location.mode, research]);

  const items = React.useMemo<readonly NavItem[]>(() => {
    const homeSurface = location.mode === 'study' ? 'study-home' : 'research-home';
    const home: NavItem = {
      label: 'Home',
      location: makeAppLocation({ mode: location.mode, surface: homeSurface }),
      matches: (current) => current.surface === homeSurface,
      testId: 'v04-sidebar-home',
    };
    if (!location.container) return [home];

    if (location.mode === 'study') {
      const container = location.container;
      return [
        home,
        {
          label: 'Course',
          location: scopedLocation('study', 'course', container),
          matches: (current) => current.surface === 'course' || current.surface === 'lecture',
          testId: 'v04-sidebar-course',
        },
        {
          label: 'Canvas',
          location: scopedLocation('study', 'study-canvas', container),
          matches: (current) => current.surface === 'study-canvas',
          testId: 'v04-sidebar-canvas',
        },
        ...(reviewAvailable ? [{
          label: 'Review',
          location: scopedLocation('study', 'review', container, { containerId: container.id }),
          matches: (current: AppLocation) => current.surface === 'review',
          testId: 'v04-sidebar-review',
        }] : []),
      ];
    }

    const container = location.container;
    return [
      home,
      {
        label: 'Project',
        location: scopedLocation('research', 'project', container),
        matches: (current) => current.surface === 'project',
        testId: 'v04-sidebar-project',
      },
      {
        label: 'Sources',
        location: scopedLocation('research', 'library', container, { view: 'library' }),
        matches: (current) => current.surface === 'library' || (current.surface === 'reader' && current.params?.view !== 'discovery'),
        testId: 'v04-sidebar-sources',
      },
      {
        label: 'Canvas',
        location: scopedLocation('research', 'cognitive-canvas', container),
        matches: (current) => current.surface === 'cognitive-canvas',
        testId: 'v04-sidebar-canvas',
      },
      ...(firstOutputId ? [{
        label: 'Output',
        location: makeAppLocation({ mode: 'research', surface: 'output', surfaceId: firstOutputId, container }),
        matches: (current: AppLocation) => current.surface === 'output',
        testId: 'v04-sidebar-output',
      }] : []),
    ];
  }, [firstOutputId, location.container, location.mode, reviewAvailable]);

  return (
    <aside
      className="v04-workspace-sidebar"
      aria-label={`${location.mode === 'study' ? 'Study' : 'Research'} navigation`}
      data-testid="v04-workspace-sidebar"
    >
      <div className="v04-workspace-sidebar-heading">
        <span>{location.mode === 'study' ? 'Study' : 'Research'}</span>
        <small>{location.container ? (location.mode === 'study' ? 'Current course' : 'Current project') : 'Workspace'}</small>
      </div>
      <nav className="v04-workspace-nav" aria-label="Current mode">
        {items.map((item) => {
          const active = item.matches(location);
          return (
            <button
              key={`${item.label}-${item.location.surface}`}
              type="button"
              className={`v04-workspace-nav-item${active ? ' is-active' : ''}`}
              aria-current={active ? 'page' : undefined}
              onClick={() => locationStore.push(item.location)}
              data-testid={item.testId}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
}
