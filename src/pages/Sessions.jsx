import { useEffect, useMemo, useState } from 'react';
import SessionTable from '../components/SessionTable';
import { Button, Scope } from '../components/ui';
import { fetchSessionPage } from '../lib/queries';

const EMPTY_FACETS = { projects: [], sources: [], models: [] };

function SelectFilter({ label, value, options, onChange, allowAll = true }) {
  return (
    <label style={{ display: 'grid', gap: 5, fontSize: 11, color: 'var(--text-muted)' }}>
      {label}
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        style={{
          minWidth: 150, padding: '7px 9px', borderRadius: 7,
          border: '1px solid var(--border)', background: 'var(--bg-card)',
          color: 'var(--text-primary)', fontSize: 12,
        }}
      >
        {allowAll && <option value="">All</option>}
        {options.map((option) => <option key={option} value={option}>{option}</option>)}
      </select>
    </label>
  );
}

export default function Sessions({ sessions: previewSessions = [] }) {
  const [filters, setFilters] = useState({ from: '', to: '', project: '', source: '', model: '' });
  const [pageSize, setPageSize] = useState(100);
  const [cursor, setCursor] = useState(null);
  const [cursorStack, setCursorStack] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);

  const updateFilter = (key, value) => {
    setLoading(true);
    setFilters((current) => ({ ...current, [key]: value }));
    setCursor(null);
    setCursorStack([]);
  };

  useEffect(() => {
    let cancelled = false;
    fetchSessionPage({ ...filters, limit: pageSize, cursor }).then((data) => {
      if (cancelled) return;
      setResult(data);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [filters, pageSize, cursor]);

  const usingArchive = result !== null;
  const items = usingArchive ? result.items : previewSessions;
  const facets = result?.facets || EMPTY_FACETS;
  const archiveTotal = result?.archive?.total ?? previewSessions.length;
  const firstRow = cursorStack.length * pageSize + (items.length > 0 ? 1 : 0);
  const lastRow = cursorStack.length * pageSize + items.length;
  const countLabel = usingArchive
    ? `${result.total.toLocaleString()} matching · ${archiveTotal.toLocaleString()} total recorded`
    : `${previewSessions.length.toLocaleString()} loaded`;

  const hasFilters = useMemo(() => Object.values(filters).some(Boolean), [filters]);

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-3)', marginBottom: 'var(--sp-3)' }}>
        <Scope
          range={usingArchive ? 'Every session ever parsed' : 'Newest sessions only'}
          completeness={usingArchive ? 'archive' : 'preview'}
        />
        <span style={{ fontSize: 'var(--fs-ui)', color: 'var(--text-muted)' }}>{countLabel}</span>
      </div>

      <div className="card" style={{ padding: 14, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'end' }}>
          {['from', 'to'].map((key) => (
            <label key={key} style={{ display: 'grid', gap: 5, fontSize: 11, color: 'var(--text-muted)' }}>
              {key === 'from' ? 'From date' : 'To date'}
              <input
                type="date"
                value={filters[key]}
                onChange={(event) => updateFilter(key, event.target.value)}
                style={{
                  padding: '6px 9px', borderRadius: 7, border: '1px solid var(--border)',
                  background: 'var(--bg-card)', color: 'var(--text-primary)', fontSize: 12,
                }}
              />
            </label>
          ))}
          <SelectFilter label="Project" value={filters.project} options={facets.projects} onChange={(value) => updateFilter('project', value)} />
          <SelectFilter label="Source" value={filters.source} options={facets.sources} onChange={(value) => updateFilter('source', value)} />
          <SelectFilter label="Model" value={filters.model} options={facets.models} onChange={(value) => updateFilter('model', value)} />
          <SelectFilter label="Rows per page" value={String(pageSize)} options={['100', '250', '500']} allowAll={false} onChange={(value) => {
            setLoading(true);
            setPageSize(Number(value) || 100);
            setCursor(null);
            setCursorStack([]);
          }} />
          {hasFilters && (
            <Button
              variant="ghost"
              onClick={() => { setLoading(true); setFilters({ from: '', to: '', project: '', source: '', model: '' }); setCursor(null); setCursorStack([]); }}
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {loading && !result ? (
        <div className="card" style={{ padding: 32, color: 'var(--text-muted)', textAlign: 'center' }}>Loading session history…</div>
      ) : (
        <SessionTable sessions={items} />
      )}

      {usingArchive && (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 14, paddingRight: 180 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            {items.length > 0 ? `${firstRow.toLocaleString()}–${lastRow.toLocaleString()} of ${result.total.toLocaleString()}` : 'No matching sessions'}
          </span>
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <Button
              disabled={cursorStack.length === 0 || loading}
              onClick={() => {
                setLoading(true);
                const previous = [...cursorStack];
                const target = previous.pop() ?? null;
                setCursorStack(previous);
                setCursor(target);
              }}
            >
              Previous
            </Button>
            <Button
              variant="primary"
              disabled={!result.nextCursor || loading}
              onClick={() => {
                setLoading(true);
                setCursorStack((current) => [...current, cursor]);
                setCursor(result.nextCursor);
              }}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
