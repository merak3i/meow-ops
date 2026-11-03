import { useCallback, useEffect, useMemo, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { Copy, RefreshCw, X } from 'lucide-react';

import { Badge, Button, Card, EmptyState, Notice, StatTile } from '../components/ui';
import { sourceLabel } from '../lib/sources';
import {
  AUTOSWARM_INSTALL_COMMAND, CALL_KIND_LABEL, CALL_STATUS_META, EVIDENCE_META, SAMPLE_SWARM, STATE_META,
  ago, checkCommand, decisionCommand, duration, fetchSwarmSnapshot, inspectCommand, isLocalSwarmSurface,
  orbitLayout, probeCommand, statusLine, visibleProviders, wireWidth,
} from '../lib/swarm-api';
import type {
  CatClass, SwarmApproval, SwarmExtra, SwarmProvider, SwarmSnapshot, SwarmState,
} from '../lib/swarm-api';
import './Swarm.css';

// Swarm · Agents. AutoSwarm turns the coding agents on this Mac into one team;
// this tab is its mission control, read-only: who is found, who is proven to
// reply and resume, what is running, and what waits on you. The layout follows
// the MCH agent Orbit: you at the top as the approval gate, the router at the
// centre, the team on one ring. Actions are commands you run yourself.

const PORTRAITS: Readonly<Record<CatClass, string>> = {
  architect: new URL('./swarm/portraits/architect.webp', import.meta.url).href,
  builder: new URL('./swarm/portraits/builder.webp', import.meta.url).href,
  commander: new URL('./swarm/portraits/commander.webp', import.meta.url).href,
  detective: new URL('./swarm/portraits/detective.webp', import.meta.url).href,
  guardian: new URL('./swarm/portraits/guardian.webp', import.meta.url).href,
  storyteller: new URL('./swarm/portraits/storyteller.webp', import.meta.url).href,
  ghost: new URL('./swarm/portraits/ghost.webp', import.meta.url).href,
};

const REFRESH_MS = 15_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const LOCAL_URL = 'http://127.0.0.1:4273/#/swarm/agents';

interface SessionLike { source?: string | null; started_at?: string | null; ended_at?: string | null }
export interface SwarmProps {
  sessions?: readonly SessionLike[];
  /** The shell is showing example sessions, so they say nothing about this Mac. */
  sessionsAreSample?: boolean;
}

type Selection = { kind: 'provider'; id: string } | { kind: 'extra'; id: string } | null;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true);
  useEffect(() => {
    const query = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!query) return undefined;
    const update = () => setReduced(query.matches);
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return reduced;
}

function monogram(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length > 1) return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase();
  return name.length <= 3 ? name : name.slice(0, 1).toUpperCase();
}

function short(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function activate(event: ReactKeyboardEvent, action: () => void) {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    action();
  }
}

function CommandLine({ command, note, onCopy, label }: { command: string; note?: string; onCopy: (command: string, label: string) => void; label: string }) {
  return (
    <div className="swarm-command">
      <code className="swarm-command__text" tabIndex={0}>{command}</code>
      <Button size="sm" onClick={() => onCopy(command, label)} label={`Copy ${label}`}>
        <Copy size={12} aria-hidden="true" />Copy
      </Button>
      {note && <p className="swarm-command__note">{note}</p>}
    </div>
  );
}

function Evidence({ value }: { value: keyof typeof EVIDENCE_META }) {
  const meta = EVIDENCE_META[value];
  return <Badge tone={meta.tone} dot>{meta.label}</Badge>;
}

// ---------------------------------------------------------------------------

interface OrbitProps {
  providers: readonly SwarmProvider[];
  extras: readonly SwarmExtra[];
  selection: Selection;
  onSelect: (selection: Selection) => void;
  ownerName: string;
  ownerTitle: string;
  waiting: number;
  reducedMotion: boolean;
}

