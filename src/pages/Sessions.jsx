import { useEffect, useMemo, useState } from 'react';
import SessionTable from '../components/SessionTable';
import { Button, Notice, Scope } from '../components/ui';
import { fetchSessionPage, filterSessionScope, getSessionFilters, isDemoData } from '../lib/queries';

const FIRST_PAGE = { cursor: null, stack: [], version: undefined };

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

export default function Sessions({ sessions: previewSessions = [], dateRange = 30, scopeNow, refreshKey = 0 }) {
  const [filters, setFilters] = useState({ from: '', to: '', project: '', source: '', model: '' });
  const [pageSize, setPageSize] = useState(100);
  const [pagination, setPagination] = useState(FIRST_PAGE);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [retry, setRetry] = useState(0);
  const scope = useMemo(() => getSessionFilters(dateRange, scopeNow, filters), [dateRange, scopeNow, filters]);
  const scopeKey = JSON.stringify({ scope, pageSize, refreshKey, retry });
  const page = pagination.scopeKey === scopeKey ? pagination : FIRST_PAGE;
  const { cursor, version, stack: cursorStack } = page;

  const updateFilter = (key, value) => {
    setLoading(true);
    setFilters((current) => ({ ...current, [key]: value }));
  };

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      const data = scope.error ? null : await fetchSessionPage({ ...scope, limit: pageSize, cursor, expectedVersion: version });
      if (cancelled) return;
      setResult(data);
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [scope, scopeKey, pageSize, cursor, version]);

  const usingArchive = result !== null;
  const items = usingArchive ? result.items : filterSessionScope(previewSessions, scope);
  const facets = result?.facets || {
    projects: [...new Set(previewSessions.map((row) => row.project).filter(Boolean))].sort(),
    sources: [...new Set(previewSessions.map((row) => row.source || 'claude'))].sort(),
    models: [...new Set(previewSessions.map((row) => row.model).filter(Boolean))].sort(),
  };
  const archiveTotal = result?.archive?.total ?? previewSessions.length;
  const firstRow = cursorStack.length * pageSize + (items.length > 0 ? 1 : 0);
  const lastRow = cursorStack.length * pageSize + items.length;
  const countLabel = usingArchive
    ? `${result.total.toLocaleString()} matching · ${archiveTotal.toLocaleString()} total recorded`
    : `${items.length.toLocaleString()} matching in ${previewSessions.length.toLocaleString()} loaded`;
  const rangeLabel = filters.from || filters.to ? `${filters.from || 'Beginning'} to ${filters.to || 'now'} (custom dates)`
    : dateRange === 'all' ? 'All time' : dateRange === '1h' ? 'Last hour' : dateRange === '24h' ? 'Last 24 hours' : `Last ${dateRange} days`;

  const hasFilters = useMemo(() => Object.values(filters).some(Boolean), [filters]);

  return (
    <div aria-busy={loading}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--sp-3)', marginBottom: 'var(--sp-3)' }}>
        <Scope
          range={rangeLabel}
          completeness={isDemoData(items) ? 'demo' : usingArchive ? 'archive' : 'preview'}
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
          }} />
          {hasFilters && (
            <Button
              variant="ghost"
              onClick={() => { setLoading(true); setFilters({ from: '', to: '', project: '', source: '', model: '' }); }}
            >
              Clear filters
            </Button>
          )}
        </div>
      </div>

      {scope.error && <Notice>{scope.error}</Notice>}
      {!loading && !usingArchive && !scope.error && !isDemoData(previewSessions) && (
        <Notice action={<Button onClick={() => setRetry((value) => value + 1)}>Retry archive</Button>}>
          Archive unavailable. Your filters still apply to the loaded preview.
        </Notice>
      )}
      {loading && result && <p role="status">Updating session history…</p>}

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
                setPagination({ scopeKey, cursor: target, stack: previous, version: result.archiveVersion });
              }}
            >
              Previous
            </Button>
            <Button
              variant="primary"
              disabled={!result.nextCursor || loading}
              onClick={() => {
                setLoading(true);
                setPagination({ scopeKey, cursor: result.nextCursor, stack: [...cursorStack, cursor], version: result.archiveVersion });
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
