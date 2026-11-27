/**
 * StudyKit v0.5 P7a — reads the old literature hub for the import
 * (ADR-004). Projects and papers come through the data gateway (local
 * or sync workspace); notes, highlights, relations and summary columns
 * live only on the hub's server, so they are offered in sync workspaces.
 */

import { getDataApi } from '../dataApi';
import { literatureCustomFieldsApi, literaturePapersApi, paperNotesApi, paperRelationsApi } from '../../lib/literature-api';
import type { LegacyLiteratureSource } from './importLegacyLiterature';

export function legacyLiteratureSource(): LegacyLiteratureSource {
  const api = getDataApi();
  const remote = api.supports('literaturePapers.crud');
  return {
    listProjects: () => api.literatureProjects.list(),
    listPapers: (projectId) => api.literaturePapers.list(projectId, 'library'),
    ...(remote
      ? {
          listNotes: (paperId: string) => paperNotesApi.list(paperId),
          listAnnotations: (paperId: string) => literaturePapersApi.listAnnotations(paperId),
          listRelations: (paperId: string) => paperRelationsApi.list(paperId),
          listCustomFields: (projectId: string) => literatureCustomFieldsApi.list(projectId),
        }
      : {}),
  };
}
