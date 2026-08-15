import { useState, useMemo } from 'react';
import { Activity, Zap, DollarSign, FolderKanban, TrendingUp, TrendingDown, Minus, SquareCode, Code2, Pencil, Check, X, Clock } from 'lucide-react';
import StatCard from '../components/StatCard';
import DailyChart from '../components/DailyChart';
import ToolBreakdown from '../components/ToolBreakdown';
import SpendChart from '../components/SpendChart';
import { Eyebrow } from '../components/ui/Eyebrow';
import { ToggleGroup } from '../components/ui/ToggleGroup';
import { formatTokens, formatCost, formatDuration } from '../lib/format';
import {
  computeOverviewStats,
  computeSpendBreakdown,
  computeTimeSpentBreakdown,
  getToolBreakdownFromSessions,
  buildDailyFromSessions,
} from '../lib/queries';

// ─── Source filter toggle ─────────────────────────────────────────────────────
const SOURCE_OPTIONS = [
  { value: 'both',        label: 'All' },
  { value: 'claude',      label: '◆ Claude' },
  { value: 'codex',       label: '⬡ Codex' },
  { value: 'cursor',      label: '▣ Cursor' },
  { value: 'aider',       label: '◇ Aider' },
  { value: 'antigravity', label: '✦ Antigravity' },
  { value: 'hermes',      label: 'H Hermes' },
];

const SOURCE_META = {
  claude:      { label: 'Claude',      sigil: '◆', color: 'var(--accent)' },
  codex:       { label: 'Codex',       sigil: '⬡', color: 'oklch(0.65 0.18 260)' },
  cursor:      { label: 'Cursor',      sigil: '▣', color: 'var(--cyan)' },
  aider:       { label: 'Aider',       sigil: '◇', color: 'var(--amber)' },
  antigravity: { label: 'Antigravity', sigil: '✦', color: 'oklch(0.70 0.17 150)' },
  hermes:      { label: 'Hermes',      sigil: 'H', color: 'oklch(0.72 0.16 70)' },
};

function sourceMeta(src) {
  if (SOURCE_META[src]) return SOURCE_META[src];
  const label = String(src || 'unknown').replace(/^\w/, (c) => c.toUpperCase());
  return { label, sigil: '•', color: 'var(--text-secondary)' };
}

function sourceDisplay(src) {
  const meta = sourceMeta(src);
  return `${meta.sigil} ${meta.label}`;
}

function safeMetric(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : 0;
}

function CursorAggregateUsagePanel({ usage }) {
  if (!usage) return null;

  const totals = usage.unmatched?.totals || {};
  const models = Array.isArray(usage.unmatched?.by_model) ? usage.unmatched.by_model : [];
  const unmatchedEvents = safeMetric(usage.unmatched_events ?? totals.events);
  const matchedSessions = safeMetric(usage.matched_sessions);
  const matchedEvents = safeMetric(usage.matched_events);
  const enabled = usage.enabled === true;

  return (
    <div style={{
      marginBottom: 24,
      padding: '14px 16px',
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 10 }}>
        <div>
          <Eyebrow>Cursor Admin Usage</Eyebrow>
          <div style={{ marginTop: 5, fontSize: 11, color: 'var(--text-muted)' }}>
            Unmatched usage is reported by model but is not assigned to a local session.
          </div>
        </div>
        <span style={{ fontSize: 11, color: enabled ? 'var(--green)' : 'var(--text-muted)' }}>
          {enabled ? 'Admin API enabled' : 'Admin API off'} · {usage.status || 'unknown'}
        </span>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))',
        gap: 10,
        marginBottom: models.length > 0 ? 12 : 0,
      }}>
        <div><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Matched</span><div>{matchedSessions} sessions · {matchedEvents} events</div></div>
        <div><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Unmatched</span><div>{unmatchedEvents} events</div></div>
        <div><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Unmatched tokens</span><div>{formatTokens(safeMetric(totals.total_tokens))}</div></div>
        <div><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Unmatched cost</span><div style={{ color: 'var(--green)' }}>{formatCost(safeMetric(totals.estimated_cost_usd))}</div></div>
      </div>

      {models.length > 0 ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {models.map((row) => (
            <div key={String(row.key || 'unknown')} style={{
              padding: '7px 10px',
              background: 'var(--bg-hover)',
              borderRadius: 8,
              fontSize: 11,
            }}>
              <span style={{ color: 'var(--cyan)' }}>{String(row.key || 'unknown')}</span>
              <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                {formatTokens(safeMetric(row.total_tokens))} · {formatCost(safeMetric(row.estimated_cost_usd))}
              </span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {enabled ? 'No unmatched model usage was returned.' : 'Local Cursor sessions remain available without an Admin API key.'}
        </div>
      )}
    </div>
  );
}

function formatReportedCost(cost, available) {
  if (available !== true) return 'unavailable';
  return formatCost(safeMetric(cost));
}

