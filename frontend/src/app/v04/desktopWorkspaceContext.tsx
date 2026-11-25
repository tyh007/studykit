import React from 'react';
import { workspaceFlavour } from '../../application/workspaceFlavour';
import { resetLocalDataPort, setLocalDataPort } from '../../application/dataGateway';
import { makeAppLocation } from '../../domain/workspace';
import type { StudyKitRepository } from '../../domain/repository';
import type { StudyRepository } from '../../application/study/studyRepository';
import type { ResearchRepository } from '../../application/research/researchRepository';
import type { CanvasRepository } from '../../repositories/canvas';
import {
  createSqliteCanvasRepository,
  createSqliteResearchRepository,
  createSqliteStudyRepository,
  createDesktopSqliteRepository,
  createDesktopLegacyPort,
  createDesktopSourceAssetBridge,
  createTauriWorkspaceClient,
  DesktopDomainRecordStore,
  type OpenWorkspaceSummary,
  type WorkspaceClient,
  type WorkspaceHealth,
  type BackupSummary,
  type GlobalShortcutStatus,
  type LegacyMigrationPreview,
  type LocalAiChatResponse,
  type LocalAiDiscovery,
  type LocalAiMessage,
  type MigrationSummary,
  type QuickCapture,
  inspectLegacyData,
  migrateLegacyData as runLegacyMigration,
  WorkspaceIpcError,
} from '../../platforms/desktop';
import { isDesktopRuntime } from '../../platforms/runtime';
import { locationStore } from './locationStore';

export type DesktopWorkspaceState =
  | { readonly kind: 'web' }
  | { readonly kind: 'restoring' }
  | { readonly kind: 'needs_workspace'; readonly message?: string }
  | { readonly kind: 'choosing'; readonly operation: 'create' | 'open' }
  | {
      readonly kind: 'ready';
      readonly summary: OpenWorkspaceSummary;
      readonly health: WorkspaceHealth;
      readonly repository: StudyKitRepository;
      readonly sourceAssets: import('../../application/assets/sourceAssetBridge').SourceAssetBridge;
      readonly repositories: {
        readonly objects: StudyKitRepository;
        readonly study: StudyRepository;
        readonly research: ResearchRepository;
        readonly canvas: CanvasRepository;
      };
      readonly actionError?: string;
    }
  | {
      readonly kind: 'error';
      readonly message: string;
      readonly errorKind?: string;
    };

export interface DesktopWorkspaceContextValue {
  readonly enabled: boolean;
  readonly state: DesktopWorkspaceState;
  createWorkspace(displayName: string): Promise<void>;
  openWorkspace(): Promise<void>;
  switchWorkspace(): Promise<void>;
  retryRestore(): Promise<void>;
  clearError(): void;
  readonly system: DesktopSystemState;
  migrateLegacyData(): Promise<void>;
  rollbackLegacyMigration(): Promise<void>;
  createBackup(): Promise<void>;
  listQuickCaptures(): Promise<ReadonlyArray<QuickCapture>>;
  saveQuickCapture(body: string): Promise<QuickCapture>;
  archiveQuickCapture(id: string): Promise<void>;
  localAiChat(messages: ReadonlyArray<LocalAiMessage>, model?: string): Promise<LocalAiChatResponse>;
}

interface DesktopSystemState {
  readonly legacy: LegacyMigrationPreview | null;
  readonly migration: MigrationSummary | null;
  readonly localAi: LocalAiDiscovery | null;
  readonly shortcut: GlobalShortcutStatus | null;
  readonly lastBackup: BackupSummary | null;
}

const emptySystem: DesktopSystemState = {
  legacy: null,
  migration: null,
  localAi: null,
  shortcut: null,
  lastBackup: null,
};

const webValue: DesktopWorkspaceContextValue = {
  enabled: false,
  state: { kind: 'web' },
  createWorkspace: async () => {},
  openWorkspace: async () => {},
  switchWorkspace: async () => {},
  retryRestore: async () => {},
  clearError: () => {},
  system: emptySystem,
  migrateLegacyData: async () => {},
  rollbackLegacyMigration: async () => {},
  createBackup: async () => {},
  listQuickCaptures: async () => [],
  saveQuickCapture: async () => { throw new Error('Desktop workspace is unavailable.'); },
  archiveQuickCapture: async () => {},
  localAiChat: async () => { throw new Error('Local AI is unavailable.'); },
};

const DesktopWorkspaceContext =
  React.createContext<DesktopWorkspaceContextValue>(webValue);

export interface DesktopWorkspaceProviderProps {
  readonly children: React.ReactNode;
  /** Test seam. Production leaves this undefined. */
  readonly runtime?: 'web' | 'desktop';
  /** Test seam. Production leaves this undefined. */
  readonly client?: WorkspaceClient;
}

