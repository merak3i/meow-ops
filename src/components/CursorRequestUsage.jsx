import { Card, Eyebrow, Scope } from './ui';
import { useEffect, useRef, useState } from 'react';

export default function CursorRequestUsage() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(null);
  const mounted = useRef(true);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current?.abort(); }; }, []);
  async function load() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    setLoading(true);
    setError('');
    const timeout = setTimeout(() => controller.abort(), 125_000);
    try {
      const base = new URL(import.meta.env.VITE_LOCAL_SYNC_URL || 'http://127.0.0.1:7337');
      if (base.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)) throw new Error('A loopback helper is required.');
      const response = await fetch(new URL('/loop-eng/cursor-request-usage', base), { headers: { 'x-meow-ops-local': '1' }, signal: controller.signal });
      const data = await response.json();
      if (!response.ok || !data.ok) throw new Error('Local Cursor history unavailable.');
      if (mounted.current && !controller.signal.aborted) setReport(data.report);
    } catch {
      if (mounted.current) setError(controller.signal.aborted ? 'The scan timed out. Retry after the helper finishes.' : 'Cursor request history is unavailable. Check the local helper and retry.');
    } finally {
      clearTimeout(timeout);
      if (mounted.current && request.current === controller) setLoading(false);
    }
  }
  const rows = Array.isArray(report?.by_model) ? report.by_model : [];
  return (
    <section className="mo-section" aria-label="Cursor requested models">
      <div className="mo-section__head" style={{ flexWrap: 'wrap' }}>
        <Eyebrow>Cursor requested models</Eyebrow>
        <Scope range="All matched local history" source="Cursor request records" completeness="unknown" ignoresDateFilter />
      </div>
      <Card>
        <button type="button" className="mo-button" disabled={!local || loading} onClick={load}>{loading ? 'Reading local Cursor history…' : report ? 'Refresh Cursor requests' : 'Read local Cursor requests'}</button>
        {!local && <p>Open the local dashboard to read private Cursor history. This data is never included in the deployed site.</p>}
        {error && <p role="status">{error}</p>}
        <p style={{ color: 'var(--text-secondary)', fontSize: 'var(--fs-ui)', lineHeight: 1.6, marginBottom: 'var(--sp-3)' }}>
          {!report ? 'Read historical model selections directly from local Cursor records. Results stay in the helper’s memory and are not written to a deployable data file.' : report.status === 'ok'
            ? `Historical model selections across ${report.matched_sessions} matched conversations. These are requests, not confirmed response models or billed API calls. Tokens and charges are unavailable from these records.`
            : 'Local Cursor model-request metadata could not be read. Transcript sessions are still tracked; sync with a current Node release to retry.'}
        </p>
        {rows.length > 0 && (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-ui)' }}>
              <thead><tr><th scope="col" style={{ textAlign: 'left' }}>Requested model</th><th scope="col">Requests</th><th scope="col">Conversations</th></tr></thead>
              <tbody>{rows.map(row => (
                <tr key={row.model}>
                  <th scope="row" style={{ textAlign: 'left', fontWeight: 400, paddingBlock: 'var(--sp-2)', overflowWrap: 'anywhere' }}>{row.model}</th>
                  <td className="mo-num" style={{ textAlign: 'center' }}>{row.requests.toLocaleString()}</td>
                  <td className="mo-num" style={{ textAlign: 'center' }}>{row.sessions.toLocaleString()}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        {report?.status === 'ok' && <p style={{ color: 'var(--text-muted)', fontSize: 'var(--fs-meta)', marginTop: 'var(--sp-3)' }}>{report.unresolved_requests || 0} requests have no resolved model, including Auto/default. Conversations may appear under more than one model. Checked {new Date(report.checked_at).toLocaleString()}; cached for up to five minutes.</p>}
      </Card>
    </section>
  );
}
