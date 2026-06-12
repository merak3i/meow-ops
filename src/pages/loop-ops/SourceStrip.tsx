// Source-of-truth strip (spec §7): which workbook, which generation, how many
// entities, and the permanent production-writes badge. Also hosts the
// expand/collapse-all toggle and the Refresh-spec action (POST /loop-ops/sync
// through the local API — re-runs the workbook importer, nothing else).
import { RefreshCw, ShieldAlert, ShieldCheck } from 'lucide-react';
import type { CSSProperties } from 'react';
import type { LoopOpsStatus } from './api';
import type { LoopSpecMeta } from './types';

const strip: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap',
  padding: '12px 20px', borderBottom: '1px solid var(--border)', flexShrink: 0,
};
const chip: CSSProperties = {
  fontSize: 11, color: 'var(--text-secondary)', background: 'var(--bg-card)',
  border: '1px solid var(--border)', borderRadius: 999, padding: '3px 10px',
};

interface SourceStripProps {
  meta: LoopSpecMeta;
  status: LoopOpsStatus | null;
  allExpanded: boolean;
  syncing: boolean;
  onToggleAll: () => void;
  onRefresh: () => void;
}

export function SourceStrip({ meta, status, allExpanded, syncing, onToggleAll, onRefresh }: SourceStripProps) {
  // The alarm branch must never wear the safe color: a spec claiming
  // production writes are enabled is the exact event this badge exists for.
  const writesOn = meta.productionWritesEnabled;
  const badgeColor = writesOn ? 'var(--red)' : 'var(--green)';
  const specMtime = status?.files?.['spec.json']?.mtime;
  return (
    <div style={strip} data-testid="loop-source-strip">
      <h1 style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>Loop Ops</h1>
      <span style={{
        ...chip, color: badgeColor, borderColor: badgeColor,
        display: 'inline-flex', alignItems: 'center', gap: 5, textTransform: 'uppercase', letterSpacing: 0.4,
      }}>
        {writesOn ? <ShieldAlert size={12} /> : <ShieldCheck size={12} />}
        {writesOn ? 'PRODUCTION WRITES ON — INVESTIGATE' : 'production writes disabled'}
      </span>
      <span style={chip}>{meta.entityCount} entities · {meta.assistantCount} surfaces</span>
      <span style={chip} title={meta.generatedBy}>{meta.masterSpec}</span>
      <span style={{ ...chip, color: 'var(--text-muted)' }}>
        {specMtime
          ? `imported ${new Date(specMtime).toLocaleString()}`
          : `generated ${meta.generatedAt.slice(0, 10)}`}
      </span>
      <button
        onClick={onRefresh}
        disabled={syncing}
        style={{
          ...chip, cursor: syncing ? 'wait' : 'pointer', marginLeft: 'auto',
          color: 'var(--text-primary)', background: 'var(--bg-hover)',
          display: 'inline-flex', alignItems: 'center', gap: 6,
          opacity: syncing ? 0.6 : 1,
        }}
      >
        <RefreshCw size={12} className={syncing ? 'loop-spin' : undefined} />
        {syncing ? 'Importing…' : 'Refresh spec'}
      </button>
      <button onClick={onToggleAll} style={{
        ...chip, cursor: 'pointer', color: 'var(--text-primary)',
        background: 'var(--bg-hover)',
      }}>
        {allExpanded ? 'Collapse all waves' : 'Expand all waves'}
      </button>
    </div>
  );
}
