import { useEffect, useRef, useState } from 'react';
import { Copy, FolderOpen, RefreshCw } from 'lucide-react';
import { Button, Card, EmptyState, Notice } from '../components/ui';
import { fetchStorageSnapshot, formatStorageBytes, isLocalStorageSurface, openStorageFolder, refreshStorageSnapshot } from '../lib/storage-api';
import type { StorageGrowth, StorageResponse, StorageSnapshot } from '../lib/storage-api';
import './Storage.css';

const CATEGORY_NAMES: Record<string, string> = { logs: 'Session logs', diagnostics: 'Diagnostics', database: 'Databases + WAL', derived: 'Derived data', exports: 'Exports', backups: 'Backups', cache: 'Cache', weights: 'Model files', other: 'Other files' };
const HARNESS_NAMES: Record<string, string> = { codex: 'Codex', claude: 'Claude Code', cursor: 'Cursor', hermes: 'Hermes', antigravity: 'Antigravity', 'meow-ops': 'Meow Ops', aider: 'Aider', ollama: 'Ollama', lmstudio: 'LM Studio', grokbot: 'GrokBot', pi: 'Pi', opencode: 'OpenCode', deepseek: 'DeepSeek', copilot: 'Copilot' };
const measuredAt = (value: string | null) => value ? `${new Date(value).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' })} IST` : 'Not measured';
const locationName = (value: string) => value.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
const growthLabel = (growth: StorageGrowth) => growth.status === 'available' && growth.logicalBytes !== null ? `${growth.logicalBytes > 0 ? '+' : ''}${formatStorageBytes(growth.logicalBytes)}` : 'No comparable baseline';

export function StorageSummary({ snapshot, onOpen }: { snapshot: StorageSnapshot | null; onOpen?: () => void }) {
  return <section className="storage-summary" aria-label="Local storage summary">
    <div><strong>Local storage</strong><p>{snapshot ? `${formatStorageBytes(snapshot.totals.logicalBytes)} observed · ${snapshot.coverage.status === 'complete' ? 'all registered locations measured' : 'partial coverage'}` : 'Storage has not been measured.'}</p>{snapshot && <small>Measured {measuredAt(snapshot.generatedAt)}</small>}</div>
    {onOpen && <Button size="sm" onClick={onOpen}>View storage</Button>}
  </section>;
}