function LocalUsageReceiptPanel({ usage }) {
  if (!usage || usage.status === 'skipped') return null;

  const totals = usage.totals || {};
  const machines = Array.isArray(usage.by_machine) ? usage.by_machine : [];
  const harnesses = Array.isArray(usage.by_harness) ? usage.by_harness : [];
  const providers = Array.isArray(usage.by_provider) ? usage.by_provider : [];
  const models = Array.isArray(usage.by_model) ? usage.by_model : [];
  const unmatchedModels = Array.isArray(usage.unmatched?.by_model) ? usage.unmatched.by_model : [];

  return (
    <div style={{
      marginBottom: 24,
      padding: '14px 16px',
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 10 }}>
        <div>
          <Eyebrow>Local Usage Receipts</Eyebrow>
          <div style={{ marginTop: 5, fontSize: 11, color: 'var(--text-muted)' }}>
            Sanitized receipts imported from other computers. Installed model lists are not usage. Unmatched receipts stay as aggregates.
          </div>
        </div>
        <span style={{ fontSize: 11, color: usage.status === 'ok' || usage.status === 'partial' ? 'var(--green)' : 'var(--text-muted)' }}>
          {usage.status || 'unknown'} · {safeMetric(usage.accepted)} accepted
        </span>
      </div>

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))',
        gap: 10,
        marginBottom: 12,
      }}>
        <div><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Machines</span><div>{machines.length}</div></div>
        <div><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Matched</span><div>{safeMetric(usage.matched_sessions)} sessions · {safeMetric(usage.matched_receipts)} receipts</div></div>
        <div><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Unmatched</span><div>{safeMetric(usage.unmatched_receipts)} receipts</div></div>
        <div><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Tokens</span><div>{formatTokens(safeMetric(totals.total_tokens))}</div></div>
        <div><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Source-reported cost</span><div style={{ color: 'var(--green)' }}>{formatReportedCost(totals.cost_usd, totals.cost_available)}</div></div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: models.length > 0 || unmatchedModels.length > 0 ? 10 : 0 }}>
        {machines.map((row) => (
          <div key={`machine-${row.key}`} style={{ padding: '7px 10px', background: 'var(--bg-hover)', borderRadius: 8, fontSize: 11 }}>
            <span style={{ color: 'var(--cyan)' }}>{String(row.key)}</span>
            <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
              machine · {formatTokens(safeMetric(row.total_tokens))}
            </span>
          </div>
        ))}
        {harnesses.map((row) => (
          <div key={`harness-${row.key}`} style={{ padding: '7px 10px', background: 'var(--bg-hover)', borderRadius: 8, fontSize: 11 }}>
            <span style={{ color: 'var(--amber)' }}>{String(row.key)}</span>
            <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
              harness · {formatTokens(safeMetric(row.total_tokens))}
            </span>
          </div>
        ))}
        {providers.map((row) => (
          <div key={`provider-${row.key}`} style={{ padding: '7px 10px', background: 'var(--bg-hover)', borderRadius: 8, fontSize: 11 }}>
            <span style={{ color: 'oklch(0.70 0.17 150)' }}>{String(row.key)}</span>
            <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
              provider · {formatTokens(safeMetric(row.total_tokens))}
            </span>
          </div>
        ))}
        {models.map((row) => (
          <div key={`model-${row.key}`} style={{ padding: '7px 10px', background: 'var(--bg-hover)', borderRadius: 8, fontSize: 11 }}>
            <span style={{ color: 'var(--text-primary)' }}>{String(row.key)}</span>
            <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
              model · {formatTokens(safeMetric(row.total_tokens))} · {formatReportedCost(row.cost_usd, row.cost_available)}
            </span>
          </div>
        ))}
      </div>

      {unmatchedModels.length > 0 ? (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Unmatched models stay unassigned:
          {' '}
          {unmatchedModels.map((row) => String(row.key)).join(', ')}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          No identity fields are shown. Unknown cost stays unavailable.
        </div>
      )}
    </div>
  );
}

