import type { ExtractedData } from '../../types';

export type { ExtractedData };

export interface CustomFieldDefinition {
  id: string;
  name: string;
  description: string;
  prompt: string;
}
