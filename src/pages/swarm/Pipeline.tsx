import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';

import { KIND_LABEL, STEP_STATUS_META, pipelineLayout } from '../../lib/swarm-control';
import type { PlanStep, StepStatus } from '../../lib/swarm-control';

// The plan as a pipeline: one column per dependency depth, so whatever shares
// a column can run at the same time and arrows show what waits on what.

const COL = 212;
const ROW = 96;
const NODE_W = 184;
const NODE_H = 76;
// Nodes are small: a short status that never wraps into the title.
const NODE_LABEL: Partial<Record<string, string>> = { waiting: 'Needs you', interrupted: 'Stopped' };
const PAD = 12;

type PipelineStep = PlanStep & { status?: StepStatus; pending?: readonly unknown[] };

export interface PipelineProps {
  steps: readonly PipelineStep[];
  nameOf: (provider: string) => string;
  selected?: string | null;
  onSelect?: (id: string) => void;
  label: string;
  /** Shrink to the container's width (down to MIN_SCALE) instead of scrolling. For narrow previews. */
  fit?: boolean;
}

const MIN_SCALE = 0.55;

export function Pipeline({ steps, nameOf, selected = null, onSelect, label, fit = false }: PipelineProps) {
  const frame = useRef<HTMLDivElement | null>(null);
  const [available, setAvailable] = useState<number | null>(null);
  // The frame only exists once there are steps, so re-attach when that changes.
  const hasSteps = steps.length > 0;
  useEffect(() => {
    const element = frame.current;
    if (!fit || !hasSteps || !element || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(([entry]) => { if (entry) setAvailable(entry.contentRect.width); });
    observer.observe(element);
    return () => observer.disconnect();
  }, [fit, hasSteps]);
  const layout = pipelineLayout(steps);
  const width = Math.max(1, layout.levels) * COL - (COL - NODE_W) + PAD * 2;
  const height = Math.max(1, layout.rows) * ROW - (ROW - NODE_H) + PAD * 2;
  const position = new Map(layout.nodes.map((node) => [node.id, { x: PAD + node.level * COL, y: PAD + node.row * ROW }]));
  const byId = new Map(steps.map((item) => [item.id, item]));

  const scale = fit && available ? Math.min(1, Math.max(MIN_SCALE, available / width)) : 1;

  if (!steps.length) return <p className="sc-muted sc-pipeline__empty">Steps you add appear here as a pipeline.</p>;

  return (
    <div className="sc-pipeline" role="group" aria-label={label} ref={frame}>
      <div style={scale < 1 ? { width: width * scale, height: height * scale } : undefined}>
        <div className="sc-pipeline__canvas" style={{ width, height, ...(scale < 1 ? { transform: `scale(${scale})`, transformOrigin: '0 0' } : {}) }}>
          <svg className="sc-pipeline__edges" width={width} height={height} aria-hidden="true">
            <defs>
              <marker id="sc-arrow" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                <path d="M0,0 L8,4 L0,8 z" className="sc-pipeline__arrow" />
              </marker>
            </defs>
            {layout.edges.map((edge) => {
              const from = position.get(edge.from);
              const to = position.get(edge.to);
              if (!from || !to) return null;
              const x1 = from.x + NODE_W;
              const y1 = from.y + NODE_H / 2;
              const x2 = to.x - 4;
              const y2 = to.y + NODE_H / 2;
              const bend = Math.max(24, (x2 - x1) / 2);
              const done = byId.get(edge.from)?.status === 'completed';
              return <path key={`${edge.from}-${edge.to}`} d={`M${x1},${y1} C${x1 + bend},${y1} ${x2 - bend},${y2} ${x2},${y2}`} className={`sc-pipeline__edge${done ? ' is-done' : ''}`} markerEnd="url(#sc-arrow)" />;
            })}
          </svg>
          {steps.map((item) => {
            const at = position.get(item.id);
            if (!at) return null;
            const status = item.status ?? 'draft';
            const meta = STEP_STATUS_META[status];
            const active = selected === item.id;
            const interactive = Boolean(onSelect);
            const select = () => onSelect?.(item.id);
            return (
              <div
                key={item.id}
                className={`sc-node tone-${meta.tone} status-${status}${active ? ' is-selected' : ''}${interactive ? ' is-interactive' : ''}`}
                style={{ left: at.x, top: at.y, width: NODE_W, height: NODE_H }}
                {...(interactive ? {
                  role: 'button',
                  tabIndex: 0,
                  'aria-pressed': active,
                  'aria-label': `${item.id}, ${item.title}, ${nameOf(item.provider)}, ${meta.label}`,
                  onClick: select,
                  onKeyDown: (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(); } },
                } : {})}
              >
                <div className="sc-node__top">
                  <span className="sc-node__id">{item.id}</span>
                  {item.status && <span className="sc-node__status">{NODE_LABEL[status] ?? meta.label}{item.pending?.length ? ` · ${item.pending.length}` : ''}</span>}
                </div>
                <div className="sc-node__title" title={item.title || undefined}>{item.title || 'Untitled step'}</div>
                <div className="sc-node__who">{KIND_LABEL[item.kind]} · {nameOf(item.provider)}{item.model ? ` · ${item.model}` : ''}{item.effort ? ` · ${item.effort}` : ''}</div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
