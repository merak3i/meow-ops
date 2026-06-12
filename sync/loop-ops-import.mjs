// Loop-Ops importer — converts the Patherle Master Spec workbook into the
// local JSON the Loop-Ops page renders (spec §Phase 3).
//
//   node sync/loop-ops-import.mjs [--spec <xlsx>] [--truth <csv>] [--out <dir>]
//
// Outputs spec.json + gates.json under public/data/loop-ops/ (LOCAL-ONLY —
// that directory is gitignored; the hosted build intentionally ships the
// instructional empty state). runs.json is never touched. No git, no network,
// no production writes — this script reads two local files and writes two.
//
// Fails loudly (exit 1, ALL violations listed, no partial output) when the
// workbook does not encode exactly the 26-surface / 4-group model.
import { mkdirSync, readFileSync, renameSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_SPEC = '/Users/napster/Downloads/Patherle/Agentic Harness/PATHERLE_HARNESS_MASTER_SPEC_v1_2026-06-07.xlsx';
const DEFAULT_TRUTH = '/Users/napster/Downloads/Patherle/Agentic Harness/patherle-harness-truth-sync-2026-06-07/LIVE_Surface_Registry.csv';
const DEFAULT_OUT = join(__dirname, '..', 'public', 'data', 'loop-ops');

const GROUPS = ['tenant', 'customer', 'admin', 'doer'];
// Worst → best; synthetic entities inherit the worst child status. An empty
// set returns needs-review — it must never claim 'passed'.
const SEVERITY = ['failed', 'blocked', 'needs-review', 'running', 'covered', 'wired', 'passed'];
const worstStatus = (list) => list.length === 0
  ? 'needs-review'
  : list.reduce((w, s) => (SEVERITY.indexOf(s) < SEVERITY.indexOf(w) ? s : w), 'passed');

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

// exceljs cell values: formulas arrive as {formula, result}, rich text as
// {richText: [...]}. Collapse everything to a plain scalar.
function cellVal(v) {
  if (v === null || v === undefined) return '';
  if (typeof v === 'object') {
    if ('result' in v) return cellVal(v.result);
    if ('richText' in v) return v.richText.map((r) => r.text).join('');
    if ('text' in v) return v.text;
    return '';
  }
  return v;
}

// Workbook tabs share one layout: title r1, description r2, header row
// (contains a known anchor column), data below. Returns [{__row, <header>: value}].
function sheetRows(ws, anchor) {
  if (!ws) return [];
  let headerRow = 0;
  const headers = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (headerRow) return;
    const vals = row.values.map(cellVal);
    if (vals.some((v) => String(v).trim() === anchor)) {
      headerRow = n;
      vals.forEach((v, idx) => { headers[idx] = String(v).trim(); });
    }
  });
  if (!headerRow) return [];
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (row, n) => {
    if (n <= headerRow) return;
    const obj = { __row: n };
    row.values.forEach((v, idx) => {
      if (headers[idx]) obj[headers[idx]] = cellVal(v);
    });
    if (String(obj[anchor] ?? '').trim()) rows.push(obj);
  });
  return rows;
}

// Minimal RFC-4180 CSV parser — the truth-sync export carries quoted fields
// with embedded commas and newlines.
function parseCsv(text) {
  const rows = [[]];
  let field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { rows[rows.length - 1].push(field); field = ''; }
    else if (c === '\n') { rows[rows.length - 1].push(field); field = ''; rows.push([]); }
    else if (c !== '\r') field += c;
  }
  rows[rows.length - 1].push(field);
  const [header, ...data] = rows.filter((r) => r.length > 1 || (r[0] ?? '').trim());
  return data.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ''])));
}