function HermesModelUsagePanel({ usage }) {
  if (!usage || usage.status === 'not-found') return null;
  const totals = usage.totals || {};
  const models = Array.isArray(usage.by_model) ? usage.by_model : [];

  return (
    <div style={{
      marginBottom: 24,
      padding: '14px 16px',
      background: 'var(--bg-card)',
      border: '1px solid var(--border)',
      borderRadius: 10,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, marginBottom: 10 }}>
        <div>
          <Eyebrow>Hermes Model Usage</Eyebrow>
          <div style={{ marginTop: 5, fontSize: 11, color: 'var(--text-muted)' }}>
            Exact per-model usage reported by Hermes. One session can use more than one model.
          </div>
        </div>
        <span style={{ fontSize: 11, color: usage.status === 'ok' ? 'var(--green)' : 'var(--text-muted)' }}>
          {usage.status === 'ok' ? `${safeMetric(usage.models)} models · ${safeMetric(usage.sessions)} sessions` : 'Usage table unavailable'}
        </span>
      </div>

      {models.length > 0 ? (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(145px, 1fr))', gap: 10, marginBottom: 12 }}>
            <div><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>API calls</span><div>{safeMetric(totals.api_calls).toLocaleString()}</div></div>
            <div><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Tokens</span><div>{formatTokens(safeMetric(totals.total_tokens))}</div></div>
            <div><span style={{ color: 'var(--text-muted)', fontSize: 11 }}>Estimated cost</span><div style={{ color: 'var(--green)' }}>{formatCost(safeMetric(totals.estimated_cost_usd))}</div></div>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {models.map((row) => (
              <div key={row.key} style={{ padding: '7px 10px', background: 'var(--bg-hover)', borderRadius: 8, fontSize: 11 }}>
                <span style={{ color: 'var(--amber)' }}>{row.model}</span>
                <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                  {row.provider} · {safeMetric(row.sessions)} sessions · {formatTokens(safeMetric(row.total_tokens))} · {formatCost(safeMetric(row.estimated_cost_usd))}
                </span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          Hermes sessions remain visible, but this Hermes version did not expose per-model usage rows.
        </div>
      )}
    </div>
  );
}

function SourceToggle({ value, onChange }) {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Source</span>
      <ToggleGroup
        value={value}
        onChange={onChange}
        options={SOURCE_OPTIONS}
        size="sm"
        ariaLabel="Session source"
      />
    </div>
  );
}

// ─── Source comparison panel ──────────────────────────────────────────────────
function SourceComparisonPanel({ allSessions, bySourceAllTime }) {
  const stats = useMemo(() => {
    if (bySourceAllTime?.claude || bySourceAllTime?.codex) {
      const fromRollup = (key) => ({
        sessions: bySourceAllTime[key]?.sessions || 0,
        cost: bySourceAllTime[key]?.cost || 0,
        tokens: bySourceAllTime[key]?.tokens || 0,
        ghosts: bySourceAllTime[key]?.ghost_count || 0,
      });
      return { claude: fromRollup('claude'), codex: fromRollup('codex') };
    }
    const acc = {
      claude: { sessions: 0, cost: 0, tokens: 0, ghosts: 0 },
      codex:  { sessions: 0, cost: 0, tokens: 0, ghosts: 0 },
    };
    allSessions.forEach(s => {
      // This panel compares Claude vs Codex specifically. Don't miscount other
      // sources (cursor/aider/antigravity) as Claude — skip them here.
      const src = s.source === 'codex' ? 'codex' : (!s.source || s.source === 'claude') ? 'claude' : null;
      if (!src) return;
      acc[src].sessions++;
      acc[src].cost   += s.estimated_cost_usd || 0;
      acc[src].tokens += s.total_tokens || 0;
      if (s.is_ghost) acc[src].ghosts++;
    });
    return acc;
  }, [allSessions, bySourceAllTime]);

  const total = stats.claude.sessions + stats.codex.sessions;
  if (total === 0 || stats.codex.sessions === 0) return null;

  const rows = [
    { key: 'claude', label: 'Claude',  sigil: '◆', color: 'var(--accent)',          icon: SquareCode },
    { key: 'codex',  label: 'Codex',   sigil: '⬡', color: 'oklch(0.65 0.18 260)', icon: Code2      },
  ];

  return (
    <div style={{ marginBottom: 24 }}>
      <Eyebrow style={{ marginBottom: 10 }}>Source Breakdown</Eyebrow>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        {rows.map((row) => {
          const { key, label, sigil, color } = row;
          const SourceIcon = row.icon;
          const s   = stats[key];
          const pct = total > 0 ? (s.sessions / total) * 100 : 0;
          const avgCost = s.sessions > 0 ? s.cost / s.sessions : 0;
          const ghostRate = s.sessions > 0 ? (s.ghosts / s.sessions) * 100 : 0;
          return (
            <div key={key} style={{
              background: 'var(--bg-card)',
              border: `1px solid var(--border)`,
              borderRadius: 10,
              padding: '14px 16px',
              borderTop: `2px solid ${color}`,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <SourceIcon size={14} color={color} />
                <span style={{ fontSize: 13, fontWeight: 500, color }}>
                  {sigil} {label}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text-muted)' }}>
                  {pct.toFixed(1)}% of sessions
                </span>
              </div>

              {/* Share bar */}
              <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, marginBottom: 12 }}>
                <div style={{ height: '100%', width: `${pct}%`, background: color,
                  borderRadius: 2, transition: 'width 0.5s ease' }} />
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
                {[
                  { label: 'Sessions',  value: s.sessions.toLocaleString() },
                  { label: 'Tokens',    value: formatTokens(s.tokens) },
                  { label: 'Total Cost',value: formatCost(s.cost), accent: 'var(--green)' },
                  { label: 'Avg/Session',value: formatCost(avgCost) },
                  { label: 'Ghost Rate', value: `${ghostRate.toFixed(1)}%`,
                    accent: ghostRate > 15 ? 'var(--red)' : 'var(--text-muted)' },
                ].map(({ label: lbl, value, accent }) => (
                  <div key={lbl}>
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', textTransform: 'uppercase',
                      letterSpacing: '0.08em', marginBottom: 2 }}>{lbl}</div>
                    <div style={{ fontSize: 13, fontWeight: 300, color: accent ?? 'var(--text-primary)' }}>
                      {value}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Token quota helpers ──────────────────────────────────────────────────────
function fmtTok(n) {
  if (!n) return '0';
  if (n >= 1e9) return `${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return String(n);
}

function parseTok(str) {
  const s = String(str).trim().toUpperCase();
  if (s.endsWith('B')) return parseFloat(s) * 1e9;
  if (s.endsWith('M')) return parseFloat(s) * 1e6;
  if (s.endsWith('K')) return parseFloat(s) * 1e3;
  return parseFloat(s) || 0;
}

// Per-period (week or month) quota row for Overview cards
function QuotaBand({ period, used, budget, color, srcKey, onSetBudget }) {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState('');

  const hasBudget = budget > 0;
  const pct       = hasBudget ? Math.min(100, (used / budget) * 100) : 0;
  const remaining = hasBudget ? budget - used : 0;
  const isOver    = hasBudget && used > budget;

  function commit() {
    const v = parseTok(draft);
    if (v > 0) onSetBudget(srcKey, period, v);
    setEditing(false);
  }

  const periodLabel = period === 'week' ? 'This Week' : 'This Month';

  return (
    <div style={{
      background: 'var(--bg-page)',
      border: `1px solid ${isOver ? 'rgba(248,113,113,0.3)' : 'var(--border)'}`,
      borderRadius: 8,
      padding: '10px 12px',
    }}>
      {/* Header row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {periodLabel}
        </span>
        {editing ? (
          <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <input
              autoFocus
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setEditing(false); }}
              placeholder="e.g. 10B"
              style={{
                width: 64, fontSize: 11, background: 'var(--bg-card)',
                border: '1px solid var(--accent)', borderRadius: 4,
                color: 'var(--text-primary)', padding: '2px 6px', outline: 'none',
              }}
            />
            <button onClick={commit} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--green)', padding: 0 }}>
              <Check size={12} />
            </button>
            <button onClick={() => setEditing(false)} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 0 }}>
              <X size={12} />
            </button>
          </div>
        ) : (
          <button
            onClick={() => { setDraft(hasBudget ? fmtTok(budget) : ''); setEditing(true); }}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: 'var(--text-muted)', padding: 0, display: 'flex', alignItems: 'center', gap: 3,
              fontSize: 10,
            }}
          >
            <Pencil size={10} />
            {hasBudget ? `limit: ${fmtTok(budget)}` : 'set limit'}
          </button>
        )}
      </div>

      {/* Tokens used — large number */}
      <div style={{ fontSize: 22, fontWeight: 300, color: isOver ? '#f87171' : color, lineHeight: 1.1, marginBottom: 6 }}>
        {fmtTok(used)}
        <span style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 400, marginLeft: 4 }}>tokens</span>
      </div>

      {hasBudget ? (
        <>
          {/* Progress bar */}
          <div style={{ height: 4, background: 'var(--border)', borderRadius: 3, marginBottom: 6, overflow: 'hidden' }}>
            <div style={{
              height: '100%', width: `${pct}%`,
              background: isOver ? '#f87171' : color,
              borderRadius: 3, transition: 'width 0.5s ease',
            }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
            <span style={{ color: 'var(--text-muted)' }}>{pct.toFixed(0)}% of {fmtTok(budget)}</span>
            <span style={{ color: isOver ? '#f87171' : 'var(--green)', fontWeight: 500 }}>
              {isOver ? `${fmtTok(used - budget)} over budget` : `${fmtTok(remaining)} left`}
            </span>
          </div>
        </>
      ) : (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
          No limit set — click pencil to add one
        </div>
      )}
    </div>
  );
}

// ─── Token quota panel per connected model/source ─────────────────────────────
function TokenQuotaPanel({ sourceStats, tokenBudget, onBudgetChange }) {
  if (!sourceStats || !tokenBudget) return null;
  const { claude, codex } = sourceStats;
  const totalSess = claude.sessions + codex.sessions;
  if (totalSess === 0) return null;

  const anyBudget = Object.values(tokenBudget).some(b => b.week > 0 || b.month > 0);
  // Show if multi-source OR if user has set any budget
  if (!anyBudget && codex.sessions === 0) return null;

  function handleSet(src, period, value) {
    onBudgetChange({ ...tokenBudget, [src]: { ...tokenBudget[src], [period]: value } });
  }

  const sources = [
    { key: 'claude', label: 'Claude', sigil: '◆', color: 'var(--accent)',          ...claude },
    { key: 'codex',  label: 'Codex',  sigil: '⬡', color: 'oklch(0.65 0.18 260)',   ...codex },
  ].filter(s => s.sessions > 0);

  return (
    <div style={{ marginBottom: 24 }}>
      <Eyebrow style={{ marginBottom: 10 }}>Token Quota</Eyebrow>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${sources.length}, 1fr)`, gap: 12 }}>
        {sources.map(({ key, label, sigil, color, weekTokens, monthTokens, weekSessions, monthSessions }) => {
          const budget = tokenBudget[key] || { week: 0, month: 0 };
          return (
            <div key={key} style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border)',
              borderRadius: 10,
              padding: '14px 16px',
              borderTop: `2px solid ${color}`,
            }}>
              {/* Source header */}
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 12 }}>
                <span style={{ fontSize: 14, fontWeight: 500, color }}>{sigil} {label}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                  {weekSessions} sessions this week · {monthSessions} this month
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <QuotaBand
                  period="week" used={weekTokens} budget={budget.week}
                  color={color} srcKey={key} onSetBudget={handleSet}
                />
                <QuotaBand
                  period="month" used={monthTokens} budget={budget.month}
                  color={color} srcKey={key} onSetBudget={handleSet}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Time spent panel ────────────────────────────────────────────────────────
const TIME_PERIOD_OPTIONS = [
  { value: 'today',     label: 'Today' },
  { value: 'thisWeek',  label: 'Week' },
  { value: 'thisMonth', label: 'Month' },
  { value: 'thisYear',  label: 'Year' },
  { value: 'allTime',   label: 'All' },
];

const TIME_PERIOD_CARDS = [
  { key: 'today',     label: 'Today' },
  { key: 'thisWeek',  label: 'This Week' },
  { key: 'thisMonth', label: 'This Month' },
  { key: 'thisYear',  label: `${new Date().getFullYear()} YTD` },
  { key: 'allTime',   label: 'All Time' },
];

function formatTimeSpent(seconds) {
  if (!seconds || seconds <= 0) return '0m';
  return formatDuration(seconds);
}

function TimeCard({ label, bucket, active }) {
  return (
    <div style={{
      background: 'var(--bg-card)',
      border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: 10,
      padding: '13px 14px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      minWidth: 0,
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <span style={{
          fontSize: 10,
          color: 'var(--text-muted)',
          textTransform: 'uppercase',
          letterSpacing: 1,
          whiteSpace: 'nowrap',
        }}>
          {label}
        </span>
        <Clock size={13} style={{ color: active ? 'var(--accent)' : 'var(--text-muted)', flexShrink: 0 }} />
      </div>
      <span style={{ fontSize: 22, fontWeight: 300, color: 'var(--text-primary)', lineHeight: 1.2 }}>
        {formatTimeSpent(bucket?.duration_seconds ?? 0)}
      </span>
      <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
        {(bucket?.sessions ?? 0).toLocaleString()} sessions
      </span>
    </div>
  );
}

function TimeSpentPanel({ timeSpent, source }) {
  const [period, setPeriod] = useState('thisMonth');
  const bucket = timeSpent?.[period] ?? { duration_seconds: 0, sessions: 0, bySource: {} };
  const totalSeconds = bucket.duration_seconds || 0;
  const sourceRows = Object.entries(bucket.bySource || {})
    .map(([src, d]) => ({ src, ...d, meta: sourceMeta(src) }))
    .sort((a, b) => (b.duration_seconds || 0) - (a.duration_seconds || 0));
  const scopeLabel = source === 'both' ? 'All apps' : sourceDisplay(source);

  return (
    <div style={{ marginBottom: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10 }}>
        <Eyebrow>Time Spent</Eyebrow>
        <ToggleGroup
          value={period}
          onChange={setPeriod}
          options={TIME_PERIOD_OPTIONS}
          size="sm"
          ariaLabel="Time period"
        />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: 12, marginBottom: 12 }}>
        {TIME_PERIOD_CARDS.map(({ key, label }) => (
          <TimeCard key={key} label={label} bucket={timeSpent?.[key]} active={period === key} />
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 0.85fr) minmax(0, 1.75fr)', gap: 12 }}>
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '14px 16px',
        }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 6 }}>
            {scopeLabel}
          </div>
          <div style={{ fontSize: 30, lineHeight: 1.1, color: 'var(--accent)', fontWeight: 300 }}>
            {formatTimeSpent(totalSeconds)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>
            {(bucket.sessions ?? 0).toLocaleString()} sessions · avg {formatTimeSpent(bucket.sessions ? totalSeconds / bucket.sessions : 0)}
          </div>
        </div>

        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border)',
          borderRadius: 10,
          padding: '12px 16px',
        }}>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 10 }}>
            By app
          </div>
          <div style={{ display: 'grid', gap: 9 }}>
            {sourceRows.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>No sessions in this period</div>
            )}
            {sourceRows.map((row) => {
              const seconds = row.duration_seconds || 0;
              const pct = totalSeconds > 0 ? (seconds / totalSeconds) * 100 : 0;
              return (
                <div key={row.src} style={{ display: 'grid', gridTemplateColumns: '110px minmax(0, 1fr) 90px 82px', gap: 10, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: row.meta.color, whiteSpace: 'nowrap' }}>
                    {row.meta.sigil} {row.meta.label}
                  </span>
                  <div style={{ height: 5, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%',
                      width: `${pct}%`,
                      background: row.meta.color,
                      borderRadius: 4,
                      transition: 'width 0.4s var(--ease)',
                    }} />
                  </div>
                  <span style={{ fontSize: 12, color: 'var(--text-primary)', textAlign: 'right' }}>
                    {formatTimeSpent(seconds)}
                  </span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
                    {row.sessions} sessions
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Spend card ───────────────────────────────────────────────────────────────
function SpendCard({ label, current, previous, sessions, tokens, highlight }) {
  const pct = previous > 0 ? ((current - previous) / previous) * 100 : null;
  const up = pct !== null && pct >  0.5;
  const dn = pct !== null && pct < -0.5;
  const TrendIcon = up ? TrendingUp : dn ? TrendingDown : Minus;
  const trendColor = up ? '#f87171' : dn ? 'var(--green)' : 'var(--text-muted)';

  return (
    <div style={{
      background: 'var(--bg-card)',
      border: `1px solid ${highlight ? 'var(--accent)' : 'var(--border)'}`,
      borderRadius: 10,
      padding: '14px 16px',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
    }}>
      <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>
        {label}
      </span>
      <span style={{ fontSize: 22, fontWeight: 300, color: 'var(--green)', lineHeight: 1.2 }}>
        {formatCost(current)}
      </span>
      {sessions != null && (
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
          {sessions} sessions · {formatTokens(tokens ?? 0)}
        </span>
      )}
      {pct !== null && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: trendColor, marginTop: 2 }}>
          <TrendIcon size={11} />
          {Math.abs(pct).toFixed(0)}% vs prev period
        </div>
      )}
    </div>
  );
}

function periodLabel(dateRange) {
  if (dateRange === 'all') return 'All time';
  if (dateRange === '1h')  return 'Last hour';
  if (dateRange === '24h') return 'Last 24 h';
  if (dateRange === 7)     return '7 days';
  if (dateRange === 30)    return '30 days';
  if (dateRange === 90)    return '90 days';
  return `${dateRange} days`;
}

// ─── Overview ─────────────────────────────────────────────────────────────────
export default function Overview({
  sessions: rawSessions = [],  // date-filtered sessions (for display cards)
  allSessions = [],            // ALL sessions, no date filter (for accurate spend cards)
  dailyData,
  costSummary,
  dateRange = 30,
  sourceStats,
  tokenBudget,
  onBudgetChange,
}) {
  const [source, setSource] = useState('both');

  const hasCodex = useMemo(
    () => allSessions.some((s) => s.source === 'codex'),
    [allSessions],
  );

  // Date-filtered + source-filtered sessions (for stat cards / charts)
  const sessions = useMemo(
    () => source === 'both' ? rawSessions : rawSessions.filter((s) => (s.source || 'claude') === source),
    [rawSessions, source],
  );

  // ALL sessions filtered by source only (for spend breakdown — no date truncation)
  const allSourceSessions = useMemo(
    () => source === 'both' ? allSessions : allSessions.filter((s) => (s.source || 'claude') === source),
    [allSessions, source],
  );

  const stats = useMemo(() => {
    const local = computeOverviewStats(sessions, dateRange);
    if (source === 'both' && typeof dateRange === 'number' && dailyData?.length) {
      const complete = dailyData.reduce((acc, day) => {
        acc.sessions += day.session_count || 0;
        acc.tokens += day.total_tokens || 0;
        acc.cost += day.estimated_cost_usd || 0;
        acc.duration += day.total_duration_seconds || 0;
        acc.ghosts += day.ghost_count || 0;
        for (const project of day.projects || []) acc.projects.add(project);
        return acc;
      }, { sessions: 0, tokens: 0, cost: 0, duration: 0, ghosts: 0, projects: new Set() });
      return {
        ...local,
        periodSessions: complete.sessions,
        periodTokens: complete.tokens,
        periodCost: complete.cost,
        periodDuration: complete.duration,
        periodProjects: complete.projects.size || local.periodProjects,
        ghostCount: complete.ghosts,
        healthRatio: complete.sessions > 0
          ? (((complete.sessions - complete.ghosts) / complete.sessions) * 100).toFixed(0)
          : 100,
        sessionsToday: costSummary?.today?.sessions ?? local.sessionsToday,
        tokensToday: costSummary?.today?.tokens ?? local.tokensToday,
        costToday: costSummary?.today?.cost ?? local.costToday,
        durationToday: costSummary?.today?.duration_seconds ?? local.durationToday,
      };
    }
    if (dateRange !== 'all' || !costSummary) return local;
    const complete = source === 'both'
      ? costSummary.allTime
      : costSummary.bySourceAllTime?.[source];
    if (!complete) return local;
    const today = source === 'both' ? costSummary.today : null;
    const ghostCount = complete.ghost_count || 0;
    return {
      ...local,
      periodSessions: complete.sessions || 0,
      periodTokens: complete.tokens || 0,
      periodCost: complete.cost || 0,
      periodDuration: complete.duration_seconds || 0,
      periodProjects: complete.distinct_projects || 0,
      totalSessions: complete.sessions || 0,
      totalTokens: complete.tokens || 0,
      totalCost: complete.cost || 0,
      totalDuration: complete.duration_seconds || 0,
      totalProjects: complete.distinct_projects || 0,
      ghostCount,
      healthRatio: complete.sessions > 0
        ? (((complete.sessions - ghostCount) / complete.sessions) * 100).toFixed(0)
        : 100,
      ...(today ? {
        sessionsToday: today.sessions || 0,
        tokensToday: today.tokens || 0,
        costToday: today.cost || 0,
        durationToday: today.duration_seconds || 0,
      } : {}),
    };
  }, [sessions, dateRange, costSummary, source, dailyData]);
  const toolData = useMemo(() => getToolBreakdownFromSessions(sessions),       [sessions]);

  // ── Spend breakdown ────────────────────────────────────────────────────────
  // Priority:
  //   1. cost-summary.json when "All sources" is selected — covers 100% of sessions
  //   2. computeSpendBreakdown(allSourceSessions) when source filter is active
  //      — uses ALL sessions (no date cap) filtered by the chosen source
  //
  // We never fall back to the date-filtered `sessions` array for spend cards,
  // because switching date range to "7d" would incorrectly zero out "This Month".
  const localSpend = useMemo(
    () => computeSpendBreakdown(allSourceSessions),
    [allSourceSessions],
  );

  const timeSpent = useMemo(() => {
    const local = computeTimeSpentBreakdown(allSourceSessions);
    const complete = source === 'both'
      ? costSummary?.allTime
      : costSummary?.bySourceAllTime?.[source];
    if (!complete) return local;
    return {
      ...local,
      allTime: {
        ...local.allTime,
        sessions: complete.sessions || 0,
        tokens: complete.tokens || 0,
        cost: complete.cost || 0,
        duration_seconds: complete.duration_seconds || 0,
      },
    };
  }, [allSourceSessions, costSummary, source]);

  const spend = (source !== 'both' || !costSummary) ? localSpend : {
    today:          costSummary.today,
    thisWeek:       costSummary.thisWeek,
    lastWeek:       costSummary.lastWeek,
    thisMonth:      costSummary.thisMonth,
    lastMonth:      costSummary.lastMonth,
    thisYear:       costSummary.thisYear,
    lastYear:       costSummary.lastYear ?? null,
    allTime:        costSummary.allTime,
    bySource:       costSummary.bySource,
    // History arrays still from localSpend (accurate enough for chart bars,
    // and they respond to source filter changes immediately).
    weeklyHistory:  localSpend.weeklyHistory,
    monthlyHistory: localSpend.monthlyHistory,
  };

  // Daily data for chart — when source filter is active, rebuild from sessions
  // so the bar chart also reflects the filtered view.
  const chartDailyData = useMemo(() => {
    if (source === 'both') return dailyData;
    return buildDailyFromSessions(sessions);
  }, [source, sessions, dailyData]);

  const label = periodLabel(dateRange);
  const hasCompleteArchive = dateRange === 'all' && Boolean(
    source === 'both' ? costSummary?.allTime : costSummary?.bySourceAllTime?.[source],
  );

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
        <h2 style={{ fontSize: 22 }}>Overview</h2>
        {hasCodex && <SourceToggle value={source} onChange={setSource} />}
      </div>

      {/* ── Primary stat cards ── */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
        <StatCard
          label={dateRange === 'all'
            ? `${hasCompleteArchive ? 'Sessions recorded' : 'Sessions loaded'} — All time`
            : `Sessions — ${label}`}
          value={stats.periodSessions}
          sub={dateRange === 'all'
            ? `${stats.sessionsToday} today · ${hasCompleteArchive ? 'complete archive' : 'preview only'}`
            : `${stats.sessionsToday} today`}
          icon={Activity}
          color="var(--accent)"
        />
        <StatCard
          label={`Tokens — ${label}`}
          value={formatTokens(stats.periodTokens)}
          sub={`${formatTokens(stats.tokensToday)} today`}
          icon={Zap}
          color="var(--cyan)"
        />
        <StatCard
          label={`Cost — ${label}`}
          value={formatCost(stats.periodCost)}
          sub={`${formatCost(stats.costToday)} today`}
          icon={DollarSign}
          color="var(--green)"
        />
        <StatCard
          label={`Projects — ${label}`}
          value={stats.periodProjects}
          sub={`${stats.projectsToday} active today · ${stats.healthRatio}% healthy`}
          icon={FolderKanban}
          color="var(--amber)"
        />
      </div>

      {/* ── Source comparison (only when Codex data exists) ── */}
      {source === 'both' && (
        <SourceComparisonPanel
          allSessions={allSessions}
          bySourceAllTime={costSummary?.bySourceAllTime}
        />
      )}

      {(source === 'both' || source === 'cursor') && (
        <CursorAggregateUsagePanel usage={costSummary?.cursorUsage} />
      )}

      {(source === 'both' || source === 'hermes') && (
        <HermesModelUsagePanel usage={costSummary?.hermesModelUsage} />
      )}

      {source === 'both' && (
        <LocalUsageReceiptPanel usage={costSummary?.localUsage} />
      )}

      {/* ── Token quota per source ── */}
      {sourceStats && tokenBudget && onBudgetChange && (
        <TokenQuotaPanel
          sourceStats={sourceStats}
          tokenBudget={tokenBudget}
          onBudgetChange={onBudgetChange}
        />
      )}

      {/* ── Time spent breakdown ── */}
      <TimeSpentPanel timeSpent={timeSpent} source={source} />

      {/* ── Spend breakdown cards ── */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
          <Eyebrow>Cost Breakdown</Eyebrow>
          {costSummary?.exportedAt && source === 'both' && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              updated {new Date(costSummary.exportedAt).toLocaleTimeString('en-IN', {
                timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit',
              })} IST
            </span>
          )}
          {source !== 'both' && (
            <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              filtered: {sourceDisplay(source)} only
            </span>
          )}
        </div>

        {/* Row 1: Today / This Week / Last Week */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
          <SpendCard
            label="Today"
            current={spend.today?.cost ?? 0}
            previous={null}
            sessions={spend.today?.sessions}
            tokens={spend.today?.tokens}
            highlight
          />
          <SpendCard
            label="This Week"
            current={spend.thisWeek?.cost ?? 0}
            previous={spend.lastWeek?.cost ?? 0}
            sessions={spend.thisWeek?.sessions}
            tokens={spend.thisWeek?.tokens}
          />
          <SpendCard
            label="Last Week"
            current={spend.lastWeek?.cost ?? 0}
            previous={null}
            sessions={spend.lastWeek?.sessions}
            tokens={spend.lastWeek?.tokens}
          />
        </div>

        {/* Row 2: This Month / Last Month / This Year */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>
          <SpendCard
            label="This Month"
            current={spend.thisMonth?.cost ?? 0}
            previous={spend.lastMonth?.cost ?? 0}
            sessions={spend.thisMonth?.sessions}
            tokens={spend.thisMonth?.tokens}
          />
          <SpendCard
            label="Last Month"
            current={spend.lastMonth?.cost ?? 0}
            previous={null}
            sessions={spend.lastMonth?.sessions}
            tokens={spend.lastMonth?.tokens}
          />
          <SpendCard
            label={`${new Date().getFullYear()} Total`}
            current={spend.thisYear?.cost ?? 0}
            previous={spend.lastYear?.cost ?? 0}
            sessions={spend.thisYear?.sessions}
            tokens={spend.thisYear?.tokens}
          />
        </div>

        {/* Per-source month breakdown — only in "All" mode with multiple sources */}
        {source === 'both' && spend.bySource && Object.keys(spend.bySource).length > 1 && (
          <div style={{
            marginTop: 12,
            padding: '12px 16px',
            background: 'var(--bg-card)',
            border: '1px solid var(--border)',
            borderRadius: 10,
            display: 'flex',
            gap: 32,
          }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)', alignSelf: 'center', marginRight: 8 }}>
              This month by source:
            </span>
            {Object.entries(spend.bySource).map(([src, d]) => (
              <div key={src} style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ fontSize: 12, color: sourceMeta(src).color }}>
                  {sourceDisplay(src)}
                </span>
                <span style={{ fontSize: 14, fontWeight: 300, color: 'var(--green)' }}>{formatCost(d.cost)}</span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.sessions} sessions</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Charts row ── */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
        <DailyChart data={chartDailyData} title="Token Usage (last period)" />
        <ToolBreakdown data={toolData} title="Tool Distribution" />
      </div>

      {/* ── Spend history chart ── */}
      <SpendChart spendData={spend} source={source} />
    </div>
  );
}
