import React, { useMemo, useState } from 'react';
import { CloseIcon, SearchIcon } from '../../ui/Icons';
import type { CanvasFlowNode } from './canvas-types';

export interface CanvasSearchResult {
  id: string;
  type: string;
  title: string;
  detail: string;
}

function normalize(value: unknown): string {
  return String(value ?? '').toLowerCase();
}

export function buildCanvasSearchResults(
  nodes: CanvasFlowNode[],
  query: string
): CanvasSearchResult[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  return nodes
    .map((node) => {
      const paper = node.data.paper;
      const content = node.data.canvasNode.content_json || {};
      const title =
        paper?.title ||
        paper?.file_name ||
        (content.prompt as string) ||
        (content.label as string) ||
        (content.text as string) ||
        `${node.type || 'Node'} ${node.id.slice(0, 6)}`;
      const detail = [
        paper?.authors,
        paper?.year,
        content.text,
        content.prompt,
        Array.isArray(content.sources) ? content.sources.join(' ') : '',
      ]
        .filter(Boolean)
        .join(' ');
      return {
        id: node.id,
        type: String(node.type || 'node'),
        title,
        detail,
        haystack: normalize(`${title} ${detail}`),
      };
    })
    .filter((item) => item.haystack.includes(needle))
    .slice(0, 8)
    .map(({ haystack: _haystack, ...item }) => item);
}

interface Props {
  nodes: CanvasFlowNode[];
  disabled?: boolean;
  onFocusNode: (nodeId: string) => void;
}

export default function CanvasSearch({ nodes, disabled, onFocusNode }: Props) {
  const [query, setQuery] = useState('');
  const results = useMemo(() => buildCanvasSearchResults(nodes, query), [nodes, query]);

  return (
    <div className="canvas-search" role="search" aria-label="Search canvas">
      <SearchIcon size="sm" />
      <input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Search canvas"
        disabled={disabled}
        aria-label="Search canvas nodes"
      />
      {query && (
        <button
          type="button"
          className="canvas-search-clear"
          onClick={() => setQuery('')}
          aria-label="Clear canvas search"
          title="Clear search"
        >
          <CloseIcon size="sm" />
        </button>
      )}
      {query && (
        <div className="canvas-search-results" role="listbox" aria-label="Canvas search results">
          {results.length === 0 ? (
            <div className="canvas-search-empty">No matches</div>
          ) : (
            results.map((result) => (
              <button
                type="button"
                key={result.id}
                className="canvas-search-result"
                onClick={() => {
                  onFocusNode(result.id);
                  setQuery('');
                }}
                role="option"
              >
                <span className="canvas-search-result-title">{result.title}</span>
                <span className="canvas-search-result-meta">
                  {result.type}
                  {result.detail ? ` · ${result.detail.slice(0, 80)}` : ''}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
