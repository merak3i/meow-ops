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
import { join } from 'path';
import { calculateCost } from './cost-calculator.mjs';

const HISTORY_FILENAME = '.aider.chat.history.md';
const DEFAULT_MODEL    = 'claude-sonnet-4-6';

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
        totalSent += parseInt(m[1].replace(/,/g, ''), 10);
        totalRecv += parseInt(m[2].replace(/,/g, ''), 10);
      }
      const costM = tl.match(/\$([0-9.]+)/);
      if (costM) totalCostUsd += parseFloat(costM[1]);
    }

    if (totalSent + totalRecv === 0) { blockIndex++; continue; }

    // Detect model from block (> /model <name> or Model: <name>)
    const modelM = block.match(/(?:^>\s*\/model\s+|^Model:\s*)([a-z0-9._/-]+)/mi);
    const model  = modelM ? modelM[1].trim() : DEFAULT_MODEL;

    // Classify by commands used
    const catType = classifyAiderBlock(block);

    const sessionId = `aider-${projectName}-${blockIndex}`;
    blockIndex++;

    // Estimate duration: 300s default (Aider doesn't log end times)
    const durationSec = 300;
    const endedAt     = startedAt
      ? new Date(new Date(startedAt).getTime() + durationSec * 1000).toISOString()
      : new Date().toISOString();

    sessions.push({
      session_id:            sessionId,
      project:               projectName,
      model,
      entrypoint:            'aider',
      git_branch:            null,
      started_at:            startedAt || endedAt,
      ended_at:              endedAt,
      duration_seconds:      durationSec,
      message_count:         tokenLines.length,
      user_message_count:    tokenLines.length,
      assistant_message_count: tokenLines.length,
      input_tokens:          totalSent,
      output_tokens:         totalRecv,
      cache_creation_tokens: 0,
      cache_read_tokens:     0,
      total_tokens:          totalSent + totalRecv,
      // Prefer the cost Aider reported (it knows its own model billing)
      estimated_cost_usd:    totalCostUsd > 0
        ? parseFloat(totalCostUsd.toFixed(6))
        : calculateCost(model, totalSent, totalRecv, 0, 0),
      cat_type:              catType,
      is_ghost:              tokenLines.length === 0,
      source:                'aider',
      tools:                 {},
    });
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
