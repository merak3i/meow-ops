import { useEffect } from 'react';
import { RUNESTONE_COLOR } from './championsConfig';
import type { SsRunestone } from './types';

interface Props {
  runestone: SsRunestone;
  onClose: () => void;
}

const TYPE_LABEL: Record<string, string> = {
  json:  'Structured Runestone',
  text:  'Arcane Runestone',
  error: 'Cursed Runestone',
};

export function LootBoxModal({ runestone, onClose }: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const color   = RUNESTONE_COLOR[runestone.payload_type];
  const label   = TYPE_LABEL[runestone.payload_type] ?? 'Runestone';
  const ts      = new Date(runestone.created_at).toLocaleTimeString('en-IN', { hour12: false });
  const rawText = runestone.payload == null
    ? '(empty payload)'
    : typeof runestone.payload === 'string'
      ? runestone.payload
      : JSON.stringify(runestone.payload, null, 2);

  return (
    <div className="loot-box-backdrop" onClick={onClose}>
      <div className="loot-box-panel" onClick={e => e.stopPropagation()}
        style={{ borderColor: `${color}33` }}>

        <div className="loot-box-header">
          <span className="loot-box-title" style={{ color }}>
            ◈ {label}
          </span>
          <button className="loot-box-close" onClick={onClose}>✕</button>
        </div>

        <div className="loot-box-meta">
          <div className="loot-box-meta-item">
            <span className="loot-box-meta-label">Tokens</span>
            <span className="loot-box-meta-value" style={{ color: '#4a9eff' }}>
              {runestone.tokens_used.toLocaleString()}
            </span>
          </div>
          <div className="loot-box-meta-item">
            <span className="loot-box-meta-label">Latency</span>
            <span className="loot-box-meta-value" style={{ color: '#4aff8c' }}>
              {runestone.latency_ms.toLocaleString()} ms
            </span>
          </div>
          <div className="loot-box-meta-item">
            <span className="loot-box-meta-label">Status</span>
            <span className="loot-box-meta-value" style={{ color }}>
              {runestone.status}
            </span>
          </div>
          <div className="loot-box-meta-item">
            <span className="loot-box-meta-label">Time</span>
            <span className="loot-box-meta-value">{ts}</span>
          </div>
        </div>

        <div className="loot-box-payload">
          <pre style={{ color: `${color}cc` }}>{rawText}</pre>
        </div>
      </div>
    </div>
  );
}