export default function Storage() {
  const [local] = useState(isLocalStorageSurface);
  const [data, setData] = useState<StorageResponse>({ snapshot: null, refreshing: false });
  const [loading, setLoading] = useState(local);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [opening, setOpening] = useState<string | null>(null);
  const action = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!local) return;
    const controller = new AbortController();
    void fetchStorageSnapshot(controller.signal).then(result => { if (!controller.signal.aborted) setData(result); }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Storage is unavailable.');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); action.current?.abort(); };
  }, [local]);
  useEffect(() => {
    if (!data.refreshing) return;
    const controller = new AbortController();
    let pending = false;
    const timer = window.setInterval(() => {
      if (pending) return;
      pending = true;
      void fetchStorageSnapshot(controller.signal).then(result => {
        if (!controller.signal.aborted) setData(result);
      }).catch((reason: unknown) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof Error ? reason.message : 'Storage status is unavailable.');
          setData(current => ({ ...current, refreshing: false }));
        }
      }).finally(() => { pending = false; });
    }, 1500);
    return () => { window.clearInterval(timer); controller.abort(); };
  }, [data.refreshing]);

  async function measure() {
    action.current?.abort();
    const controller = new AbortController();
    action.current = controller;
    setLoading(true); setError(null); setMessage('');
    try { const result = await refreshStorageSnapshot(controller.signal); if (!controller.signal.aborted) setData(result); }
    catch (reason) { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Storage could not be measured.'); }
    finally { if (!controller.signal.aborted) setLoading(false); }
  }
  async function openFolder(id: string) {
    setOpening(id); setMessage('');
    try { await openStorageFolder(id); setMessage(`Opened the folder for ${locationName(id)}.`); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : 'The folder could not be opened.'); }
    finally { setOpening(null); }
  }
  async function copyPath(path: string, id: string) {
    try { await navigator.clipboard.writeText(path); setMessage(`Copied the exact path for ${locationName(id)}.`); }
    catch { setMessage('Clipboard unavailable. Select the path to copy it manually.'); }
  }

  if (!local) return <EmptyState title="Storage stays on your Mac" body="Open the local dashboard to measure your files. The hosted demo does not read local storage or display invented measurements." />;
  const snapshot = data.snapshot;
  const busy = loading || data.refreshing;
  const problem = error || data.error;
  return <div className="storage-page">
    <div className="storage-heading"><div><h2>Storage</h2><p>Files used by your local agents and Meow Ops. This is a filesystem snapshot, independent of the session date filter.</p></div><Button onClick={() => { void measure(); }} disabled={busy}><RefreshCw size={15} aria-hidden="true" />{busy ? 'Measuring…' : 'Measure storage'}</Button></div>
    {problem && <Notice>{problem}{snapshot ? ' The earlier measurement remains visible below.' : ''}</Notice>}
    {message && <p className="storage-message" role="status">{message}</p>}
    {!snapshot && !problem && <p className="storage-muted" role="status">{busy ? 'Checking the local storage inventory…' : 'No measurement yet. Measure storage to count registered files without reading their contents.'}</p>}
    {snapshot && <>
      <p className="storage-muted">Measured {measuredAt(snapshot.generatedAt)}{data.refreshing ? ' · A fresh measurement is running.' : ''}</p>
      <div className="storage-metrics">
        <Card><p className="storage-kicker">Observed logical size</p><strong>{formatStorageBytes(snapshot.totals.logicalBytes)}</strong><p>{snapshot.totals.fileCount.toLocaleString()} unique files</p></Card>
        <Card><p className="storage-kicker">Allocated blocks</p><strong>{formatStorageBytes(snapshot.totals.allocatedBytes)}</strong><p>Filesystem-reported allocation</p></Card>
        <Card><p className="storage-kicker">Logical growth</p><strong className="storage-growth">{growthLabel(snapshot.growth)}</strong><p>{snapshot.previousGeneratedAt ? `Since ${measuredAt(snapshot.previousGeneratedAt)}` : 'A comparable second measurement is needed.'}</p></Card>
      </div>
      <p className="storage-muted">Logical size is file length. Allocated blocks are not guaranteed reclaimable space: APFS can share extents, and filesystem overhead is not included. Overlapping roots and hardlinks are counted once. Symlinks are excluded.</p>
      <p className={`storage-coverage storage-coverage--${snapshot.coverage.status}`} role="status">{snapshot.coverage.status === 'complete' ? 'Complete registered coverage' : 'Partial registered coverage'} · {snapshot.coverage.completeRoots} of {snapshot.coverage.registeredRoots} locations measured · {snapshot.coverage.missingRoots} missing · {snapshot.coverage.partialRoots} incomplete · {snapshot.coverage.errorCount} scan errors</p>
      {Boolean(snapshot.unresolvedLocations?.length) && <Card><h3>Detected tools with unconfirmed locations</h3><p className="storage-muted">These tools are not included in the measured totals.</p><ul className="storage-unresolved">{snapshot.unresolvedLocations?.map(item => <li key={item.source}><strong>{HARNESS_NAMES[item.source] || item.source}</strong>: {item.reason}</li>)}</ul></Card>}
      <Card><h3>By file type</h3><div className="storage-categories">{snapshot.categories.map(category => <div key={category.category}><span>{CATEGORY_NAMES[category.category] || category.category}</span><strong>{formatStorageBytes(category.logicalBytes)}</strong><small>{category.fileCount.toLocaleString()} files · {formatStorageBytes(category.allocatedBytes)} allocated</small></div>)}</div>{snapshot.categories.length === 0 && <p>No files were measured in the available locations.</p>}</Card>
      <Card pad={false}><div className="storage-table-scroll" tabIndex={0} role="region" aria-label="Storage by registered location"><table className="storage-table"><caption>Registered locations · partial rows show observed bytes only</caption><thead><tr><th scope="col">Harness / location</th><th scope="col">Coverage</th><th scope="col">Logical</th><th scope="col">Allocated</th><th scope="col">Growth</th><th scope="col">Exact local path</th></tr></thead><tbody>{snapshot.roots.map(root => <tr key={root.id}>
        <th scope="row"><span>{HARNESS_NAMES[root.source] || root.source}</span><small>{locationName(root.id)}</small><small>{root.categories.map(category => CATEGORY_NAMES[category.category] || category.category).join(', ') || CATEGORY_NAMES[root.category] || root.category}</small>
          {root.modelBuckets.length > 0 ? <details className="storage-location-models"><summary>Models and attribution ({root.modelBuckets.length})</summary><ul>{root.modelBuckets.map(bucket => <li key={`${bucket.kind}:${bucket.models.join('|')}`}><span>{bucket.kind === 'unknown' ? 'Unknown model' : bucket.kind === 'mixed' ? `Mixed: ${bucket.models.join(', ')}` : bucket.models.join(', ')}</span><strong>{formatStorageBytes(bucket.logicalBytes)}</strong><small>{bucket.fileCount.toLocaleString()} files</small></li>)}</ul></details> : <small>Model attribution unavailable</small>}
        </th>
        <td><span className={`storage-status storage-status--${root.status}`}>{root.status === 'missing' ? 'Not found' : root.status === 'partial' ? 'Partial' : 'Measured'}</span><small>{root.errorCount > 0 ? `${root.errorCount} errors` : root.status === 'complete' ? `${root.fileCount.toLocaleString()} files` : 'Coverage unavailable'}</small></td>
        <td className="mo-num">{root.status === 'missing' ? 'Unavailable' : formatStorageBytes(root.logicalBytes)}</td><td className="mo-num">{root.status === 'missing' ? 'Unavailable' : formatStorageBytes(root.allocatedBytes)}</td><td className="storage-growth-cell">{growthLabel(root.growth)}</td>
        <td><input className="storage-path" value={root.path} readOnly aria-label={`Exact path for ${locationName(root.id)}`} onFocus={event => event.currentTarget.select()} /><div className="storage-path-actions"><Button size="sm" onClick={() => { void copyPath(root.path, root.id); }}><Copy size={12} aria-hidden="true" />Copy path</Button><Button size="sm" disabled={opening !== null || root.status === 'missing'} onClick={() => { void openFolder(root.id); }}><FolderOpen size={12} aria-hidden="true" />{opening === root.id ? 'Opening…' : 'Open folder'}</Button></div></td>
      </tr>)}</tbody></table></div></Card>
      <Card><h3>Model attribution</h3><p className="storage-muted">Bytes are assigned to a model only when confirmed metadata identifies it. Files containing several models stay together; token usage never divides their size.</p><ul className="storage-models">{snapshot.modelBuckets.map(bucket => <li key={`${bucket.kind}:${bucket.models.join('|')}`}><span>{bucket.kind === 'unknown' ? 'Unknown model' : bucket.kind === 'mixed' ? `Mixed: ${bucket.models.join(', ')}` : bucket.models.join(', ')}</span><strong>{formatStorageBytes(bucket.logicalBytes)}</strong><small>{bucket.fileCount.toLocaleString()} files</small></li>)}</ul>{snapshot.modelBuckets.length === 0 && <p>No file attribution is available yet.</p>}</Card>
      {snapshot.coverage.errorCount > 0 && <details className="storage-errors"><summary>Scan errors ({snapshot.coverage.errorCount})</summary><ul>{snapshot.errors.map((item, index) => <li key={`${item.rootId}:${item.code}:${index}`}>{locationName(item.rootId)}: {item.code.replaceAll('_', ' ').toLowerCase()} during {item.operation}</li>)}</ul>{snapshot.coverage.errorsTruncated && <p>Only the first errors are listed. The coverage count includes all observed errors.</p>}</details>}
    </>}
  </div>;
}
