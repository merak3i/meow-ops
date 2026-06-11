// Loop-Ops — operator cockpit for Patherle's 31-entity loop architecture.
// Phase 1: route + shell with instructional empty states. The React Flow
// canvas, workbook importer, and local-API wiring land in later phases.
// Hard invariant for every phase: no writes to Patherle production,
// Supabase, Railway, Vercel, or GitHub from any Loop-Ops code path.
import { ShieldCheck, FileSpreadsheet, RefreshCw, SearchX } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';

const styles: Record<string, CSSProperties> = {
  page: {
    display: 'flex', flexDirection: 'column', height: '100vh',
    padding: 32, overflowY: 'auto',
  },
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

interface EmptyStateCard {
  icon: ReactNode;
  title: string;
  body: string;
}

// Instructional empty states from the implementation spec (§7): each card
// tells the operator what is missing and what action produces it.
const EMPTY_STATES: EmptyStateCard[] = [
  {
    icon: <FileSpreadsheet size={15} />,
    title: 'Import Master Spec',
    body: 'No spec data yet. The Phase 3 importer converts the Master Spec '
      + 'workbook into local JSON under public/data/loop-ops/ — 26 assistant '
      + 'surfaces plus 5 synthesized coordinator/director entities.',
  },
  {
    icon: <RefreshCw size={15} />,
    title: 'Start local sync',
    body: 'The local API on 127.0.0.1:7337 serves spec, status, and run '
      + 'history once the Phase 4 endpoints exist. Until then this page '
      + 'renders shell-only.',
  },
  {
    icon: <ShieldCheck size={15} />,
    title: 'No production writes enabled',
    body: 'Loop-Ops is a cockpit, not an executor. No code path here writes '
      + 'to Patherle production, Supabase, Railway, Vercel, or GitHub — in '
      + 'this phase or any later one without explicit approval.',
  },
  {
    icon: <SearchX size={15} />,
    title: 'Verification missing',
    body: 'Every entity will show what was last verified and what was not. '
      + 'Anything unverified stays labeled as such — in the canvas, the run '
      + 'timeline, and agent handoffs.',
  },
];

export default function LoopOps() {
  return (
    <div style={styles.page}>
      <div style={styles.header}>
        <h1 style={styles.title}>Loop Ops</h1>
        <span style={styles.badge}>
          <ShieldCheck size={13} />
          production writes disabled
        </span>
      </div>
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
