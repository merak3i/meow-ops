// Loop-Ops — operator cockpit for Patherle's 31-entity loop architecture.
// Canvas (coordinator → 4 director lanes → 26 assistants), inspector drawer,
// mobile fallback, refresh-spec action, and the run timeline. Data is
// LOCAL-ONLY JSON produced by sync/loop-ops-import.mjs.
// Hard invariant for every phase: no writes to Patherle production, Supabase,
// Railway, Vercel, or GitHub from any Loop-Ops code path.
import { useCallback, useState, useSyncExternalStore } from 'react';
import { ShieldCheck, FileSpreadsheet, RefreshCw, SearchX } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { useLoopOpsData } from './loop-ops/useLoopOpsData';
import { useLoopRuns } from './loop-ops/useLoopRuns';
import { LoopCanvas } from './loop-ops/LoopCanvas';
import { InspectorDrawer } from './loop-ops/InspectorDrawer';
import { SourceStrip } from './loop-ops/SourceStrip';
import { MobileFallback } from './loop-ops/MobileFallback';
import { RunTimeline } from './loop-ops/RunTimeline';
import type { LoopEntity } from './loop-ops/types';

const ALL_WAVES = [1, 2, 3, 4];

// Lazily initialized so importing this module never touches window — matches
// the guard convention elsewhere (ScryingSanctum) and keeps the module safe
// for future jsdom unit tests.
let mobileQuery: MediaQueryList | undefined;
const getMobileQuery = () => (mobileQuery ??= window.matchMedia('(max-width: 768px)'));
function subscribeMobile(cb: () => void) {
  const mq = getMobileQuery();
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

const styles: Record<string, CSSProperties> = {
  shell: { display: 'flex', flexDirection: 'column', height: '100vh' },
  emptyWrap: { padding: 32, overflowY: 'auto' },
  header: { display: 'flex', alignItems: 'center', gap: 16, marginBottom: 8 },
  title: { fontSize: 22, fontWeight: 300, color: 'var(--text-primary)', margin: 0 },
  badge: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    fontSize: 11, letterSpacing: 0.5, textTransform: 'uppercase',
    color: 'var(--green)', border: '1px solid var(--green)',
    borderRadius: 999, padding: '4px 12px',
  },
  subtitle: { fontSize: 13, color: 'var(--text-muted)', margin: '0 0 28px', maxWidth: 640, lineHeight: 1.6 },
  grid: {
    display: 'grid', gap: 16,
    gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', maxWidth: 1100,
  },
  card: {
    background: 'var(--bg-card)', border: '1px solid var(--border)',
    borderRadius: 10, padding: 20, display: 'flex', flexDirection: 'column', gap: 8,
  },
  cardTitle: {
    display: 'flex', alignItems: 'center', gap: 8,
    fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
  },
  cardBody: { fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 },
};

interface EmptyStateCard { icon: ReactNode; title: string; body: string }

// Instructional empty states (spec §7) — shown until a spec import succeeds.
const EMPTY_STATES: EmptyStateCard[] = [
  {
    icon: <FileSpreadsheet size={15} />,
    title: 'Import Master Spec',
    body: 'No spec data found at /data/loop-ops/spec.json. The importer converts '
      + 'the Master Spec workbook into local JSON — 26 assistant surfaces plus '
      + '5 synthesized coordinator/director entities.',
  },
  {
    icon: <RefreshCw size={15} />,
    title: 'Start local sync',
    body: 'The local API on 127.0.0.1:7337 serves spec, status, and run history '
      + 'once the Phase 4 endpoints exist. Until then data loads from the static path only.',
  },
  {
    icon: <ShieldCheck size={15} />,
    title: 'No production writes enabled',
    body: 'Loop-Ops is a cockpit, not an executor. No code path here writes to '
      + 'Patherle production, Supabase, Railway, Vercel, or GitHub — in this '
      + 'phase or any later one without explicit approval.',
  },
  {
    icon: <SearchX size={15} />,
    title: 'Verification missing',
    body: 'Every entity shows what was last verified and what was not. Anything '
      + 'unverified stays labeled as such — in the canvas, the run timeline, and agent handoffs.',
  },
];

function EmptyState({ error }: { error: string | null }) {
  return (
    <div style={styles.emptyWrap}>
      <div style={styles.header}>
        <h1 style={styles.title}>The Loom</h1>
        <span style={styles.badge}><ShieldCheck size={13} />production writes disabled</span>
      </div>
      {error && !error.includes('404') && (
        <p style={{ fontSize: 12, color: 'var(--warning)', margin: '0 0 12px' }}>
          spec.json exists but failed to load: {error} — fix the data, this is not a missing import.
        </p>
      )}
      <p style={styles.subtitle}>
        Control room for Patherle&apos;s 31-entity loop architecture — 1 coordinator,
        4 director lanes, 26 assistant surfaces. Local-first: workbook → JSON →
        canvas. Read-only toward every production system.
      </p>
      <div style={styles.grid}>
        {EMPTY_STATES.map((card) => (
          <div key={card.title} style={styles.card}>
            <span style={styles.cardTitle}>{card.icon}{card.title}</span>
            <p style={styles.cardBody}>{card.body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function LoopOps() {
  const { spec, status, loading, syncing, error, refresh } = useLoopOpsData();
  const { runs, loading: runsLoading } = useLoopRuns();
  const [expandedWaves, setExpandedWaves] = useState<ReadonlySet<number>>(new Set([1]));
  const [selected, setSelected] = useState<LoopEntity | null>(null);
  const isMobile = useSyncExternalStore(subscribeMobile, () => getMobileQuery().matches);

  const toggleWave = useCallback((wave: number) => {
    setExpandedWaves((prev) => {
      const next = new Set(prev);
      if (next.has(wave)) next.delete(wave); else next.add(wave);
      return next;
    });
  }, []);

  const allExpanded = ALL_WAVES.every((w) => expandedWaves.has(w));
  const toggleAll = useCallback(() => {
    setExpandedWaves(allExpanded ? new Set() : new Set(ALL_WAVES));
  }, [allExpanded]);

  if (loading) {
    return <div style={{ padding: 32, color: 'var(--text-muted)', fontSize: 14 }}>Loading the Loom…</div>;
  }
  if (!spec) return <EmptyState error={error} />;

  return (
    <div style={styles.shell}>
      <SourceStrip
        meta={spec.meta}
        status={status}
        allExpanded={allExpanded}
        syncing={syncing}
        onToggleAll={toggleAll}
        onRefresh={() => { void refresh(); }}
      />
      {error && (
        <p style={{ fontSize: 12, color: 'var(--warning)', margin: 0, padding: '6px 20px' }}>
          last import problem: {error}
        </p>
      )}
      <div style={{ display: 'flex', flex: 1, minHeight: 0 }}>
        {isMobile
          ? <MobileFallback entities={spec.entities} onSelectEntity={setSelected} />
          : (
            <LoopCanvas
              entities={spec.entities}
              expandedWaves={expandedWaves}
              onToggleWave={toggleWave}
              onSelectEntity={setSelected}
            />
          )}
        {selected && <InspectorDrawer entity={selected} onClose={() => setSelected(null)} />}
      </div>
      <RunTimeline runs={runs} loading={runsLoading} />
    </div>
  );
}
