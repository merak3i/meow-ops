// parse-aider.mjs — Aider chat history parser.
//
// Aider writes a markdown chat log at .aider.chat.history.md in the project root.
// Each session block looks like:
//
//   # aider chat started at 2025-04-07 14:32:09
//
//   > /add src/foo.py
//   > architect: refactor this
//
//   #### tokens: 12,345 sent, 3,210 received, $0.22 cost
//
// Strategy:
//   1. Walk project directories (configurable via AIDER_PROJECTS env var)
//   2. Find all .aider.chat.history.md files
//   3. Split by "# aider chat started at" headers
//   4. Parse token/cost lines from each session block
//   5. Classify cat_type based on commands used (add/architect = architect, etc.)

import { existsSync, readdirSync, statSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { calculateCostDetailed } from './cost-calculator.mjs';
import { createSession, makeSnippet } from './session-utils.mjs';

const HISTORY_FILENAME = '.aider.chat.history.md';
const DEFAULT_MODEL    = 'claude-sonnet-4-6';

/** Parse a comma-grouped integer, returning 0 on any malformed input. */
function safeInt(str) {
  const n = parseInt(String(str).replace(/,/g, ''), 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

export function scanAiderProjects(projectDirs) {
  if (!Array.isArray(projectDirs) || projectDirs.length === 0) return [];

  const sessions = [];

  for (const dir of projectDirs) {
    if (!existsSync(dir)) continue;
    const historyPath = join(dir, HISTORY_FILENAME);
    if (!existsSync(historyPath)) {
      // Recurse one level for monorepos
      try {
        for (const sub of readdirSync(dir)) {
          const subPath = join(dir, sub, HISTORY_FILENAME);
          if (existsSync(subPath)) {
            sessions.push(...parseAiderHistory(subPath, sub));
          }
        }
      } catch { /* skip unreadable dirs */ }
    } else {
      const projectName = dir.split('/').filter(Boolean).pop() || 'aider';
      sessions.push(...parseAiderHistory(historyPath, projectName));
    }
  }

  return sessions;
}

function parseAiderHistory(filePath, projectName) {
  let content;
  try {
    content = readFileSync(filePath, 'utf8');
  } catch {
    return [];
  }

  // Split into session blocks by the header line
  const blocks = content
    .split(/^# aider chat started at /m)
    .filter(Boolean);

  const sessions = [];
  let blockIndex = 0;

  for (const block of blocks) {
    // First line of block = timestamp
    const lines     = block.split('\n');
    const tsLine    = lines[0]?.trim();
    const startedAt = parseAiderDate(tsLine);

    // Find the last token summary line: "#### tokens: X sent, Y received, $Z cost"
    const tokenLines = block.match(/####\s*tokens:\s*([\d,]+)\s*sent,\s*([\d,]+)\s*received/gi) ?? [];
    if (tokenLines.length === 0) { blockIndex++; continue; }

    let totalSent = 0;
    let totalRecv = 0;
    let totalCostUsd = 0;

    for (const tl of tokenLines) {
      const m = tl.match(/([\d,]+)\s*sent,\s*([\d,]+)\s*received/i);
      if (m) {
        totalSent += safeInt(m[1]);
        totalRecv += safeInt(m[2]);
      }
      const costM = tl.match(/\$([0-9.]+)/);
      if (costM) {
        const c = parseFloat(costM[1]);
        if (Number.isFinite(c) && c > 0) totalCostUsd += c;
      }
    }

    if (totalSent + totalRecv === 0) { blockIndex++; continue; }

    // Detect model from block (> /model <name> or Model: <name>)
    const modelM = block.match(/(?:^>\s*\/model\s+|^Model:\s*)([a-z0-9._/-]+)/mi);
    const model  = modelM ? modelM[1].trim() : DEFAULT_MODEL;
    const firstPrompt = makeSnippet(
      (block.match(/^>\s*(?!\/(?:add|model|architect|run|shell|tokens|edit)\b)(.+)$/mi)?.[1])
      || (block.match(/^>\s*(.+)$/mi)?.[1])
      || '',
    );

    // Classify by commands used
    const catType = classifyAiderBlock(block);

    const sessionId = `aider-${projectName}-${blockIndex}`;
    blockIndex++;

    // Aider does not log end times. Rather than fabricate a duration, fall back
    // to the file mtime for a missing start and report duration 0 (unknown)
    // instead of a made-up 300s.
    const fallbackTs = (() => {
      try { return statSync(filePath).mtime.toISOString(); } catch { return startedAt; }
    })();
    const begin = startedAt || fallbackTs;

    // Trust Aider's self-reported cost when present (it knows its exact model
    // billing); otherwise estimate from our table and record the source.
    let cost = totalCostUsd > 0 ? parseFloat(totalCostUsd.toFixed(6)) : null;
    let pricingSource = 'aider-reported';
    if (cost === null) {
      const priced = calculateCostDetailed(model, totalSent, totalRecv, 0, 0);
      cost = priced.cost;
      pricingSource = priced.pricingSource;
    }

    sessions.push(createSession({
      session_id:            sessionId,
      source:                'aider',
      project:               projectName,
      cwd:                   dirname(filePath),
      model,
      entrypoint:            'aider',
      started_at:            begin,
      ended_at:              begin,
      duration_seconds:      0,
      message_count:         tokenLines.length,
      user_message_count:    tokenLines.length,
      assistant_message_count: tokenLines.length,
      input_tokens:          totalSent,
      output_tokens:         totalRecv,
      total_tokens:          totalSent + totalRecv,
      estimated_cost_usd:    cost,
      pricing_source:        pricingSource,
      cat_type:              catType,
      is_ghost:              tokenLines.length === 0,
      session_title:         firstPrompt || null,
      first_user_message:    firstPrompt || null,
    }));
  }

  return sessions;
}

function parseAiderDate(str) {
  if (!str) return null;
  // Format: "2025-04-07 14:32:09"
  const d = new Date(str.replace(' ', 'T'));
  return isNaN(d.getTime()) ? null : d.toISOString();
}

function classifyAiderBlock(block) {
  const lower = block.toLowerCase();
  if (lower.includes('/architect'))          return 'architect';
  if (lower.includes('/add') && lower.includes('/edit')) return 'builder';
  if (lower.includes('/add'))                return 'detective';
  if (lower.includes('/run') || lower.includes('/shell')) return 'commander';
  if (lower.includes('/write') || lower.includes('/new')) return 'builder';
  return 'builder';   // aider's primary mode is code editing
}
