// agent-tree.ts — utilities for building and traversing the subagent session tree.

import type { Session } from '@/types/session';

// ─── Tree node ────────────────────────────────────────────────────────────────

export interface AgentTreeNode {
  session:       Session;
  children:      AgentTreeNode[];
  totalCost:     number;
  totalTokens:   number;
  totalDuration: number;
}

// ─── Session run group (project + time proximity) ─────────────────────────────

export interface SessionRunGroup {
  id:          string;
  project:     string;
  startedAt:   string;
  roots:       AgentTreeNode[];
  totalCost:   number;
  totalTokens: number;
}

// ─── Build forest ─────────────────────────────────────────────────────────────

/**
 * Groups sessions by parent_session_id and builds a tree.
 * Returns only root nodes (sessions with no parent, or orphaned subagents).
 * Handles missing parents gracefully — orphaned subagents become synthetic roots.
 */
export function buildAgentForest(sessions: Session[]): AgentTreeNode[] {
  // Build a lookup map: session_id → AgentTreeNode
  const nodeMap = new Map<string, AgentTreeNode>();

  for (const s of sessions) {
    nodeMap.set(s.session_id, {
      session:       s,
      children:      [],
      totalCost:     s.estimated_cost_usd,
      totalTokens:   s.total_tokens,
      totalDuration: s.duration_seconds,
    });
  }

  const roots: AgentTreeNode[] = [];

  for (const node of nodeMap.values()) {
    const parentId = node.session.parent_session_id;
    if (!parentId) {
      roots.push(node);
    } else {
      const parent = nodeMap.get(parentId);
      if (parent) {
        parent.children.push(node);
      } else {
        // Orphaned subagent (parent not in current window) — treat as root
        roots.push(node);
      }
    }
  }

  // Roll up totals: traverse each root subtree bottom-up
  function rollup(node: AgentTreeNode): void {
    for (const child of node.children) {
      rollup(child);
      node.totalCost     += child.totalCost;
      node.totalTokens   += child.totalTokens;
      node.totalDuration += child.totalDuration;
    }
  }
  for (const root of roots) rollup(root);

  // Sort roots by most-recent activity first
  roots.sort((a, b) => {
    const aTime = new Date(a.session.ended_at || a.session.started_at).getTime();
    const bTime = new Date(b.session.ended_at || b.session.started_at).getTime();
    return bTime - aTime;
  });

  return roots;
}

/**
 * DFS-flattens a forest into a linear list for rendering.
 * Each node gets a `depth` context via `_depth` (attached transiently, not persisted).
 */
export function flattenTree(roots: AgentTreeNode[]): Array<AgentTreeNode & { depth: number }> {
  const result: Array<AgentTreeNode & { depth: number }> = [];

  function visit(node: AgentTreeNode, depth: number) {
    result.push({ ...node, depth });
    for (const child of node.children) {
      visit(child, depth + 1);
    }
  }

  for (const root of roots) visit(root, 0);
  return result;
}

/**
 * Groups root sessions by project and time proximity (30-min gap = new run).
 * Returns run groups sorted newest-first.
 */
export function getSessionRunGroups(sessions: Session[]): SessionRunGroup[] {
  const forest = buildAgentForest(sessions);
  const groups: SessionRunGroup[] = [];

  for (const root of forest) {
    const s         = root.session;
    const project   = s.project;
    const ts        = new Date(s.started_at || s.ended_at).getTime();
    const GAP_MS    = 30 * 60 * 1000;

    // Try to extend the most recent group with the same project within 30 min
    const last = groups.find(
      (g) => g.project === project && Math.abs(new Date(g.startedAt).getTime() - ts) < GAP_MS,
    );

    if (last) {
      last.roots.push(root);
      last.totalCost   += root.totalCost;
      last.totalTokens += root.totalTokens;
      // Update startedAt to the earliest in the group
      if (ts < new Date(last.startedAt).getTime()) {
        last.startedAt = s.started_at || s.ended_at;
      }
    } else {
      groups.push({
        id:          `${project}-${ts}`,
        project,
        startedAt:   s.started_at || s.ended_at,
        roots:       [root],
        totalCost:   root.totalCost,
        totalTokens: root.totalTokens,
      });
    }
  }

  return groups;
}

// ─── Efficiency helpers ───────────────────────────────────────────────────────