function userMessage(error: unknown): string {
  if (!(error instanceof WorkspaceIpcError)) {
    return `The workspace could not be opened: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }
  switch (error.kind) {
    case 'STUDYKIT_NOT_A_WORKSPACE':
      return 'This folder is not a StudyKit workspace.';
    case 'STUDYKIT_FORMAT_TOO_NEW':
      return 'This workspace was created by a newer version of StudyKit.';
    case 'STUDYKIT_MANIFEST_CORRUPT':
      return 'The workspace information is damaged. Choose another workspace or restore a backup.';
    case 'STUDYKIT_DB_UNUSABLE':
      return 'The workspace database could not be opened. Check the folder permissions or restore a backup.';
    case 'STUDYKIT_CREATION_FAILED':
      return 'StudyKit could not create the workspace in that folder.';
    case 'STUDYKIT_ANOTHER_OPEN':
      return 'Another workspace operation is already in progress.';
    default:
      return `The workspace could not be opened (${error.kind}): ${error.detail.message}`;
  }
}

function isPickerCancellation(error: unknown): boolean {
  return (
    error instanceof WorkspaceIpcError &&
    error.kind === 'STUDYKIT_PATH_REJECTED' &&
    error.detail.message.toLowerCase().includes('cancel')
  );
}

export function DesktopWorkspaceProvider(
  props: DesktopWorkspaceProviderProps,
): React.ReactElement {
  const enabled = props.runtime
    ? props.runtime === 'desktop'
    : isDesktopRuntime();
  const clientRef = React.useRef<WorkspaceClient | null>(null);
  if (enabled && clientRef.current === null) {
    clientRef.current = props.client ?? createTauriWorkspaceClient();
  }
  const [state, setState] = React.useState<DesktopWorkspaceState>(
    enabled ? { kind: 'restoring' } : { kind: 'web' },
  );
  const [system, setSystem] = React.useState<DesktopSystemState>(emptySystem);
  const mountedRef = React.useRef(true);
  const bootstrapRef = React.useRef<Promise<void> | null>(null);
  const operationRef = React.useRef(0);
  const busyRef = React.useRef(false);

  React.useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const enterReady = React.useCallback(
    async (summary: OpenWorkspaceSummary, operation: number): Promise<void> => {
      const client = clientRef.current;
      if (!client) return;
      let health: WorkspaceHealth;
      try {
        health = await client.getWorkspaceHealth();
      } catch (healthError) {
        try {
          await client.closeWorkspace();
        } catch (closeError) {
          throw new WorkspaceIpcError({
            kind: 'STUDYKIT_DB_UNUSABLE',
            message: `workspace health failed and the workspace could not be closed: ${
              closeError instanceof Error ? closeError.message : String(closeError)
            }`,
          });
        }
        throw healthError;
      }
      if (!mountedRef.current || operation !== operationRef.current) return;
      const repository = createDesktopSqliteRepository({
        client,
        initialSummary: summary,
      });
      const domainStore = new DesktopDomainRecordStore(client);
      const repositories = {
        objects: repository,
        study: createSqliteStudyRepository(domainStore),
        research: createSqliteResearchRepository(domainStore),
        canvas: createSqliteCanvasRepository(domainStore),
      };
      setLocalDataPort(createDesktopLegacyPort(domainStore));
      workspaceFlavour.openLocal();
      locationStore.replace(
        makeAppLocation({ mode: 'study', surface: 'study-home' }),
      );
      setState({
        kind: 'ready',
        summary,
        health,
        repository,
        sourceAssets: createDesktopSourceAssetBridge(client),
        repositories,
      });
      void Promise.all([
        inspectLegacyData().catch(() => null),
        client.getLatestLegacyMigration?.().catch(() => null) ?? Promise.resolve(null),
        client.discoverLocalAi?.().catch(() => null) ?? Promise.resolve(null),
        client.getGlobalShortcutStatus?.().catch(() => null) ?? Promise.resolve(null),
      ]).then(([legacy, migration, localAi, shortcut]) => {
        if (mountedRef.current && operation === operationRef.current) {
          setSystem((current) => ({ ...current, legacy, migration, localAi, shortcut }));
        }
      });
    },
    [],
  );

  const restore = React.useCallback(async (): Promise<void> => {
    if (!enabled || !clientRef.current) return;
    const operation = ++operationRef.current;
    setState({ kind: 'restoring' });
    try {
      const summary = await clientRef.current.reopenLastWorkspace();
      await enterReady(summary, operation);
    } catch (error) {
      if (!mountedRef.current || operation !== operationRef.current) return;
      if (
        error instanceof WorkspaceIpcError &&
        error.kind === 'STUDYKIT_NO_LAST_WORKSPACE'
      ) {
        setState({ kind: 'needs_workspace' });
      } else {
        setState({
          kind: 'error',
          message: userMessage(error),
          errorKind:
            error instanceof WorkspaceIpcError ? error.kind : undefined,
        });
      }
    }
  }, [enabled, enterReady]);

  React.useEffect(() => {
    if (!enabled) return;
    if (bootstrapRef.current === null) {
      bootstrapRef.current = restore();
    }
    void bootstrapRef.current;
  }, [enabled, restore]);

  const runChooser = React.useCallback(
    async (
      operationKind: 'create' | 'open',
      invoke: (client: WorkspaceClient) => Promise<OpenWorkspaceSummary>,
    ): Promise<void> => {
      const client = clientRef.current;
      if (!enabled || !client || busyRef.current) return;
      busyRef.current = true;
      const operation = ++operationRef.current;
      setState({ kind: 'choosing', operation: operationKind });
      try {
        const summary = await invoke(client);
        await enterReady(summary, operation);
      } catch (error) {
        if (!mountedRef.current || operation !== operationRef.current) return;
        if (isPickerCancellation(error)) {
          setState({ kind: 'needs_workspace' });
        } else {
          setState({
            kind: 'error',
            message: userMessage(error),
            errorKind:
              error instanceof WorkspaceIpcError ? error.kind : undefined,
          });
        }
      } finally {
        if (operation === operationRef.current) busyRef.current = false;
      }
    },
    [enabled, enterReady],
  );

  const value = React.useMemo<DesktopWorkspaceContextValue>(
    () => ({
      enabled,
      state,
      async createWorkspace(displayName) {
        const name = displayName.trim();
        if (!name) {
          setState({
            kind: 'needs_workspace',
            message: 'Enter a workspace name.',
          });
          return;
        }
        await runChooser('create', (client) =>
          client.chooseAndCreateWorkspace(name),
        );
      },
      async openWorkspace() {
        await runChooser('open', (client) =>
          client.chooseAndOpenWorkspace(),
        );
      },
      async switchWorkspace() {
        if (!enabled || !clientRef.current || state.kind !== 'ready' || busyRef.current) {
          return;
        }
        busyRef.current = true;
        const operation = ++operationRef.current;
        try {
          await clientRef.current.closeWorkspace();
          if (!mountedRef.current || operation !== operationRef.current) return;
          workspaceFlavour.signOut();
          resetLocalDataPort();
          setSystem(emptySystem);
          setState({ kind: 'needs_workspace' });
        } catch (error) {
          if (!mountedRef.current || operation !== operationRef.current) return;
          setState({
            ...state,
            actionError: userMessage(error),
          });
        } finally {
          if (operation === operationRef.current) busyRef.current = false;
        }
      },
      async retryRestore() {
        if (busyRef.current) return;
        busyRef.current = true;
        try {
          bootstrapRef.current = restore();
          await bootstrapRef.current;
        } finally {
          busyRef.current = false;
        }
      },
      clearError() {
        if (state.kind === 'error') setState({ kind: 'needs_workspace' });
        if (state.kind === 'needs_workspace' && state.message) {
          setState({ kind: 'needs_workspace' });
        }
      },
      system,
      async migrateLegacyData() {
        const client = clientRef.current;
        if (!client || state.kind !== 'ready') return;
        const migration = await runLegacyMigration(client);
        setLocalDataPort(createDesktopLegacyPort(new DesktopDomainRecordStore(client)));
        setSystem((current) => ({ ...current, migration, legacy: { count: 0, tableCounts: {} } }));
      },
      async rollbackLegacyMigration() {
        const client = clientRef.current;
        const runId = system.migration?.run_id;
        if (!client?.rollbackLegacyMigration || !runId) return;
        const migration = await client.rollbackLegacyMigration(runId);
        setSystem((current) => ({ ...current, migration }));
      },
      async createBackup() {
        const client = clientRef.current;
        if (!client?.createWorkspaceBackup) return;
        const lastBackup = await client.createWorkspaceBackup();
        setSystem((current) => ({ ...current, lastBackup }));
      },
      async listQuickCaptures() {
        return (await clientRef.current?.listQuickCaptures?.()) ?? [];
      },
      async saveQuickCapture(body) {
        const save = clientRef.current?.saveQuickCapture;
        if (!save) throw new Error('Quick Capture is unavailable.');
        return save(body, 'text');
      },
      async archiveQuickCapture(id) {
        await clientRef.current?.archiveQuickCapture?.(id);
      },
      async localAiChat(messages, model) {
        const client = clientRef.current;
        const chosen = model ?? system.localAi?.models[0];
        if (!client?.localAiChat || !chosen) throw new Error('No local Ollama model is available.');
        return client.localAiChat(chosen, messages);
      },
    }),
    [enabled, restore, runChooser, state, system],
  );

  return (
    <DesktopWorkspaceContext.Provider value={value}>
      {props.children}
    </DesktopWorkspaceContext.Provider>
  );
}

export function useDesktopWorkspace(): DesktopWorkspaceContextValue {
  return React.useContext(DesktopWorkspaceContext);
}
