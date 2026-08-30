// Loop-Ops — operator cockpit for user-supplied multi-agent loop maps.
// Canvas (coordinator → director lanes → worker surfaces), inspector drawer,
// mobile fallback, refresh-spec action, and the run timeline. Data is
// LOCAL-ONLY JSON produced by sync/loop-ops-import.mjs.
// Hard invariant: no writes to production services from any Loop-Ops code path.
import { useCallback, useMemo, useState, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import { EmptyState } from '../components/ui';
import { useLoopOpsData } from './loop-ops/useLoopOpsData';
import { useLoopRuns } from './loop-ops/useLoopRuns';
import { LoopCanvas } from './loop-ops/LoopCanvas';
import { InspectorDrawer } from './loop-ops/InspectorDrawer';
import { SourceStrip } from './loop-ops/SourceStrip';
import { MobileFallback } from './loop-ops/MobileFallback';
import { RunTimeline } from './loop-ops/RunTimeline';
import type { LoopEntity } from './loop-ops/types';
import { effectiveStatus } from './loop-ops/gate-status.mjs';
import { useLoopProposals } from './loop-ops/useLoopProposals';

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
  shell: { display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 },
  emptyWrap: { padding: 'var(--sp-5)', overflowY: 'auto' },
};

// The map is empty until the importer has run once. One instruction, not the
// four reassurance cards this used to show.
function MapEmptyState({ error }: { error: string | null }) {
  const brokenSpec = error && !error.includes('404');
  return (
    <div style={styles.emptyWrap}>
      <EmptyState
        title={brokenSpec ? 'The spec file could not be read' : 'No loop map imported yet'}
        body={brokenSpec
          ? `spec.json exists but failed to load: ${error}. Fix the data — this is not a missing import.`
          : 'The importer turns your workflow workbook into local JSON: worker surfaces, plus the coordinator and director lanes above them. Run it once and the canvas fills in.'}
        {...(brokenSpec ? {} : { command: 'node sync/loop-ops-import.mjs' })}
      />
      <p style={{
        maxWidth: '58ch', margin: '0 auto', textAlign: 'center',
        fontSize: 'var(--fs-ui)', color: 'var(--text-muted)', lineHeight: 1.65,
      }}>
        This surface never writes to a production system. It shows what is wired, who owns it, and
        what was last verified.
      </p>
    </div>
  );
}

export default function LoopOps() {
  const { spec, status, gatesByEntity, loading, syncing, error, refresh } = useLoopOpsData();
  const { runs, loading: runsLoading } = useLoopRuns();
  const proposalCounts = useLoopProposals();
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
  const displayEntities = useMemo(() => spec?.entities.map((entity) => ({
    ...entity,
    status: effectiveStatus(entity, gatesByEntity.get(entity.id) ?? []),
  })) ?? [], [spec, gatesByEntity]);
  const selectedDisplay = selected
    ? displayEntities.find((entity) => entity.id === selected.id) ?? selected
    : null;
  const openProposals = useCallback((entityId: string) => {
    window.location.hash = `#/loops/review?entity=${encodeURIComponent(entityId)}`;
  }, []);

  if (loading) {
    return (
      <div style={{ padding: 'var(--sp-5)', color: 'var(--text-muted)', fontSize: 'var(--fs-body)' }}>
        Loading the map…
      </div>
    );
  }
  if (!spec) return <MapEmptyState error={error} />;

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
          ? <MobileFallback entities={displayEntities} onSelectEntity={setSelected} />
          : (
            <LoopCanvas
              entities={displayEntities}
              expandedWaves={expandedWaves}
              proposalCounts={proposalCounts}
              dependencyEdges={spec.edges}
              onToggleWave={toggleWave}
              onSelectEntity={setSelected}
              onOpenProposals={openProposals}
            />
          )}
        {selectedDisplay && (
          <InspectorDrawer
            entity={selectedDisplay}
            gates={gatesByEntity.get(selectedDisplay.id) ?? []}
            onClose={() => setSelected(null)}
          />
        )}
      </div>
      <RunTimeline runs={runs} loading={runsLoading} />
    </div>
  );
}