/**
 * Token efficiency index: output tokens per $1 spent (higher = more efficient).
 * Rolls up the entire subtree (self + descendants).
 */
export function efficiencyIndex(node: AgentTreeNode): number {
  if (node.totalCost === 0) return 0;
  function sumOutputTokens(n: AgentTreeNode): number {
    return (n.session.output_tokens || 0) +
      n.children.reduce((sum, c) => sum + sumOutputTokens(c), 0);
  }
  return Math.round(sumOutputTokens(node) / node.totalCost);
}

/**
 * Prompt cache hit rate for a single session (0–1).
 * High values (>50%) indicate good context reuse.
 */
export function cacheHitRate(session: Session): number {
  const total = session.total_tokens || 0;
  if (total === 0) return 0;
  return (session.cache_read_tokens || 0) / total;
}

// ─── Model family → colour ────────────────────────────────────────────────────

export function modelColor(model: string | null): string {
  if (!model) return 'var(--text-muted)';
  if (model.includes('opus'))                   return '#c084fc';         // purple
  if (model.includes('sonnet'))                 return 'var(--accent)';   // blue
  if (model.includes('haiku'))                  return 'var(--cyan)';     // teal
  if (model.startsWith('o3') || model.startsWith('o4')) return '#f87171'; // red
  if (model.includes('gpt'))                    return 'var(--amber)';    // amber
  if (model.includes('deepseek') || model.includes('qwen') ||
      model.includes('kimi') || model.includes('glm') ||
      model.includes('doubao'))                 return '#34d399';         // green (Chinese)
  if (model.includes('grok'))                   return '#f472b6';         // pink (xAI)
  if (model.includes('command'))                return '#fb923c';         // orange (Cohere)
  if (model.includes('nova'))                   return '#a78bfa';         // violet (Amazon)
  if (model.includes('sonar'))                  return '#38bdf8';         // sky (Perplexity)
  if (model.includes('gemini'))                 return '#4ade80';         // lime (Google)
  if (model.includes('mistral'))                return '#fbbf24';         // yellow
  if (model.includes('llama'))                  return '#94a3b8';         // slate (local)
  return 'var(--text-secondary)';
}

export function modelLabel(model: string | null): string {
  if (!model) return 'unknown';
  if (model.includes('opus'))             return 'Opus';
  if (model.includes('sonnet'))           return 'Sonnet';
  if (model.includes('haiku'))            return 'Haiku';
  if (model.includes('gpt-4o-mini'))      return 'GPT-4o-mini';
  if (model.includes('gpt-4o'))           return 'GPT-4o';
  if (model.includes('gpt-5'))            return 'GPT-5';
  if (model.startsWith('o3'))             return 'o3';
  if (model.startsWith('o4'))             return 'o4-mini';
  if (model.includes('gemini-2.5'))       return 'Gemini 2.5';
  if (model.includes('gemini-2.0') || model.includes('flash')) return 'Flash';
  if (model.includes('gemini'))           return 'Gemini';
  if (model.includes('mistral-large'))    return 'Mistral L';
  if (model.includes('mistral'))          return 'Mistral';
  if (model.includes('llama'))            return 'Llama';
  if (model.includes('deepseek-r1'))      return 'DeepSeek R1';
  if (model.includes('deepseek'))         return 'DeepSeek';
  if (model.includes('qwen-max'))         return 'Qwen Max';
  if (model.includes('qwen'))             return 'Qwen';
  if (model.includes('kimi') || model.includes('moonshot')) return 'Kimi';
  if (model.includes('glm'))              return 'GLM';
  if (model.includes('doubao'))           return 'Doubao';
  if (model.includes('grok-3-mini'))      return 'Grok 3 mini';
  if (model.includes('grok-3'))           return 'Grok 3';
  if (model.includes('grok'))             return 'Grok 2';
  if (model.includes('command-r-plus') || model.includes('command-r+')) return 'Cmd R+';
  if (model.includes('command-r'))        return 'Cmd R';
  if (model.includes('nova-pro'))         return 'Nova Pro';
  if (model.includes('nova-lite'))        return 'Nova Lite';
  if (model.includes('nova'))             return 'Nova';
  if (model.includes('sonar-pro'))        return 'Sonar Pro';
  if (model.includes('sonar'))            return 'Sonar';
  return model.slice(0, 12);
}
