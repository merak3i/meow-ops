import {
  existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync,
} from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';

import { assertOutsideWorktree } from './loop-ledger.mjs';
import { callLmStudioJson } from './lmstudio-client.mjs';
import {
  DEFAULT_LIMIT, INTAKE_SUMMARY_FIELDS, appendIntakeSummary, cleanIntakeSummary,
  cursorIds, newIntakeId, readJson, resolveIntakeDir,
} from './intake-local.mjs';

export const VISION_SOURCE = 'screenshot';
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);
export const MAX_IMAGE_BYTES = 8_000_000;
const MIME_BY_EXT = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

export function resolveScreenshotInboxDir(env = process.env) {
  const dir = resolve(env.MEOW_SCREENSHOT_DIR || join(homedir(), '.meow-ops', 'screenshots-inbox'));
  assertOutsideWorktree(dir);
  return dir;
}

export function hashImage(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function screenshotSessionId(hash) {
  return `screenshot_${hash.slice(0, 12)}`;
}

export function readVisionCursor(intakeDir) {
  const cursor = readJson(join(intakeDir, 'vision-cursor.json'), { processed_image_hashes: [] });
  return cursor && typeof cursor === 'object' && !Array.isArray(cursor) ? cursor : {};
}

export function writeVisionCursor(intakeDir, cursor) {
  mkdirSync(intakeDir, { recursive: true });
  writeFileSync(join(intakeDir, 'vision-cursor.json'), `${JSON.stringify({
    ...cursor,
    updated_at: new Date().toISOString(),
  }, null, 2)}\n`);
}

function listInboxFiles(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const path = join(dir, entry.name);
    const stat = statSync(path);
    out.push({ path, ext: extname(entry.name).toLowerCase(), size: stat.size, mtimeMs: stat.mtimeMs });
  }
  return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

function toDataUrl(bytes, ext) {
  const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
  return `data:${mime};base64,${bytes.toString('base64')}`;
}

function visionPrompt({ sessionId, intakeId: id, summarizedAt }) {
  return [
    'You are a local-only screenshot classifier. Return JSON only.',
    'You see exactly one screenshot. Summarize it into content-free operational metadata.',
    'Emit ONLY short generic labels. Never transcribe or paraphrase any text, numbers, code,',
    'URLs, file paths, project names, personal names, email addresses, or secrets in the image.',
    'Example labels: deploy-error-state, failed-check-badge, quota-warning, red-status-indicator,',
    'green-all-passing, terminal-stack-trace, empty-state.',
    `Schema fields: ${INTAKE_SUMMARY_FIELDS.join(', ')}.`,
    'Allowed task_kind: build|debug|refactor|research|content|ops|other; use ops unless the',
    'screenshot clearly shows a build, debug, or research surface.',
    'Allowed outcome: completed|partial|abandoned|unknown; use unknown unless the screenshot',
    'clearly shows a completed or abandoned result.',
    'Put the real signal in failure_signatures (generic problem labels) and waste_indicators',
    '(generic repeated-effort labels). friction_score is an integer 0-5 for how alarming the',
    'visible state looks.',
    `Required constants: intake_id=${id}, session_id=${sessionId}, source=${VISION_SOURCE}, summarized_at=${summarizedAt}.`,
  ].join('\n');
}

async function summarizeImage({ sessionId, bytes, ext, env, transport, notes, now }) {
  const summarizedAt = new Date(now).toISOString();
  const raw = await callLmStudioJson({
    env,
    transport,
    notes,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: visionPrompt({ sessionId, intakeId: newIntakeId(), summarizedAt }) },
        { type: 'image_url', image_url: { url: toDataUrl(bytes, ext) } },
      ],
    }],
  });
  if (!raw) return null;
  return cleanIntakeSummary(raw, { expectedSessionId: sessionId, now, modelCalls: 1 });
}

export async function runVisionIntake(options = {}) {
  const env = options.env || process.env;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const inboxDir = options.inboxDir || resolveScreenshotInboxDir(env);
  const intakeDir = options.intakeDir || resolveIntakeDir(env);
  const transport = options.transport || globalThis.fetch;
  const now = options.now || new Date();
  const notes = options.notes || [];
  const cursor = readVisionCursor(intakeDir);
  const seen = new Set(cursorIds(cursor, 'processed_image_hashes'));
  const files = listInboxFiles(inboxDir);
  const stats = {
    scanned: 0, processed: 0, stored: 0, dropped: 0, skipped: 0, warnings: [], notes,
  };

  for (const file of files) {
    if (stats.processed >= limit) break;
    if (!ALLOWED_EXT.has(file.ext) || file.size === 0 || file.size > MAX_IMAGE_BYTES) {
      stats.skipped += 1;
      continue;
    }
    let bytes;
    try {
      bytes = readFileSync(file.path);
    } catch {
      stats.skipped += 1;
      continue;
    }
    const hash = hashImage(bytes);
    if (seen.has(hash)) continue;
    stats.scanned += 1;
    const noteCount = notes.length;
    const sessionId = screenshotSessionId(hash);
    let summary;
    try {
      summary = await summarizeImage({
        sessionId, bytes, ext: file.ext, env, transport, notes, now,
      });
    } catch (err) {
      stats.dropped += 1;
      stats.warnings.push(err.message.replace(/"[^"]+"/g, '"content not shown"'));
      seen.add(hash);
      stats.processed += 1;
      continue;
    }
    if (!summary) {
      stats.skipped += 1;
      if (notes.slice(noteCount).includes('intake skipped: no local model')) break;
      continue;
    }
    appendIntakeSummary(intakeDir, summary);
    seen.add(hash);
    stats.processed += 1;
    stats.stored += 1;
  }

  if (stats.processed > 0) {
    writeVisionCursor(intakeDir, { ...cursor, processed_image_hashes: [...seen] });
  }
  return stats;
}

function parseArgs(argv) {
  const out = { limit: DEFAULT_LIMIT };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--limit') {
      const parsed = Number(argv[i + 1]);
      out.limit = Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_LIMIT;
      i += 1;
    }
  }
  return out;
}

export async function main(argv = process.argv.slice(2)) {
  const stats = await runVisionIntake(parseArgs(argv));
  for (const warning of stats.warnings) console.warn(`warning: ${warning}`);
  for (const value of [...new Set(stats.notes)]) console.log(value);
  console.log(`vision-intake scanned=${stats.scanned} processed=${stats.processed} stored=${stats.stored} dropped=${stats.dropped} skipped=${stats.skipped}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