function Orbit({ providers, extras, selection, onSelect, ownerName, ownerTitle, waiting, reducedMotion }: OrbitProps) {
  const layout = orbitLayout(providers.length, extras.length);
  const { hub, owner } = layout;
  const ownerActive = waiting > 0;
  return (
    <svg
      className={`swarm-orbit${reducedMotion ? ' is-still' : ''}`}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      role="group"
      aria-label={`Agent swarm: ${providers.length} agents${extras.length ? ` and ${extras.length} outside AutoSwarm` : ''}`}
    >
      <defs>
        {providers.map((provider, index) => (
          <clipPath key={provider.id} id={`swarm-clip-${provider.id}`}>
            <circle cx="0" cy="0" r={layout.agents[index]?.r ?? 28} />
          </clipPath>
        ))}
        {extras.map((extra, index) => (
          <clipPath key={extra.id} id={`swarm-clip-x-${extra.id}`}>
            <circle cx="0" cy="0" r={layout.extras[index]?.r ?? 22} />
          </clipPath>
        ))}
      </defs>

      <circle className="swarm-ring" cx={hub.x} cy={hub.y} r={layout.ring} />
      {layout.outer && <circle className="swarm-ring swarm-ring--outer" cx={hub.x} cy={hub.y} r={layout.outer} />}

      <line className={`swarm-gate${ownerActive ? ' is-active' : ''}`} x1={owner.x} y1={owner.y + owner.r + 4} x2={hub.x} y2={hub.y - hub.r - 4} />

      {providers.map((provider, index) => {
        const point = layout.agents[index];
        if (!point) return null;
        return (
          <line
            key={`wire-${provider.id}`}
            className={`swarm-wire state-${provider.state}`}
            x1={hub.x} y1={hub.y} x2={point.x} y2={point.y}
            strokeWidth={wireWidth(provider.calls.last7d)}
          />
        );
      })}

      <g className="swarm-hub" transform={`translate(${hub.x} ${hub.y})`}>
        <circle r={hub.r + 6} className="swarm-hub__glow" />
        <circle r={hub.r} className="swarm-hub__disc" />
        <text className="swarm-hub__name" y={-2} textAnchor="middle">AutoSwarm</text>
        <text className="swarm-hub__sub" y={13} textAnchor="middle">{providers.length} agents</text>
      </g>

      <g className={`swarm-owner${ownerActive ? ' is-active' : ''}`} transform={`translate(${owner.x} ${owner.y})`}>
        {ownerActive && <circle r={owner.r + 8} className="swarm-node__pulse" />}
        <circle r={owner.r} className="swarm-owner__disc" />
        <text className="swarm-owner__initials" y={4} textAnchor="middle">{monogram(ownerName)}</text>
        <text className="swarm-node__name" x={owner.r + 10} y={-2}>{short(ownerName, 18)}</text>
        <text className="swarm-node__status" x={owner.r + 10} y={12}>{ownerActive ? `${ownerTitle} · ${waiting} waiting` : ownerTitle}</text>
      </g>

      {extras.map((extra, index) => {
        const point = layout.extras[index];
        if (!point) return null;
        const active = selection?.kind === 'extra' && selection.id === extra.id;
        return (
          <g
            key={`extra-${extra.id}`}
            className={`swarm-node swarm-node--extra${active ? ' is-selected' : ''}`}
            transform={`translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`}
            tabIndex={0}
            role="button"
            aria-pressed={active}
            aria-label={`${extra.name}, outside AutoSwarm${extra.role ? `, ${extra.role}` : ''}`}
            onClick={() => onSelect(active ? null : { kind: 'extra', id: extra.id })}
            onKeyDown={(event) => activate(event, () => onSelect(active ? null : { kind: 'extra', id: extra.id }))}
          >
            <circle r={point.r + 3} className="swarm-node__ring swarm-node__ring--dashed" />
            <circle r={point.r} className="swarm-node__disc" />
            <image href={PORTRAITS[extra.cat]} x={-point.r} y={-point.r} width={point.r * 2} height={point.r * 2} clipPath={`url(#swarm-clip-x-${extra.id})`} preserveAspectRatio="xMidYMid slice" />
            <text className="swarm-node__name" y={point.r + 16} textAnchor="middle">{short(extra.name, 16)}</text>
            <text className="swarm-node__status" y={point.r + 28} textAnchor="middle">outside AutoSwarm</text>
          </g>
        );
      })}

      {providers.map((provider, index) => {
        const point = layout.agents[index];
        if (!point) return null;
        const meta = STATE_META[provider.state];
        const active = selection?.kind === 'provider' && selection.id === provider.id;
        const pulsing = provider.state === 'running' || provider.state === 'waiting';
        const dot = point.r * 0.72;
        return (
          <g
            key={provider.id}
            className={`swarm-node state-${provider.state}${active ? ' is-selected' : ''}`}
            transform={`translate(${point.x.toFixed(1)} ${point.y.toFixed(1)})`}
            tabIndex={0}
            role="button"
            aria-pressed={active}
            aria-label={`${provider.name}, ${meta.label}${provider.role ? `, ${provider.role}` : ''}`}
            onClick={() => onSelect(active ? null : { kind: 'provider', id: provider.id })}
            onKeyDown={(event) => activate(event, () => onSelect(active ? null : { kind: 'provider', id: provider.id }))}
            style={{ color: meta.color }}
          >
            {pulsing && <circle r={point.r + 9} className="swarm-node__pulse" />}
            <circle r={point.r + 9} className="swarm-node__halo" />
            <circle r={point.r + 3} className="swarm-node__ring" />
            <circle r={point.r} className="swarm-node__disc" />
            <image href={PORTRAITS[provider.cat]} x={-point.r} y={-point.r} width={point.r * 2} height={point.r * 2} clipPath={`url(#swarm-clip-${provider.id})`} preserveAspectRatio="xMidYMid slice" className={provider.state === 'off' ? 'is-off' : undefined} />
            <circle cx={dot} cy={dot} r={6} className="swarm-node__dot" />
            <text className="swarm-node__name" y={point.r + 18} textAnchor="middle">{short(provider.name, 18)}</text>
            <text className="swarm-node__status" y={point.r + 31} textAnchor="middle">{short(statusLine(provider), 30)}</text>
          </g>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------

interface InspectorProps {
  snapshot: SwarmSnapshot;
  provider: SwarmProvider;
  sessionsThisWeek: number | null;
  sample: boolean;
  now: number;
  onClose: () => void;
  onCopy: (command: string, label: string) => void;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return <div className="swarm-dl__row"><dt>{label}</dt><dd>{children}</dd></div>;
}

function probeSummary(provider: SwarmProvider, now: number): string {
  const probe = provider.evidence.probe;
  if (!probe) return 'No probe recorded';
  const when = ago(probe.at, now);
  if (probe.status === 'verified') return `Verified ${when}`;
  if (probe.status === 'running') return `Running since ${when}`;
  if (probe.status === 'reply-only') return `Replied ${when}, resume not attempted`;
  if (probe.status === 'resume-failed') return `Replied ${when}, resume failed${probe.errorCode ? `: ${probe.errorCode}` : ''}`;
  return `Failed ${when}${probe.errorCode ? `: ${probe.errorCode}` : ''}`;
}

function executableLabel(provider: SwarmProvider): string {
  if (provider.command.executable === 'found') return 'Found';
  if (provider.command.executable === 'not-found') return 'Not on the helper PATH';
  return 'Unknown';
}

function ProviderInspector({ snapshot, provider, sessionsThisWeek, sample, now, onClose, onCopy }: InspectorProps) {
  const meta = STATE_META[provider.state];
  const lastCall = snapshot.calls.find((call) => call.provider === provider.id) ?? null;
  const approvals = snapshot.approvals.filter((item) => item.provider === provider.id);
  return (
    <Card className="swarm-inspector" accent={meta.color}>
      <div className="swarm-inspector__head">
        <img src={PORTRAITS[provider.cat]} alt="" width={52} height={52} className="swarm-portrait" />
        <div className="swarm-inspector__title">
          <h3>{provider.name}</h3>
          <p>{provider.name === provider.label ? provider.id : `${provider.label} · ${provider.id}`}</p>
        </div>
        <Button variant="ghost" size="sm" icon label="Close details" onClick={onClose}><X size={14} aria-hidden="true" /></Button>
      </div>
      <Badge tone={meta.tone} dot>{meta.label}</Badge>
      {(provider.role || provider.note) && (
        <p className="swarm-inspector__note">{[provider.role, provider.note].filter(Boolean).join('. ')}</p>
      )}
      <dl className="swarm-dl">
        <Row label="Command"><span className="swarm-mono">{provider.command.binary}</span> · {executableLabel(provider)}{provider.command.overridden ? ' · set in config.json' : ''}</Row>
        <Row label="AutoSwarm skill">{provider.hostInstalled ? 'Installed in this agent' : 'Not installed in this agent'}</Row>
        <Row label="Calls">{provider.calls.last7d} this week · {provider.calls.total} read</Row>
        <Row label="Last call">{provider.lastCallAt ? `${ago(provider.lastCallAt, now)} · ${CALL_STATUS_META[provider.lastStatus ?? 'unknown'].label}` : 'None'}</Row>
        <Row label="Meow Ops sessions">
          {provider.meowSource
            ? sessionsThisWeek === null ? 'Unavailable' : `${sessionsThisWeek} in 7 days · ${sourceLabel(provider.meowSource)}${sample ? ' · sample data' : ' · newest 1,000'}`
            : 'Not tracked by Meow Ops'}
        </Row>
        {(provider.model || provider.effort) && <Row label="Default">{[provider.model, provider.effort].filter(Boolean).join(' · ')}</Row>}
      </dl>
      <div className="swarm-evidence">
        <div><span className="mo-eyebrow">Reply</span><Evidence value={provider.evidence.reply} /></div>
        <div><span className="mo-eyebrow">Native resume</span><Evidence value={provider.evidence.resume} /></div>
        <div><span className="mo-eyebrow">Approval relay</span><Evidence value={provider.evidence.approvalRelay} /></div>
      </div>
      <p className="swarm-muted">{probeSummary(provider, now)}</p>
      {approvals.length > 0 && <ApprovalList approvals={approvals} providers={snapshot.providers} now={now} onCopy={onCopy} />}
      <div className="swarm-stack">
        <span className="mo-eyebrow">Commands</span>
        <CommandLine label="probe command" command={probeCommand([provider.id], snapshot.workspace)} note="Verify: one reply and one native resume. Spends model calls." onCopy={onCopy} />
        <CommandLine label="check command" command={checkCommand([provider.id])} note="Free: finds the binary. Proves nothing about login." onCopy={onCopy} />
        {lastCall && <CommandLine label="inspect command" command={inspectCommand(lastCall.id)} onCopy={onCopy} />}
      </div>
    </Card>
  );
}

function ExtraInspector({ extra, sessionsThisWeek, sample, onClose }: { extra: SwarmExtra; sessionsThisWeek: number | null; sample: boolean; onClose: () => void }) {
  return (
    <Card className="swarm-inspector">
      <div className="swarm-inspector__head">
        <img src={PORTRAITS[extra.cat]} alt="" width={52} height={52} className="swarm-portrait" />
        <div className="swarm-inspector__title">
          <h3>{extra.name}</h3>
          <p>{extra.where ?? 'Outside AutoSwarm'}</p>
        </div>
        <Button variant="ghost" size="sm" icon label="Close details" onClick={onClose}><X size={14} aria-hidden="true" /></Button>
      </div>
      <Badge tone="neutral">Outside AutoSwarm</Badge>
      {(extra.role || extra.note) && <p className="swarm-inspector__note">{[extra.role, extra.note].filter(Boolean).join('. ')}</p>}
      <dl className="swarm-dl">
        <Row label="Meow Ops sessions">
          {extra.meowSource
            ? sessionsThisWeek === null ? 'Unavailable' : `${sessionsThisWeek} in 7 days · ${sourceLabel(extra.meowSource)}${sample ? ' · sample data' : ' · newest 1,000'}`
            : 'Not tracked by Meow Ops'}
        </Row>
      </dl>
      <p className="swarm-muted">Listed in your roster. AutoSwarm cannot call it, so nothing here is verified.</p>
    </Card>
  );
}

function ApprovalList({ approvals, providers, now, onCopy }: { approvals: readonly SwarmApproval[]; providers: readonly SwarmProvider[]; now: number; onCopy: (command: string, label: string) => void }) {
  const nameOf = (id: string) => providers.find((provider) => provider.id === id)?.name ?? id;
  return (
    <ul className="swarm-approvals">
      {approvals.map((approval) => (
        <li key={`${approval.callId}:${approval.requestId}`}>
          <div className="swarm-approvals__head">
            <strong>{nameOf(approval.provider)}</strong>
            <span className="swarm-muted">{approval.kind === 'question' ? 'Question' : 'Permission'} · {ago(approval.createdAt, now)}</span>
          </div>
          <p>{approval.title}</p>
          {approval.kind === 'permission' ? (
            <div className="swarm-approvals__actions">
              <Button size="sm" onClick={() => onCopy(decisionCommand(approval.callId, approval.requestId, true), 'approve command')}><Copy size={12} aria-hidden="true" />Copy approve</Button>
              <Button size="sm" onClick={() => onCopy(decisionCommand(approval.callId, approval.requestId, false), 'deny command')}><Copy size={12} aria-hidden="true" />Copy deny</Button>
            </div>
          ) : (
            <p className="swarm-muted">If a Swarm run started it, answer it in Swarm · Runs. Otherwise answer it in the agent that asked, or with <span className="swarm-mono">autoswarm answer</span>.</p>
          )}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------

export default function Swarm({ sessions = [], sessionsAreSample = false }: SwarmProps) {
  const [local] = useState(isLocalSwarmSurface);
  const [snapshot, setSnapshot] = useState<SwarmSnapshot | null>(local ? null : SAMPLE_SWARM);
  const [loading, setLoading] = useState(local);
  const [error, setError] = useState<string | null>(null);
  const [selection, setSelection] = useState<Selection>(null);
  const [showAll, setShowAll] = useState(false);
  const [message, setMessage] = useState('');
  const [now, setNow] = useState(() => (local ? Date.now() : Date.parse(SAMPLE_SWARM.generatedAt)));
  const reducedMotion = usePrefersReducedMotion();
  const sample = !local;

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    try {
      const next = await fetchSwarmSnapshot(signal);
      if (signal?.aborted) return;
      setSnapshot(next);
      setNow(Date.now());
      setError(null);
    } catch (reason) {
      if (signal?.aborted) return;
      setError(reason instanceof Error ? reason.message : 'AutoSwarm receipts are unavailable.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!local) return undefined;
    const controller = new AbortController();
    void load(controller.signal);
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(controller.signal);
    }, REFRESH_MS);
    return () => { controller.abort(); window.clearInterval(timer); };
  }, [local, load]);

  useEffect(() => {
    function onKey(event: KeyboardEvent) { if (event.key === 'Escape') setSelection(null); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const copy = useCallback(async (command: string, label: string) => {
    try { await navigator.clipboard.writeText(command); setMessage(`Copied the ${label}. Run it in your terminal.`); }
    catch { setMessage('Clipboard unavailable. Select the command to copy it.'); }
  }, []);

  const weekCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const session of sessions) {
      const at = Date.parse(session.started_at ?? session.ended_at ?? '');
      if (!session.source || !Number.isFinite(at) || at < now - WEEK_MS) continue;
      counts.set(session.source, (counts.get(session.source) ?? 0) + 1);
    }
    return counts;
  }, [sessions, now]);
  const sessionsKnown = sessions.length > 0 && (sample || !sessionsAreSample);
  const sessionsFor = (source: string | null) => (source && sessionsKnown ? weekCounts.get(source) ?? 0 : null);

  if (!snapshot) {
    if (error) {
      return <EmptyState title="AutoSwarm receipts unavailable" body={error} action={<Button onClick={() => { void load(); }}>Retry</Button>} />;
    }
    return <p className="swarm-muted" role="status">Reading AutoSwarm receipts…</p>;
  }

  const providers = visibleProviders(snapshot, showAll);
  const hiddenCount = snapshot.providers.filter((provider) => !provider.hidden).length - providers.length;
  const extras = snapshot.extras;
  const ownerName = snapshot.owner?.name ?? 'You';
  const ownerTitle = snapshot.owner?.title ?? 'approval gate';
  const toVerify = providers.filter((provider) => provider.state !== 'off' && provider.evidence.probe?.status !== 'verified').map((provider) => provider.id);
  const statesPresent = [...new Set(providers.map((provider) => provider.state))] as SwarmState[];
  const selectedProvider = selection?.kind === 'provider' ? snapshot.providers.find((provider) => provider.id === selection.id) ?? null : null;
  const selectedExtra = selection?.kind === 'extra' ? extras.find((extra) => extra.id === selection.id) ?? null : null;
  const scopeTail = sample ? 'sample data' : snapshot.coverage.truncated ? `newest ${snapshot.coverage.scanned} receipts` : 'all receipts';
  const nameOf = (id: string) => snapshot.providers.find((provider) => provider.id === id)?.name ?? id;
  const recent = snapshot.calls.slice(0, 12);
  const newModels = providers.flatMap((provider) => (provider.models?.models ?? []).filter((model) => model.new).map((model) => ({ harness: provider.name, model: model.id })));

  return (
    <div className="swarm">
      {sample && (
        <Notice action={<a className="mo-btn" href={LOCAL_URL}>Open local dashboard</a>}>
          <strong>Sample data</strong>. AutoSwarm receipts stay on your Mac. This is an example team.
        </Notice>
      )}
      {error && <Notice>{error} The last good read stays below.</Notice>}
      {snapshot.overlay.error && <Notice>Roster file ignored: {snapshot.overlay.error} Fix {snapshot.overlay.path} to rename the team.</Notice>}
      {!sample && !snapshot.autoswarm.exists && (
        <EmptyState
          title="AutoSwarm is not installed on this Mac"
          body="Meow Ops reads the receipts AutoSwarm writes for every delegated call. Install it once from your agent of choice, then verify which agents answer. The binaries below were found on this Mac without it."
          command={AUTOSWARM_INSTALL_COMMAND}
        />
      )}

      <div className="swarm-toolbar">
        <span className="swarm-pill">Read only · commands run in your terminal</span>
        <span className="swarm-muted" role="status">{loading ? 'Reading receipts…' : sample ? 'Example team' : `Read ${ago(snapshot.generatedAt, now)}`}</span>
        <span className="swarm-toolbar__spacer" />
        {(hiddenCount > 0 || showAll) && (
          <Button size="sm" variant="ghost" onClick={() => setShowAll((value) => !value)}>
            {showAll ? 'Show found agents only' : `Show all ${snapshot.providers.filter((provider) => !provider.hidden).length}`}
          </Button>
        )}
        {local && (
          <Button size="sm" onClick={() => { void load(); }} disabled={loading}>
            <RefreshCw size={12} aria-hidden="true" className={loading ? 'loop-spin' : undefined} />Refresh
          </Button>
        )}
      </div>

      <div className="swarm-tiles">
        <StatTile label="Verified agents" value={`${snapshot.totals.verified} of ${snapshot.totals.found}`} scope={<span className="mo-scope">Reply and native resume proven · {scopeTail}</span>} {...(snapshot.totals.verified ? { tone: 'var(--green)' } : null)} />
        <StatTile label="Working now" value={snapshot.totals.running} scope={<span className="mo-scope">Live receipts, runner alive · {sample ? 'sample data' : 'now'}</span>} />
        <StatTile label="Waiting on you" value={snapshot.totals.waiting} scope={<span className="mo-scope">Pending native approvals · {sample ? 'sample data' : 'now'}</span>} {...(snapshot.totals.waiting ? { tone: 'var(--amber)' } : null)} />
        <StatTile label="Calls this week" value={snapshot.totals.calls7d} sub={`${snapshot.totals.failed7d} failed or interrupted`} scope={<span className="mo-scope">7 days · AutoSwarm · {scopeTail}</span>} />
      </div>

      {message && <p className="swarm-message" role="status">{message}</p>}

      <div className="swarm-grid">
        <Card pad={false} className="swarm-orbit-card">
          <div className="swarm-orbit-card__head">
            <span className="mo-eyebrow">Orbit</span>
            <span className="swarm-muted">Select an agent for evidence and commands</span>
          </div>
          {providers.length === 0 && extras.length === 0 ? (
            <EmptyState
              title="No agents found yet"
              body="AutoSwarm has no receipts and none of its agent binaries are on the helper PATH. Show all to see the twelve it can call."
              command={checkCommand(['codex', 'claude-code', 'cursor', 'hermes', 'dsh'])}
            />
          ) : (
            <Orbit
              providers={providers}
              extras={extras}
              selection={selection}
              onSelect={setSelection}
              ownerName={ownerName}
              ownerTitle={ownerTitle}
              waiting={snapshot.totals.waiting}
              reducedMotion={reducedMotion}
            />
          )}
          <ul className="swarm-roster" aria-label="Agents">
            {providers.map((provider) => {
              const active = selection?.kind === 'provider' && selection.id === provider.id;
              return (
                <li key={provider.id}>
                  <button type="button" aria-pressed={active} className={`swarm-roster__item${active ? ' is-selected' : ''}`} onClick={() => setSelection(active ? null : { kind: 'provider', id: provider.id })}>
                    <img src={PORTRAITS[provider.cat]} alt="" width={28} height={28} />
                    <span className="swarm-roster__name">{provider.name}</span>
                    <span className="swarm-roster__state" style={{ color: STATE_META[provider.state].color }}>{statusLine(provider)}</span>
                  </button>
                </li>
              );
            })}
            {extras.map((extra) => {
              const active = selection?.kind === 'extra' && selection.id === extra.id;
              return (
                <li key={extra.id}>
                  <button type="button" aria-pressed={active} className={`swarm-roster__item${active ? ' is-selected' : ''}`} onClick={() => setSelection(active ? null : { kind: 'extra', id: extra.id })}>
                    <img src={PORTRAITS[extra.cat]} alt="" width={28} height={28} />
                    <span className="swarm-roster__name">{extra.name}</span>
                    <span className="swarm-roster__state">outside AutoSwarm</span>
                  </button>
                </li>
              );
            })}
          </ul>
          <ul className="swarm-legend" aria-label="States">
            {statesPresent.map((state) => (
              <li key={state}><span className="swarm-legend__dot" style={{ background: STATE_META[state].color }} />{STATE_META[state].label}</li>
            ))}
            {extras.length > 0 && <li><span className="swarm-legend__dot swarm-legend__dot--ring" />Outside AutoSwarm</li>}
          </ul>
        </Card>

        <aside className="swarm-side" aria-label="Details">
          {selectedProvider ? (
            <ProviderInspector snapshot={snapshot} provider={selectedProvider} sessionsThisWeek={sessionsFor(selectedProvider.meowSource)} sample={sample} now={now} onClose={() => setSelection(null)} onCopy={copy} />
          ) : selectedExtra ? (
            <ExtraInspector extra={selectedExtra} sessionsThisWeek={sessionsFor(selectedExtra.meowSource)} sample={sample} onClose={() => setSelection(null)} />
          ) : (
            <>
              <Card>
                <span className="mo-eyebrow">Waiting on you</span>
                {snapshot.approvals.length ? (
                  <ApprovalList approvals={snapshot.approvals} providers={snapshot.providers} now={now} onCopy={copy} />
                ) : (
                  <p className="swarm-muted">Nothing is waiting on you.{snapshot.autoswarm.delegateApprovals.value ? ' Approvals go to the agent that delegated first.' : ''}</p>
                )}
              </Card>
              {toVerify.length > 0 && (
                <Card>
                  <span className="mo-eyebrow">Verify the team</span>
                  <p className="swarm-side__lead">{toVerify.length === 1 ? 'One agent is' : `${toVerify.length} agents are`} found but not proven to reply and resume: {toVerify.map(nameOf).join(', ')}.</p>
                  <CommandLine label="probe command" command={probeCommand(toVerify, snapshot.workspace)} note={`Spends model calls: one reply and one native resume per agent.${snapshot.workspace ? ` Workspace from ${snapshot.workspaceSource === 'swarm.json' ? 'your roster' : 'the latest call'}.` : ' Run it inside the project you want them to see.'}`} onCopy={copy} />
                </Card>
              )}
              <Card>
                <span className="mo-eyebrow">AutoSwarm skill</span>
                <ul className="swarm-entry">
                  {snapshot.autoswarm.entryPoints.filter((point) => point.installed).map((point) => {
                    const present = point.hosts.filter((id) => snapshot.providers.some((provider) => provider.id === id && provider.state !== 'off'));
                    const hosts = present.length ? present : point.hosts;
                    return <li key={point.path}><strong>{hosts.map(nameOf).join(', ')}</strong><span className="swarm-mono">{point.path}{point.hosts.length > 1 ? ' · shared folder' : ''}</span></li>;
                  })}
                  {!snapshot.autoswarm.entryPoints.some((point) => point.installed) && <li className="swarm-muted">Not installed in any agent yet. Ask an agent to install AutoSwarm for itself.</li>}
                </ul>
              </Card>
            </>
          )}
        </aside>
      </div>

      <Card pad={false}>
        <div className="swarm-section-head">
          <span className="mo-eyebrow">Verification</span>
          <span className="swarm-muted">What AutoSwarm has proven for each agent</span>
        </div>
        <div className="swarm-table-scroll" tabIndex={0} role="region" aria-label="Verification by agent">
          <table className="swarm-table">
            <thead>
              <tr>
                <th scope="col">Agent</th><th scope="col">Command</th><th scope="col">Reply</th><th scope="col">Native resume</th>
                <th scope="col">Approval relay</th><th scope="col">Last probe</th><th scope="col" className="mo-num">Calls, 7 days</th>
              </tr>
            </thead>
            <tbody>
              {providers.map((provider) => (
                <tr key={provider.id} className={selection?.kind === 'provider' && selection.id === provider.id ? 'is-selected' : undefined}>
                  <th scope="row">
                    <button type="button" className="swarm-link" onClick={() => setSelection({ kind: 'provider', id: provider.id })}>{provider.name}</button>
                    <small>{STATE_META[provider.state].label}</small>
                  </th>
                  <td><span className="swarm-mono">{provider.command.binary}</span><small>{executableLabel(provider)}</small></td>
                  <td><Evidence value={provider.evidence.reply} /></td>
                  <td><Evidence value={provider.evidence.resume} /></td>
                  <td><Evidence value={provider.evidence.approvalRelay} /></td>
                  <td>{probeSummary(provider, now)}</td>
                  <td className="mo-num">{provider.calls.last7d}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="swarm-foot">A completed reply is the only proof of login: an empty native login list does not mean login is needed, and a version check only proves the binary exists.</p>
      </Card>

      <Card pad={false}>
        <div className="swarm-section-head">
          <span className="mo-eyebrow">Models by harness</span>
          <span className="swarm-muted">Learned from evidence, re-read on every refresh</span>
        </div>
        {newModels.length > 0 && (
          <p className="swarm-newmodels" role="status">New since last week: {newModels.map((item) => `${item.model} on ${item.harness}`).join(', ')}.</p>
        )}
        <div className="swarm-table-scroll" tabIndex={0} role="region" aria-label="Models by harness">
          <table className="swarm-table">
            <thead><tr><th scope="col">Harness</th><th scope="col">Models seen</th><th scope="col">Effort override</th></tr></thead>
            <tbody>
              {providers.map((provider) => {
                const catalog = provider.models;
                const effort = catalog?.effort.supported;
                return (
                  <tr key={provider.id}>
                    <th scope="row">{provider.name}<small>{provider.label === provider.name ? provider.id : provider.label}</small></th>
                    <td>
                      {catalog && catalog.models.length ? (
                        <ul className="swarm-models">
                          {catalog.models.slice(0, 8).map((model) => (
                            <li key={model.id} title={`First seen ${model.firstSeen ? new Date(model.firstSeen).toLocaleDateString() : 'unknown'}${model.accepted ? ` · accepted ${model.accepted}x by AutoSwarm` : ''}${model.rejected ? ` · rejected ${model.rejected}x` : ''}`}>
                              <span className="swarm-mono">{model.id}</span>
                              {model.default && <Badge tone="accent">default</Badge>}
                              {model.new && <Badge tone="positive">new</Badge>}
                              {model.rejected > 0 && <Badge tone="danger">rejected</Badge>}
                              <small>{model.sources.join(' · ')}</small>
                            </li>
                          ))}
                        </ul>
                      ) : <span className="swarm-muted">{catalog ? 'None seen yet. The harness uses its native default.' : 'This helper predates the model catalog.'}</span>}
                    </td>
                    <td>
                      {effort === true ? <Badge tone="positive" dot>Accepted</Badge> : effort === false ? <Badge tone="danger" dot>Rejected</Badge> : <Badge tone="neutral" dot>Untested</Badge>}
                      {catalog?.effort.evidence && <small className="swarm-mono">{catalog.effort.evidence}</small>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="swarm-foot">AutoSwarm keeps no model list on purpose. A model shows up here when the harness's own settings name it, when a session Meow Ops parsed ran it, when a delegated call asked for it, or when you pin it in swarm.json. The first sighting is flagged new for 7 days. Effort is proven only by a call that set it and finished.</p>
      </Card>

      <Card pad={false}>
        <div className="swarm-section-head">
          <span className="mo-eyebrow">Recent calls</span>
          <span className="swarm-muted">{recent.length ? `Latest ${recent.length} of ${snapshot.totals.callsScanned} read` : 'No delegated calls yet'}</span>
        </div>
        {recent.length > 0 && (
          <div className="swarm-table-scroll" tabIndex={0} role="region" aria-label="Recent AutoSwarm calls">
            <table className="swarm-table">
              <thead>
                <tr><th scope="col">When</th><th scope="col">Agent</th><th scope="col">What</th><th scope="col">Status</th><th scope="col">Workspace</th><th scope="col" className="mo-num">Took</th></tr>
              </thead>
              <tbody>
                {recent.map((call) => (
                  <tr key={call.id}>
                    <td className="swarm-nowrap">{ago(call.createdAt, now)}</td>
                    <td className="swarm-nowrap">{nameOf(call.provider)}</td>
                    <td className="swarm-what">{call.snippet ?? CALL_KIND_LABEL[call.kind]}{call.errorCode && call.status !== 'completed' ? <small>{call.errorCode}</small> : null}</td>
                    <td><Badge tone={CALL_STATUS_META[call.status].tone} dot>{CALL_STATUS_META[call.status].label}</Badge></td>
                    <td className="swarm-nowrap">{call.workspaceName ?? 'Unavailable'}</td>
                    <td className="mo-num swarm-nowrap">{call.status === 'running' ? 'Running' : duration(call.durationMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <p className="swarm-foot">
        Receipts: <span className="swarm-mono">{snapshot.autoswarm.home}</span> · {snapshot.coverage.scanned} of {snapshot.coverage.callDirectories} calls read{snapshot.coverage.truncated ? ', older receipts not read' : ''}{snapshot.coverage.unreadable ? ` · ${snapshot.coverage.unreadable} unreadable` : ''}.
        {' '}Roster: {snapshot.overlay.loaded ? <span className="swarm-mono">{snapshot.overlay.path}</span> : <>none. Copy <span className="swarm-mono">examples/swarm.example.json</span> to <span className="swarm-mono">~/.meow-ops/swarm.json</span> to name your team.</>}
      </p>
    </div>
  );
}
