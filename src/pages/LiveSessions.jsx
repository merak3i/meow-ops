import { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getCatMeta, CAT_TYPES } from '../lib/cat-classifier';
import { formatTokens, formatCost, formatDuration, relativeTime } from '../lib/format';

const MODEL_INFO = {
  'claude-opus-4-6': { label: 'Opus 4.6', color: 'var(--purple)', tier: 'flagship', costPer1k: '$15/$75' },
  'claude-sonnet-4-6': { label: 'Sonnet 4.6', color: 'var(--accent)', tier: 'balanced', costPer1k: '$3/$15' },
  'claude-sonnet-4-5-20250514': { label: 'Sonnet 4.5', color: 'var(--cyan)', tier: 'legacy', costPer1k: '$3/$15' },
};

function getModelInfo(modelId) {
  if (!modelId) return { label: 'Unknown', color: 'var(--text-muted)', tier: 'unknown', costPer1k: '—' };
  for (const [key, info] of Object.entries(MODEL_INFO)) {
    if (modelId.includes(key) || modelId.includes(key.split('-').slice(0, -1).join('-'))) return info;
  }
  if (modelId.includes('opus')) return MODEL_INFO['claude-opus-4-6'];
  if (modelId.includes('sonnet')) return MODEL_INFO['claude-sonnet-4-6'];
  return { label: modelId.split('-').slice(-2).join(' '), color: 'var(--text-muted)', tier: 'other', costPer1k: '—' };
}

function AgentCatCard({ session, onClick, isSelected }) {
  const cat = getCatMeta(session.cat_type);
  const model = getModelInfo(session.model);
  const isRecent = session.ended_at && (Date.now() - new Date(session.ended_at).getTime()) < 3600000;

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      whileHover={{ borderColor: 'var(--border-hover)' }}
      onClick={() => onClick(session)}
      style={{
        padding: 14,
        cursor: 'pointer',
        borderColor: isSelected ? 'var(--accent)' : undefined,
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      {isRecent && (
        <motion.div
          style={{
            position: 'absolute', top: 0, left: 0, right: 0,
            height: 2, background: 'var(--green)',
          }}
          animate={{ opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity }}
        />
      )}

      <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <motion.div
          animate={{ y: [0, -3, 0] }}
          transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut', delay: Math.random() * 2 }}
          style={{
            fontSize: 28,
            filter: session.is_ghost ? 'grayscale(1)' : 'none',
            opacity: session.is_ghost ? 0.3 : 1,
          }}
        >
          {cat.icon}
        </motion.div>

        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 13, fontWeight: 500, color: cat.color }}>{cat.label}</span>
            <span style={{
              fontSize: 10,
              padding: '1px 6px',
              borderRadius: 4,
              background: `${model.color}20`,
              color: model.color,
              fontFamily: 'JetBrains Mono, monospace',
            }}>
              {model.label}
            </span>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {session.project}
          </div>
        </div>

        <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-secondary)' }}>
          <div style={{ fontFamily: 'JetBrains Mono, monospace' }}>{formatTokens(session.total_tokens)}</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>{relativeTime(session.started_at)}</div>
        </div>
      </div>

      {/* Tool usage mini bar */}
      {session.tools && Object.keys(session.tools).length > 0 && (
        <div style={{ display: 'flex', gap: 1, marginTop: 8, height: 3, borderRadius: 2, overflow: 'hidden' }}>
          {Object.entries(session.tools)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 6)
            .map(([tool, count]) => {
              const total = Object.values(session.tools).reduce((a, b) => a + b, 0);
              const pct = (count / total) * 100;
              const toolColors = {
                Write: 'var(--green)', Edit: 'var(--green)',
                Read: 'var(--cyan)', Grep: 'var(--cyan)', Glob: 'var(--cyan)',
                Bash: 'var(--amber)',
                Agent: 'var(--purple)',
              };
              return (
                <div
                  key={tool}
                  style={{
                    width: `${pct}%`,
                    background: toolColors[tool] || 'var(--bg-accent)',
                    minWidth: 2,
                  }}
                />
              );
            })}
        </div>
      )}
    </motion.div>
  );
}

function SessionDetail({ session }) {
  const cat = getCatMeta(session.cat_type);
  const model = getModelInfo(session.model);

  const toolEntries = session.tools ? Object.entries(session.tools).sort((a, b) => b[1] - a[1]) : [];
  const totalTools = toolEntries.reduce((a, [, c]) => a + c, 0);

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, x: 10 }}
      animate={{ opacity: 1, x: 0 }}
      style={{ padding: 20 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <span style={{ fontSize: 36 }}>{cat.icon}</span>
        <div>
          <div style={{ fontSize: 16, fontWeight: 300 }}>{cat.label} Cat</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{session.project}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
        {[
          { label: 'Model', value: model.label, color: model.color },
          { label: 'Duration', value: formatDuration(session.duration_seconds) },
          { label: 'Input', value: formatTokens(session.input_tokens) },
          { label: 'Output', value: formatTokens(session.output_tokens) },
          { label: 'Cost', value: formatCost(session.estimated_cost_usd), color: 'var(--green)' },
          { label: 'Messages', value: session.message_count },
        ].map(({ label, value, color }) => (
          <div key={label}>
            <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
            <div style={{
              fontSize: 13,
              fontFamily: 'JetBrains Mono, monospace',
              color: color || 'var(--text-primary)',
            }}>
              {value}
            </div>
          </div>
        ))}
      </div>

      {toolEntries.length > 0 && (
        <div>
          <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 1 }}>
            Agent Tools ({totalTools} calls)
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {toolEntries.slice(0, 8).map(([tool, count]) => (
              <div key={tool} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{
                  flex: 1,
                  height: 6,
                  background: 'var(--bg-accent)',
                  borderRadius: 3,
                  overflow: 'hidden',
                }}>
                  <div style={{
                    width: `${(count / toolEntries[0][1]) * 100}%`,
                    height: '100%',
                    background: 'var(--accent)',
                    borderRadius: 3,
                    opacity: 0.7,
                  }} />
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 80, fontFamily: 'JetBrains Mono, monospace' }}>
                  {tool}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'JetBrains Mono, monospace', minWidth: 28, textAlign: 'right' }}>
                  {count}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </motion.div>
  );
}

