import React from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';
import katex from 'katex';

/**
 * Tiptap Equation Node
 *
 * Renders LaTeX equations using KaTeX.
 * Stores raw LaTeX in the node attributes so it survives even if rendering fails (per PRD TECH-003-D).
 *
 * Inline usage: $$equation$$ or block: \[equation\]
 */

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    equation: {
      /**
       * Insert an equation block
       */
      insertEquation: (latex: string) => ReturnType;
    };
  }
}

export const Equation = Node.create({
  name: 'equation',

  group: 'block',

  atom: true,

  draggable: true,

  addAttributes() {
    return {
      latex: {
        default: '',
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-latex') || '',
        renderHTML: (attrs) => ({ 'data-latex': attrs.latex }),
      },
      display: {
        default: true,
        parseHTML: (el) => (el as HTMLElement).getAttribute('data-display') !== 'false',
        renderHTML: (attrs) => ({ 'data-display': attrs.display ? 'true' : 'false' }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-equation]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-equation': '' }), 0];
  },

  addNodeView() {
    return ReactNodeViewRenderer(EquationNodeView);
  },

  addCommands() {
    return {
      insertEquation:
        (latex: string) =>
        ({ commands }) => {
          return commands.insertContent({
            type: this.name,
            attrs: { latex, display: true },
          });
        },
    };
  },
});

// ===== React Node View =====

function EquationNodeView(props: NodeViewProps) {
  const { node, selected } = props;
  const latex = node.attrs.latex as string;
  const display = node.attrs.display as boolean;
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [renderError, setRenderError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!containerRef.current || !latex) return;
    try {
      katex.render(latex, containerRef.current, {
        displayMode: display,
        throwOnError: false,
        errorColor: '#ef4444',
      });
      setRenderError(null);
    } catch (err: any) {
      setRenderError(err?.message || 'Render error');
    }
  }, [latex, display]);

  return (
    <NodeViewWrapper
      as="div"
      style={{
        position: 'relative',
        padding: '0.75rem 1rem',
        margin: '0.75rem 0',
        background: 'var(--color-bg-secondary)',
        borderRadius: 'var(--radius-sm)',
        border: selected ? '2px solid var(--color-primary)' : '1px solid var(--color-border)',
        cursor: 'pointer',
        textAlign: display ? 'center' : 'left',
        overflowX: 'auto',
      }}
    >
      {renderError && (
        <div style={{ color: '#ef4444', fontSize: '0.85rem', marginBottom: '0.5rem' }}>
          ⚠️ Equation render error: {renderError}
        </div>
      )}
      <div ref={containerRef} />
      {!latex && (
        <span style={{ color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
          Empty equation. Double-click to edit.
        </span>
      )}
    </NodeViewWrapper>
  );
}
