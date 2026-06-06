import React, { useState, useEffect, useRef } from 'react';
import { citationsApi } from '../../lib/literature-api';

interface CitationPickerProps {
  onSelect: (citation: any) => void;
  onClose: () => void;
}

export default function CitationPicker({ onSelect, onClose }: CitationPickerProps) {
  const [search, setSearch] = useState('');
  const [citations, setCitations] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (search.length < 2) {
      setCitations([]);
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await citationsApi.list({ search });
        setCitations(result);
      } catch (err) {
        console.error('Search citations error:', err);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const formatAuthors = (creators: any[]) => {
    if (!creators || creators.length === 0) return '';
    return creators
      .map((c) => c.lastName || c.name || '')
      .filter(Boolean)
      .join(', ');
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal-content"
        onClick={(e) => e.stopPropagation()}
        style={{ maxWidth: 500, maxHeight: 400, display: 'flex', flexDirection: 'column' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.75rem' }}>
          <h3 style={{ margin: 0, fontSize: '1rem' }}>Insert Citation</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>✕</button>
        </div>

        <input
          ref={inputRef}
          placeholder="Search citations by title or abstract..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          style={{
            width: '100%',
            padding: '0.5rem 0.75rem',
            fontSize: '0.85rem',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-sm)',
            background: 'var(--color-bg)',
            color: 'var(--color-text)',
            marginBottom: '0.5rem',
            boxSizing: 'border-box',
          }}
        />

        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && (
            <div style={{ padding: '1rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
              Searching...
            </div>
          )}

          {!loading && search.length >= 2 && citations.length === 0 && (
            <div style={{ padding: '1rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
              No citations found.
            </div>
          )}

          {citations.map((cit) => (
            <button
              key={cit.id}
              onClick={() => onSelect(cit)}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '0.5rem 0.75rem',
                border: 'none',
                borderBottom: '1px solid var(--color-border)',
                background: 'transparent',
                color: 'var(--color-text)',
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--color-bg-secondary)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{ fontWeight: 600, marginBottom: '0.125rem' }}>{cit.title}</div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                {formatAuthors(cit.creators_json)}
                {cit.issued_year ? ` (${cit.issued_year})` : ''}
                {cit.item_type ? ` · ${cit.item_type}` : ''}
              </div>
            </button>
          ))}

          {search.length < 2 && (
            <div style={{ padding: '1rem', textAlign: 'center', fontSize: '0.85rem', color: 'var(--color-text-muted)' }}>
              Type at least 2 characters to search.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