// Status per spec §6: a PARTIAL/MISSING correlation is conservative truth and
// wins over a passing e2e gate.
function statusFor(truth) {
  if (!truth) return 'covered';
  const corr = String(truth.correlation_status ?? '').trim().toUpperCase();
  if (corr.startsWith('PARTIAL') || corr.startsWith('MISSING')) return 'needs-review';
  const gate = String(truth.latest_e2e_gate ?? '').trim().toLowerCase();
  if (gate === 'pass') return 'passed';
  if (gate === 'fail') return 'failed';
  const db = String(truth.db_status ?? '').trim().toLowerCase();
  return SEVERITY.includes(db) ? db : 'covered';
}

async function main() {
  const specPath = resolve(arg('spec', DEFAULT_SPEC));
  const truthPath = resolve(arg('truth', DEFAULT_TRUTH));
  const outDir = resolve(arg('out', DEFAULT_OUT));

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(specPath);
  const sheet = (prefix) => wb.worksheets.find((ws) => ws.name.startsWith(prefix));

  const registry = sheetRows(sheet('1 ·'), 'surface_key');
  const errors = [];

  const REQUIRED_COLS = ['surface_key', 'group', 'archetype', 'riskClass', 'modelTier',
    'confidenceFloor', 'pass_threshold', 'evalGate', 'enabled', 'promptVersion', 'wave', 'phase'];
  const sample = registry[0] ?? {};
  for (const col of REQUIRED_COLS) {
    if (!(col in sample)) errors.push(`missing required registry column "${col}"`);
  }
  if (registry.length !== 26) {
    errors.push(`registry must hold exactly 26 assistant surfaces, found ${registry.length} (rows: ${registry.map((r) => r.__row).join(', ') || 'none'})`);
  }
  const groups = [...new Set(registry.map((r) => String(r.group).trim()))].sort();
  if (errors.length === 0 && groups.join(',') !== [...GROUPS].sort().join(',')) {
    errors.push(`groups must be exactly {${GROUPS.join(', ')}}, found {${groups.join(', ')}}`);
  }
  const seen = new Map();
  for (const r of registry) {
    const key = String(r.surface_key).trim();
    if (seen.has(key)) errors.push(`duplicate surface_key "${key}" (rows ${seen.get(key)} and ${r.__row})`);
    else seen.set(key, r.__row);
  }
  if (errors.length) {
    console.error('loop-ops-import: workbook validation FAILED — nothing written.');
    errors.forEach((e) => console.error(`  ✗ ${e}`));
    process.exit(1);
  }

  // Enrichment tabs are best-effort: a missing tab degrades detail, never validity.
  const byKey = (rows) => Object.fromEntries(rows.map((r) => [String(r.surface_key).trim(), r]));
  const rubric = byKey(sheetRows(sheet('2 ·'), 'surface_key'));
  const evals = byKey(sheetRows(sheet('3 ·'), 'surface_key'));
  const research = byKey(sheetRows(sheet('4 ·'), 'surface_key'));
  const examples = byKey(sheetRows(sheet('5 ·'), 'surface_key'));
  const flywheel = byKey(sheetRows(sheet('6 ·'), 'surface_key'));
  const beats = byKey(sheetRows(sheet('7 ·'), 'surface_key'));
  const wavemap = byKey(sheetRows(sheet('9 ·'), 'surface_key'));
  const dangers = sheetRows(sheet('10 ·'), 'danger / gap');

  let truthByKey = {};
  let truthUsed = false;
  if (existsSync(truthPath)) {
    truthByKey = Object.fromEntries(parseCsv(readFileSync(truthPath, 'utf8')).map((r) => [String(r.surface_key).trim(), r]));
    truthUsed = true;
  }

  const guardrailsFor = (key) => dangers
    .filter((d) => {
      const surf = String(d['applicable surfaces'] ?? '');
      return surf.toLowerCase().startsWith('all') || surf.includes(key);
    })
    .map((d) => `${d['danger / gap']} (${d['OWASP LLM Top-10']})`)
    .join('; ');

  const entities = [];
  const edges = [];
  const gates = [];

  entities.push({
    id: 'coordinator.main', kind: 'coordinator', label: 'Main Coordinator',
    group: null, surfaceKey: null, archetype: null, riskClass: null, wave: null,
    status: 'covered',
    sources: ['synthesized: loop-ops entity model (spec §4); not present in Master Spec workbook'],
    repoLinks: [], allowedActions: ['inspect'],
    detail: { notVerified: ['Synthetic entity — no runtime counterpart exists yet'] },
  });
  for (const g of GROUPS) {
    entities.push({
      id: `director.${g}`, kind: 'director', label: `${g[0].toUpperCase()}${g.slice(1)} Director`,
      group: g, surfaceKey: null, archetype: null, riskClass: null, wave: null,
      status: 'covered',
      sources: [`synthesized from Master Spec group value '${g}' (spec §4)`],
      repoLinks: [], allowedActions: ['inspect'],
      detail: { notVerified: ['Synthetic entity — no runtime counterpart exists yet'] },
    });
    edges.push({ id: `e.coordinator.${g}`, source: 'coordinator.main', target: `director.${g}` });
  }

  for (const r of registry) {
    const key = String(r.surface_key).trim();
    const g = String(r.group).trim();
    const truth = truthByKey[key];
    const ev = evals[key];
    const fw = flywheel[key];
    const ru = rubric[key];
    const re = research[key];
    const ex = examples[key];
    const be = beats[key];
    const wm = wavemap[key];
    const refs = truth
      ? [...String(truth.source_refs ?? '').matchAll(/https:\/\/\S+?(?=\s|\||$)/g)].map((m) => m[0])
      : [];

    const notVerified = ['Live Supabase runtime state not verified (migration files only)'];
    if (truth) notVerified.push(`Status derived from truth-sync snapshot ${basename(truthPath)}, not a live probe`);
    else notVerified.push('No truth-sync snapshot found — status reflects workbook coverage only');

    entities.push({
      id: key, kind: 'assistant',
      label: String(r.notes ?? '').trim() || key,
      group: g, surfaceKey: key,
      archetype: String(r.archetype).trim(), riskClass: String(r.riskClass).trim(),
      wave: Number(r.wave), status: statusFor(truth),
      sources: [`master-spec tab '1 · Registry' row ${r.__row}`,
        ...(truth ? [`truth-sync ${basename(truthPath)} (2026-06-07)`] : [])],
      repoLinks: [...refs, `eval/${key.startsWith('assist.') ? `assist/${key.split('.')[1]}` : key}`],
      allowedActions: ['inspect', 'open-link'],
      detail: {
        modelTier: String(r.modelTier ?? ''), confidenceFloor: Number(r.confidenceFloor),
        passThreshold: Number(r.pass_threshold), promptVersion: String(r.promptVersion ?? ''),
        evalSet: truth ? String(truth.eval_set ?? '') : '',
        dbStatus: truth ? String(truth.db_status ?? '') : '',
        e2eGate: truth ? String(truth.latest_e2e_gate ?? '') : '',
        currentTruth: truth ? String(truth.current_truth ?? '') : '',
        correlationStatus: truth ? String(truth.correlation_status ?? '') : '',
        lastCheckedAt: truth ? String(truth.last_verified_at_utc ?? '') : '',
        guardrails: [String(r.redaction_ref ?? '').trim() && `redaction_ref=${r.redaction_ref}`, guardrailsFor(key)]
          .filter(Boolean).join('; '),
        evalSettings: ev ? `case ${ev.case_name} · LOCKED=${ev.LOCKED} · asserts ${ev['assertion types']}` : '',
        flywheelFlags: fw ? `A=${fw['Tier A']} B=${fw['Tier B']} C=${fw['Tier C']} · sources: ${fw['folly sources']}` : '',
        rubric: ru ? [ru['criterion 1 (w)'], ru['criterion 2 (w)'], ru['criterion 3 (w)'], ru['criterion 4 (w)']].filter(Boolean).join(', ') : '',
        researchAuthority: re ? `${re['primary world-leader authority']} · refresh ${re['refresh cadence']}` : '',
        exampleBank: ex ? `${ex.intent_key}` : '',
        beats: be ? ['1 noticed', '2 means', '3 action', '4 review', '5 undo'].filter((b) => String(be[b]).includes('✓')).join(' / ') : '',
        wiredWhen: wm ? `${wm['wired when']} · verify: ${wm['verification checkpoint']}` : '',
        notVerified,
      },
    });
    edges.push({ id: `e.${g}.${key}`, source: `director.${g}`, target: key });

    if (String(cellVal(r.evalGate)) === 'true') {
      const caseName = ev ? String(ev.case_name) : '';
      const realCase = caseName && !caseName.startsWith('TBD');
      gates.push({
        id: `gate.eval.${key}`, entityId: key, gateType: 'eval',
        status: realCase && truth && String(truth.latest_e2e_gate).trim() === 'pass' ? 'passed' : 'needs-review',
        evidence: caseName || null,
        blockingReason: realCase ? null : 'golden case not yet seeded (TBD in its wave)',
        lastCheckedAt: truth ? String(truth.last_verified_at_utc ?? '') || null : null,
      });
    }
    if (String(r.redaction_ref ?? '').trim()) {
      gates.push({
        id: `gate.guardrail.${key}`, entityId: key, gateType: 'guardrail',
        status: 'covered', evidence: `redaction_ref=${String(r.redaction_ref).trim()}`,
        blockingReason: null, lastCheckedAt: null,
      });
    }
  }

  for (const g of GROUPS) {
    const d = entities.find((e) => e.id === `director.${g}`);
    d.status = worstStatus(entities.filter((e) => e.kind === 'assistant' && e.group === g).map((e) => e.status));
  }
  entities[0].status = worstStatus(entities.filter((e) => e.kind === 'director').map((e) => e.status));

  const spec = {
    meta: {
      specVersion: 1,
      generatedBy: 'sync/loop-ops-import.mjs',
      generatedAt: new Date().toISOString(),
      masterSpec: basename(specPath),
      masterSpecMtime: statSync(specPath).mtime.toISOString(),
      truthSync: truthUsed ? basename(truthPath) : null,
      entityCount: entities.length,
      assistantCount: registry.length,
      productionWritesEnabled: false,
      links: { meowOps: 'https://github.com/merak3i/meow-ops', patherle: 'https://github.com/merak3i/patherle' },
    },
    entities, edges,
  };

  const specBlob = JSON.stringify(spec, null, 2);
  const gatesBlob = JSON.stringify(gates, null, 2);
  // Secret hygiene: generated JSON must never carry credentials or long
  // base64 runs, even though the directory is gitignored.
  const SECRET_RE = /sk-[A-Za-z0-9_-]{8,}|ghp_[A-Za-z0-9]{8,}|GOCSPX-[A-Za-z0-9_-]{8,}|AKIA[A-Z0-9]{12,}|[A-Za-z0-9+/]{41,}={0,2}/;
  for (const [name, blob] of [['spec.json', specBlob], ['gates.json', gatesBlob]]) {
    const hit = blob.match(SECRET_RE);
    if (hit) {
      console.error(`loop-ops-import: secret-pattern hit in generated ${name} ("${hit[0].slice(0, 12)}…") — nothing written.`);
      process.exit(1);
    }
  }

  mkdirSync(outDir, { recursive: true });
  // Write-then-rename so a crash mid-write never leaves a torn file.
  for (const [name, blob] of [['spec.json', specBlob], ['gates.json', gatesBlob]]) {
    const tmp = join(outDir, `.${name}.tmp`);
    writeFileSync(tmp, blob);
    renameSync(tmp, join(outDir, name));
  }
  console.log(`loop-ops-import: OK — ${entities.length} entities (${registry.length} surfaces), ${edges.length} edges, ${gates.length} gates → ${outDir}`);
  console.log(`loop-ops-import: truth-sync ${truthUsed ? `enriched from ${basename(truthPath)}` : 'NOT found — statuses reflect workbook coverage only'}`);
}

main().catch((err) => {
  console.error(`loop-ops-import: FAILED — ${err.message}`);
  process.exit(1);
});