function ModelCard({ modelId, sessions }) {
  const model = getModelInfo(modelId);
  const totalTokens = sessions.reduce((a, s) => a + s.total_tokens, 0);
  const totalCost = sessions.reduce((a, s) => a + s.estimated_cost_usd, 0);
  const catTypes = {};
  for (const s of sessions) {
    catTypes[s.cat_type] = (catTypes[s.cat_type] || 0) + 1;
  }
  const topCats = Object.entries(catTypes).sort((a, b) => b[1] - a[1]).slice(0, 3);

  return (
    <motion.div
      className="card"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      style={{ padding: 16 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: model.color }} />
          <span style={{ fontSize: 14, fontWeight: 500 }}>{model.label}</span>
        </div>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{model.costPer1k} /1M</span>
      </div>

      <div style={{ display: 'flex', gap: 16, fontSize: 12, marginBottom: 12 }}>
        <div>
          <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>Sessions</div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace' }}>{sessions.length}</div>
        </div>
        <div>
          <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>Tokens</div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace' }}>{formatTokens(totalTokens)}</div>
        </div>
        <div>
          <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>Cost</div>
          <div style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--green)' }}>{formatCost(totalCost)}</div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        {topCats.map(([type, count]) => {
          const cat = getCatMeta(type);
          return (
            <div key={type} style={{
              display: 'flex', alignItems: 'center', gap: 4,
              padding: '2px 8px', borderRadius: 4,
              background: 'var(--bg-hover)',
              fontSize: 11,
            }}>
              <span>{cat.icon}</span>
              <span style={{ color: 'var(--text-secondary)' }}>{count}</span>
            </div>
          );
        })}
      </div>
    </motion.div>
  );
}

export default function LiveSessions({ sessions }) {
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState('agents');

  const recentSessions = useMemo(() =>
    [...sessions]
      .sort((a, b) => new Date(b.started_at) - new Date(a.started_at))
      .slice(0, 50),
    [sessions]
  );

  const byModel = useMemo(() => {
    const map = {};
    for (const s of sessions) {
      const key = s.model || 'unknown';
      if (!map[key]) map[key] = [];
      map[key].push(s);
    }
    return Object.entries(map).sort((a, b) => b[1].length - a[1].length);
  }, [sessions]);

  const catSummary = useMemo(() => {
    const counts = {};
    for (const s of sessions) {
      counts[s.cat_type] = (counts[s.cat_type] || 0) + 1;
    }
    return Object.entries(counts).sort((a, b) => b[1] - a[1]);
  }, [sessions]);

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h2 style={{ fontSize: 22, fontWeight: 300 }}>Live Sessions</h2>
        <div style={{ display: 'flex', gap: 4 }}>
          {['agents', 'models'].map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              style={{
                padding: '6px 14px',
                borderRadius: 6,
                border: '1px solid var(--border)',
                background: view === v ? 'var(--bg-hover)' : 'transparent',
                color: view === v ? 'var(--text-primary)' : 'var(--text-secondary)',
                cursor: 'pointer',
                fontSize: 12,
                fontFamily: 'inherit',
                textTransform: 'capitalize',
              }}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Cat type summary bar */}
      <div className="card" style={{ padding: '10px 16px', display: 'flex', gap: 16, marginBottom: 20, flexWrap: 'wrap' }}>
        {catSummary.map(([type, count]) => {
          const cat = getCatMeta(type);
          return (
            <div key={type} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
              <span style={{ fontSize: 16 }}>{cat.icon}</span>
              <span style={{ color: 'var(--text-secondary)' }}>{cat.label}</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', color: cat.color }}>{count}</span>
            </div>
          );
        })}
      </div>

      {view === 'agents' ? (
        <div style={{ display: 'grid', gridTemplateColumns: selected ? '1fr 340px' : '1fr', gap: 16 }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {recentSessions.map((s) => (
              <AgentCatCard
                key={s.session_id}
                session={s}
                onClick={setSelected}
                isSelected={selected?.session_id === s.session_id}
              />
            ))}
            {recentSessions.length === 0 && (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 40 }}>
                No sessions yet. Run the sync script to populate data.
              </div>
            )}
          </div>

          <AnimatePresence>
            {selected && (
              <div style={{ position: 'sticky', top: 24, alignSelf: 'start' }}>
                <SessionDetail session={selected} />
              </div>
            )}
          </AnimatePresence>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {byModel.map(([modelId, sess]) => (
            <ModelCard key={modelId} modelId={modelId} sessions={sess} />
          ))}
        </div>
      )}
    </div>
  );
}
