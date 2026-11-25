declare module '@citation-js/core' {
  export class Cite {
    constructor(data?: unknown);
    format(kind: string, options?: Record<string, unknown>): string;
  }
  export const plugins: {
    config: {
      get(name: string): {
        styles?: { add(name: string, xml: string): void };
        templates?: { add(name: string, xml: string): void };
      };
    };
  };
}

declare module '@citation-js/plugin-csl';
declare module '@citation-js/plugin-bibtex';
declare module '@citation-js/plugin-ris';

declare module '@citation/csl-style-modern-language-association' {
  interface CslStyleInfo {
    readonly content: string;
    readonly short_id: string;
    readonly title: string;
  }
  const value: CslStyleInfo | { readonly default: CslStyleInfo };
  export default value;
}

declare module '@citation/csl-style-chicago-author-date' {
  interface CslStyleInfo {
    readonly content: string;
    readonly short_id: string;
    readonly title: string;
  }
  const value: CslStyleInfo | { readonly default: CslStyleInfo };
  export default value;
}
