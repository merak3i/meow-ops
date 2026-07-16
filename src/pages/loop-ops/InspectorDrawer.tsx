// Right-hand inspector for the selected entity. Answers the four questions
// from spec §1: what owns this, what it can touch, last verified state, and
// what it did not verify. Display-only — no write verbs anywhere.
import { useState } from 'react';
import { X } from 'lucide-react';
import type { CSSProperties, ReactNode } from 'react';
import { StatusChip } from './StatusChip';
import type { LoopEntity, LoopGate } from './types';
import { isGateStale } from './gate-status.mjs';

const drawer: CSSProperties = {
  width: 340, flexShrink: 0, borderLeft: '1px solid var(--border)',
  background: 'var(--bg-card)', padding: 20, overflowY: 'auto',
  display: 'flex', flexDirection: 'column', gap: 16,
};
const h: CSSProperties = {
  fontSize: 10, letterSpacing: 0.6, textTransform: 'uppercase',
  color: 'var(--text-muted)', margin: '0 0 6px',
};
const body: CSSProperties = { fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p style={h}>{title}</p>
      {children}
    </div>
  );
}

// Copy-to-clipboard for validation commands. The UI itself never runs them.
function CopyableCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard blocked — the command stays selectable */ }
  };
  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
      <code style={{ fontSize: 10.5, lineHeight: 1.5, wordBreak: 'break-all', flex: 1 }}>{command}</code>
      <button onClick={copy} aria-label="Copy validation command" style={{
        background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 6,
        color: copied ? 'var(--green)' : 'var(--text-secondary)', cursor: 'pointer',
        fontSize: 10, padding: '3px 8px', flexShrink: 0,
      }}>
        {copied ? 'copied' : 'copy'}
      </button>
    </div>
  );
}

export function InspectorDrawer({ entity, gates, onClose }: { entity: LoopEntity; gates: readonly LoopGate[]; onClose: () => void }) {
  const d = entity.detail ?? {};
  const knobs: Array<[string, string | number | undefined]> = [
    ['archetype', entity.archetype ?? undefined], ['risk', entity.riskClass ?? undefined],
    ['wave', entity.wave ?? undefined], ['model', d.modelTier],
    ['floor', d.confidenceFloor], ['pass ≥', d.passThreshold],
    ['prompt', d.promptVersion], ['eval set', d.evalSet],
  ];
  return (
    <aside style={drawer} data-testid="loop-inspector" aria-label={`Inspector: ${entity.label}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>{entity.label}</p>
          {entity.surfaceKey && <code style={{ fontSize: 11, color: 'var(--text-muted)' }}>{entity.surfaceKey}</code>}
        </div>
        <button onClick={onClose} aria-label="Close inspector" style={{
          background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4,
        }}>
          <X size={16} />
        </button>
      </div>

      <Section title="What owns this">
        <p style={body}>
          {entity.kind}{entity.group ? ` · ${entity.group} lane` : ' · all lanes'}
        </p>
      </Section>

      <Section title="What it can touch">
        <p style={body}>{entity.allowedActions.join(', ')} — read-only toward every production system.</p>
      </Section>

      <Section title="Last verified state">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <StatusChip status={entity.status} />
          {d.lastCheckedAt && <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>{d.lastCheckedAt}</span>}
        </div>
        {d.currentTruth && <p style={body}>{d.currentTruth}</p>}
        {gates.length === 0 && <p style={{ ...body, color: 'var(--loop-needs-review)' }}>No gate evidence recorded — needs review.</p>}
        {gates.map((gate) => (
          <div key={gate.id} data-testid="loop-gate-evidence" style={{ marginTop: 8 }}>
            <p style={body}><strong>{gate.gateType}</strong>: {gate.evidence ?? 'no evidence attached'}</p>
            {gate.blockingReason && <p style={{ ...body, color: 'var(--loop-blocked)' }}>blocking: {gate.blockingReason}</p>}
            <p style={{ ...body, fontSize: 10 }}>
              checked: {gate.lastCheckedAt ?? 'never'}
              {isGateStale(gate) ? ` · stale after 7 days — needs review` : ''}
            </p>
          </div>
        ))}
      </Section>

      <Section title="Not verified">
        {(d.notVerified?.length ?? 0) > 0 ? (
          <ul style={{ ...body, paddingLeft: 16 }}>
            {d.notVerified?.map((n) => <li key={n}>{n}</li>)}
          </ul>
        ) : (
          <p style={body}>No unverified items recorded — treat with suspicion until evidence is attached.</p>
        )}
        {d.correlationStatus && <p style={{ ...body, marginTop: 6 }}>{d.correlationStatus}</p>}
      </Section>

      {knobs.some(([, v]) => v !== undefined && v !== '') && (
      <Section title="Knobs (workflow spec)">
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            {knobs.filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => (
              <div key={k} style={{ fontSize: 11 }}>
                <span style={{ color: 'var(--text-muted)' }}>{k}: </span>
                <span style={{ color: 'var(--text-secondary)' }}>{String(v)}</span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {d.guardrails && (
        <Section title="Guardrails"><p style={body}>{d.guardrails}</p></Section>
      )}

      {d.validationCommand && (
        <Section title="Validation (run yourself — Loop-Ops never executes)">
          <CopyableCommand command={d.validationCommand} />
        </Section>
      )}

      {(d.releaseChecks?.length ?? 0) > 0 && (
        <Section title="Release checks">
          {d.clonePath && (
            <p style={{ ...body, marginBottom: 6 }}>
              clone: <code style={{ fontSize: 10.5 }}>{d.clonePath}</code>{' '}
              {d.cloneVerified ? '✓ remote verified' : '— NOT verified'}
            </p>
          )}
          <ul style={{ ...body, paddingLeft: 16 }}>
            {d.releaseChecks?.map((c) => <li key={c}><code style={{ fontSize: 10.5 }}>{c}</code></li>)}
          </ul>
        </Section>
      )}

      {entity.repoLinks.length > 0 && (
        <Section title="Repo links (read-only)">
          <ul style={{ ...body, paddingLeft: 16 }}>
            {entity.repoLinks.map((link) => (
              <li key={link}>
                {link.startsWith('https://')
                  ? <a href={link} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent-hover)' }}>{link.replace('https://github.com/', '')}</a>
                  : <code style={{ fontSize: 11 }}>{link}</code>}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="Sources">
        <ul style={{ ...body, paddingLeft: 16 }}>
          {entity.sources.map((s) => <li key={s}>{s}</li>)}
        </ul>
      </Section>
    </aside>
  );
}
