import type { Lecture, LiteraturePaper, LiteratureProject, Module, SourceDocument, SourcePage } from '../../types';
import type { WebPort } from '../web';
import {
  deleteDomainRecord,
  DesktopDomainRecordStore,
  putDomainRecord,
} from './domainRecordStore';

function values<T>(rows: Awaited<ReturnType<DesktopDomainRecordStore['read']>>, kind: string): T[] {
  return rows.filter((row) => row.entityType === kind).map((row) => row.value as T);
}

export function createDesktopLegacyPort(store: DesktopDomainRecordStore): WebPort {
  const read = () => store.read('legacy');
  return {
    modules: {
      list: async () => values<Module>(await read(), 'module'),
      get: async (id) => values<Module>(await read(), 'module').find((row) => row.id === id),
      put: async (row) => store.transact([putDomainRecord('legacy', 'module', row as unknown as Record<string, unknown>)]),
      delete: async (id) => store.transact([deleteDomainRecord('legacy', 'module', id)]),
    },
    lectures: {
      listByModule: async (moduleId) =>
        values<Lecture>(await read(), 'lecture').filter((row) => row.module_id === moduleId),
      get: async (id) => values<Lecture>(await read(), 'lecture').find((row) => row.id === id),
      put: async (row) => store.transact([putDomainRecord('legacy', 'lecture', row as unknown as Record<string, unknown>)]),
      delete: async (id) => store.transact([deleteDomainRecord('legacy', 'lecture', id)]),
    },
    literatureProjects: {
      list: async () => values<LiteratureProject>(await read(), 'literature_project'),
      get: async (id) =>
        values<LiteratureProject>(await read(), 'literature_project').find((row) => row.id === id),
      put: async (row) => store.transact([putDomainRecord('legacy', 'literature_project', row as unknown as Record<string, unknown>)]),
      delete: async (id) => store.transact([deleteDomainRecord('legacy', 'literature_project', id)]),
    },
    literaturePapers: {
      listByProject: async (projectId) =>
        values<LiteraturePaper>(await read(), 'literature_paper').filter(
          (row) => row.project_id === projectId,
        ),
    },
    sourceDocuments: {
      get: async (id) =>
        values<SourceDocument>(await read(), 'source_document').find((row) => row.id === id),
      getPages: async (id) =>
        values<SourcePage>(await read(), 'source_page')
          .filter((row) => row.source_document_id === id)
          .sort((a, b) => a.page_number - b.page_number),
      putWithPages: async (document, pages) =>
        store.transact([
          putDomainRecord('legacy', 'source_document', document as unknown as Record<string, unknown>),
          ...pages.map((page) =>
            putDomainRecord('legacy', 'source_page', page as unknown as Record<string, unknown>),
          ),
        ]),
      deleteWithPages: async (id) => {
        const pages = values<SourcePage>(await read(), 'source_page').filter(
          (row) => row.source_document_id === id,
        );
        await store.transact([
          ...pages.map((page) => deleteDomainRecord('legacy', 'source_page', page.id)),
          deleteDomainRecord('legacy', 'source_document', id),
        ]);
      },
    },
  };
}
