/**
 * gen-demo-data.mjs
 * Generates realistic sample sessions.json + cost-summary.json for the meow-ops demo deployment.
 * Run: node scripts/gen-demo-data.mjs
 */

import { writeFileSync } from 'fs';
import { createHash } from 'crypto';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function uuid() {
  return createHash('sha256').update(Math.random().toString() + Date.now()).digest('hex').slice(0, 36)
    .replace(/^(.{8})(.{4})(.{4})(.{4})(.{12}).*/, '$1-$2-$3-$4-$5');
}

function ri(min, max) { return Math.floor(Math.random() * (max - min + 1)) + min; }
function rf(min, max) { return Math.random() * (max - min) + min; }
function pick(arr)    { return arr[Math.floor(Math.random() * arr.length)]; }

// Days ago → ISO string at a random hour
function daysAgo(days, durationSecs = 300) {
  const now = new Date('2026-04-11T18:00:00Z');
  const start = new Date(now.getTime() - days * 86_400_000 - ri(0, 50_000_000));
  const end   = new Date(start.getTime() + durationSecs * 1000);
  return { started_at: start.toISOString(), ended_at: end.toISOString() };
}

// ─── Pricing (per 1M tokens, USD) ────────────────────────────────────────────

const PRICING = {
  'claude-sonnet-4-6': { inp: 3.00,  out: 15.00, cc: 3.75, cr: 0.30  },
  'claude-haiku-4-5':  { inp: 0.80,  out: 4.00,  cc: 1.00, cr: 0.08  },
  'claude-opus-4':     { inp: 15.00, out: 75.00, cc: 18.75,cr: 1.50  },
  'gpt-4o':            { inp: 2.50,  out: 10.00, cc: 0,    cr: 0      },
  'gpt-5':             { inp: 2.50,  out: 10.00, cc: 0,    cr: 0      },
  'o4-mini':           { inp: 1.10,  out: 4.40,  cc: 0,    cr: 0      },
  'codex-1':           { inp: 0.15,  out: 0.60,  cc: 0,    cr: 0      },
  'deepseek-r1':       { inp: 0.55,  out: 2.19,  cc: 0,    cr: 0.14   },
};

function calcCost(model, inp, out, cc, cr) {
  const p = PRICING[model] ?? PRICING['claude-sonnet-4-6'];
  return (inp * p.inp + out * p.out + cc * p.cc + cr * p.cr) / 1_000_000;
}

// ─── Tool sets per cat_type ───────────────────────────────────────────────────

function toolsFor(cat_type) {
  switch (cat_type) {
    case 'builder':
      return { Edit: ri(6,20), Write: ri(3,10), Read: ri(4,14), Bash: ri(2,8) };
    case 'detective':
      return { Read: ri(15,40), Grep: ri(10,30), Glob: ri(5,15), Bash: ri(1,5) };
    case 'commander':
      return { Bash: ri(15,40), Read: ri(3,10), Edit: ri(1,4) };
    case 'architect':
      return { Agent: ri(2,6), Read: ri(10,22), Edit: ri(3,8), Bash: ri(2,6) };
    case 'guardian':
      return { Grep: ri(8,20), Read: ri(12,30), Glob: ri(4,12) };
    case 'storyteller':
      return { Write: ri(8,18), Edit: ri(4,10), Read: ri(3,8) };
    case 'ghost':
      return {};
  }
}

// ─── Token counts per type + model ───────────────────────────────────────────

function tokensFor(cat_type, model) {
  const haiku    = model === 'claude-haiku-4-5';
  const opus     = model === 'claude-opus-4';
  const codex    = model === 'codex-1';
  const deepseek = model === 'deepseek-r1';

  const scale = opus ? 1.6 : haiku ? 0.5 : codex ? 0.4 : deepseek ? 0.7 : 1.0;

  switch (cat_type) {
    case 'builder':
      return {
        input_tokens:          Math.round(ri(18000, 75000) * scale),
        output_tokens:         Math.round(ri(4000, 18000)  * scale),
        cache_creation_tokens: Math.round(ri(2000, 15000)  * scale),
        cache_read_tokens:     Math.round(ri(8000, 40000)  * scale),
      };
    case 'detective':
      return {
        input_tokens:          Math.round(ri(30000, 110000) * scale),
        output_tokens:         Math.round(ri(2000, 8000)    * scale),
        cache_creation_tokens: Math.round(ri(5000, 20000)   * scale),
        cache_read_tokens:     Math.round(ri(20000, 60000)  * scale),
      };
    case 'commander':
      return {
        input_tokens:          Math.round(ri(12000, 45000) * scale),
        output_tokens:         Math.round(ri(3000, 10000)  * scale),
        cache_creation_tokens: Math.round(ri(1000, 8000)   * scale),
        cache_read_tokens:     Math.round(ri(5000, 20000)  * scale),
      };
    case 'architect':
      return {
        input_tokens:          Math.round(ri(40000, 100000) * scale),
        output_tokens:         Math.round(ri(8000, 25000)   * scale),
        cache_creation_tokens: Math.round(ri(8000, 30000)   * scale),
        cache_read_tokens:     Math.round(ri(15000, 50000)  * scale),
      };
    case 'guardian':
      return {
        input_tokens:          Math.round(ri(25000, 80000) * scale),
        output_tokens:         Math.round(ri(1500, 6000)   * scale),
        cache_creation_tokens: Math.round(ri(3000, 12000)  * scale),
        cache_read_tokens:     Math.round(ri(10000, 35000) * scale),
      };
    case 'storyteller':
      return {
        input_tokens:          Math.round(ri(8000, 30000) * scale),
        output_tokens:         Math.round(ri(5000, 20000) * scale),
        cache_creation_tokens: Math.round(ri(1000, 5000)  * scale),
        cache_read_tokens:     Math.round(ri(2000, 10000) * scale),
      };
    case 'ghost':
    default:
      return { input_tokens: ri(0, 3000), output_tokens: ri(0, 300), cache_creation_tokens: 0, cache_read_tokens: 0 };
  }
}

// ─── Make a standalone session ────────────────────────────────────────────────

function makeSession({
  project, model, cat_type, daysBack, durationSecs,
  source = 'claude', parent_session_id = null, agent_slug = null,
  agent_depth = 0, is_sidechain = false,
}) {
  const session_id   = uuid();
  const { started_at, ended_at } = daysAgo(daysBack, durationSecs);
  const tk = tokensFor(cat_type, model);
  const total_tokens = tk.input_tokens + tk.output_tokens + tk.cache_creation_tokens + tk.cache_read_tokens;
  const cost = calcCost(model, tk.input_tokens, tk.output_tokens, tk.cache_creation_tokens, tk.cache_read_tokens);
  const is_ghost = cat_type === 'ghost';
  const msgs = is_ghost ? ri(0, 2) : ri(6, 30);

  return {
    session_id,
    project,
    model,
    entrypoint: null,
    git_branch: pick(['main', 'feature/dashboard', 'fix/token-calc', 'chore/cleanup', null]),
    started_at,
    ended_at,
    duration_seconds: durationSecs,
    message_count:          msgs,
    user_message_count:     Math.ceil(msgs / 2),
    assistant_message_count:Math.floor(msgs / 2),
    input_tokens:           tk.input_tokens,
    output_tokens:          tk.output_tokens,
    cache_creation_tokens:  tk.cache_creation_tokens,
    cache_read_tokens:      tk.cache_read_tokens,
    total_tokens,
    estimated_cost_usd:     parseFloat(cost.toFixed(4)),
    cat_type,
    is_ghost,
    is_subagent:            agent_depth > 0,
    source,
    cwd: `/Users/dev/projects/${project}`,
    tools: toolsFor(cat_type),
    ...(parent_session_id && { parent_session_id }),
    ...(agent_slug && { agent_slug, agent_id: uuid(), agent_depth, is_sidechain }),
  };
}

// ─── Agent slugs ─────────────────────────────────────────────────────────────

const SUBAGENT_ROLES = [
  'code-explorer', 'code-architect', 'code-reviewer',
  'feature-builder', 'test-writer', 'docs-writer',
  'security-auditor', 'refactor-agent',
];

// ─── Build a multi-agent run ──────────────────────────────────────────────────

function makeAgentRun({ project, model, subagentModel, numSubs, daysBack }) {
  const parentDuration = ri(180, 480);
  const parent = makeSession({
    project, model, cat_type: 'architect',
    daysBack, durationSecs: parentDuration, source: 'claude',
  });

  const subRoles = SUBAGENT_ROLES.sort(() => Math.random() - 0.5).slice(0, numSubs);

  // Subagents overlap in time (some parallel, some sequential)
  const subs = subRoles.map((role, i) => {
    const subDuration   = ri(30, 180);
    const offsetSeconds = i < 2 ? ri(5, 20) : ri(30, 120); // first two can overlap
    const subDaysBack   = daysBack - offsetSeconds / 86400;

    return makeSession({
      project,
      model:            subagentModel ?? (i === 0 ? 'claude-haiku-4-5' : model),
      cat_type:         pick(['builder', 'detective', 'guardian', 'commander']),
      daysBack:         subDaysBack,
      durationSecs:     subDuration,
      source:           'claude',
      parent_session_id: parent.session_id,
      agent_slug:       role,
      agent_depth:      1,
      is_sidechain:     i === numSubs - 1 && Math.random() > 0.7,
    });
  });

  return [parent, ...subs];
}

// ─── Generate all sessions ────────────────────────────────────────────────────

const sessions = [];

// ── 5 multi-agent runs ────────────────────────────────────────────────────────
sessions.push(...makeAgentRun({ project: 'meow-ops',       model: 'claude-sonnet-4-6', subagentModel: 'claude-haiku-4-5', numSubs: 3, daysBack: 1   }));
sessions.push(...makeAgentRun({ project: 'api-integration', model: 'claude-sonnet-4-6', subagentModel: 'claude-haiku-4-5', numSubs: 2, daysBack: 3   }));
sessions.push(...makeAgentRun({ project: 'data-pipeline',  model: 'gpt-4o',            subagentModel: 'gpt-4o',           numSubs: 3, daysBack: 7   }));
sessions.push(...makeAgentRun({ project: 'ui-redesign',    model: 'claude-sonnet-4-6', subagentModel: 'claude-haiku-4-5', numSubs: 2, daysBack: 12  }));
sessions.push(...makeAgentRun({ project: 'brand-campaign', model: 'claude-opus-4',     subagentModel: 'claude-sonnet-4-6',numSubs: 3, daysBack: 18  }));

// ── Standalone sessions spread over 30 days ───────────────────────────────────
const standaloneDefs = [
  // meow-ops — most active project
  { project: 'meow-ops',        model: 'claude-sonnet-4-6', cat_type: 'builder',     daysBack: 0,  durationSecs: ri(240,600)  },
  { project: 'meow-ops',        model: 'claude-sonnet-4-6', cat_type: 'detective',   daysBack: 1,  durationSecs: ri(180,400)  },
  { project: 'meow-ops',        model: 'claude-haiku-4-5',  cat_type: 'guardian',    daysBack: 2,  durationSecs: ri(90,200)   },
  { project: 'meow-ops',        model: 'claude-sonnet-4-6', cat_type: 'builder',     daysBack: 2,  durationSecs: ri(300,700)  },
  { project: 'meow-ops',        model: 'claude-opus-4',     cat_type: 'architect',   daysBack: 4,  durationSecs: ri(400,900)  },
  { project: 'meow-ops',        model: 'claude-sonnet-4-6', cat_type: 'commander',   daysBack: 5,  durationSecs: ri(120,300)  },
  { project: 'meow-ops',        model: 'claude-sonnet-4-6', cat_type: 'builder',     daysBack: 6,  durationSecs: ri(200,500)  },
  { project: 'meow-ops',        model: 'claude-haiku-4-5',  cat_type: 'ghost',       daysBack: 6,  durationSecs: ri(10,40)    },
  { project: 'meow-ops',        model: 'claude-sonnet-4-6', cat_type: 'detective',   daysBack: 8,  durationSecs: ri(180,420)  },
  { project: 'meow-ops',        model: 'claude-sonnet-4-6', cat_type: 'builder',     daysBack: 10, durationSecs: ri(300,600)  },
  { project: 'meow-ops',        model: 'claude-sonnet-4-6', cat_type: 'guardian',    daysBack: 14, durationSecs: ri(150,350)  },
  { project: 'meow-ops',        model: 'claude-sonnet-4-6', cat_type: 'builder',     daysBack: 17, durationSecs: ri(400,800)  },

  // api-integration
  { project: 'api-integration', model: 'claude-sonnet-4-6', cat_type: 'detective',   daysBack: 2,  durationSecs: ri(200,500)  },
  { project: 'api-integration', model: 'codex-1',           cat_type: 'commander',   daysBack: 4,  durationSecs: ri(100,280), source: 'codex' },
  { project: 'api-integration', model: 'gpt-4o',            cat_type: 'builder',     daysBack: 5,  durationSecs: ri(300,600), source: 'codex' },
  { project: 'api-integration', model: 'claude-sonnet-4-6', cat_type: 'builder',     daysBack: 8,  durationSecs: ri(250,550)  },
  { project: 'api-integration', model: 'o4-mini',           cat_type: 'detective',   daysBack: 9,  durationSecs: ri(180,380), source: 'codex' },
  { project: 'api-integration', model: 'claude-haiku-4-5',  cat_type: 'ghost',       daysBack: 10, durationSecs: ri(10,30)    },
  { project: 'api-integration', model: 'gpt-5',             cat_type: 'architect',   daysBack: 11, durationSecs: ri(350,700), source: 'codex' },
  { project: 'api-integration', model: 'claude-sonnet-4-6', cat_type: 'guardian',    daysBack: 15, durationSecs: ri(200,420)  },
  { project: 'api-integration', model: 'codex-1',           cat_type: 'builder',     daysBack: 20, durationSecs: ri(280,550), source: 'codex' },

  // data-pipeline
  { project: 'data-pipeline',   model: 'claude-sonnet-4-6', cat_type: 'builder',     daysBack: 6,  durationSecs: ri(300,650)  },
  { project: 'data-pipeline',   model: 'deepseek-r1',       cat_type: 'detective',   daysBack: 8,  durationSecs: ri(200,500), source: 'codex' },
  { project: 'data-pipeline',   model: 'claude-sonnet-4-6', cat_type: 'commander',   daysBack: 9,  durationSecs: ri(150,350)  },
  { project: 'data-pipeline',   model: 'gpt-4o',            cat_type: 'builder',     daysBack: 13, durationSecs: ri(280,600), source: 'codex' },
  { project: 'data-pipeline',   model: 'deepseek-r1',       cat_type: 'architect',   daysBack: 16, durationSecs: ri(400,800), source: 'codex' },
  { project: 'data-pipeline',   model: 'claude-haiku-4-5',  cat_type: 'ghost',       daysBack: 16, durationSecs: ri(10,25)    },
  { project: 'data-pipeline',   model: 'claude-sonnet-4-6', cat_type: 'detective',   daysBack: 22, durationSecs: ri(180,400)  },

  // ui-redesign
  { project: 'ui-redesign',     model: 'claude-sonnet-4-6', cat_type: 'storyteller', daysBack: 11, durationSecs: ri(200,500)  },
  { project: 'ui-redesign',     model: 'claude-opus-4',     cat_type: 'architect',   daysBack: 13, durationSecs: ri(500,900)  },
  { project: 'ui-redesign',     model: 'claude-haiku-4-5',  cat_type: 'builder',     daysBack: 14, durationSecs: ri(180,420)  },
  { project: 'ui-redesign',     model: 'gpt-4o',            cat_type: 'detective',   daysBack: 15, durationSecs: ri(200,450), source: 'codex' },
  { project: 'ui-redesign',     model: 'claude-sonnet-4-6', cat_type: 'builder',     daysBack: 19, durationSecs: ri(300,600)  },
  { project: 'ui-redesign',     model: 'codex-1',           cat_type: 'commander',   daysBack: 21, durationSecs: ri(100,280), source: 'codex' },
  { project: 'ui-redesign',     model: 'claude-sonnet-4-6', cat_type: 'guardian',    daysBack: 25, durationSecs: ri(200,400)  },

  // brand-campaign
  { project: 'brand-campaign',  model: 'claude-sonnet-4-6', cat_type: 'storyteller', daysBack: 16, durationSecs: ri(200,500)  },
  { project: 'brand-campaign',  model: 'claude-opus-4',     cat_type: 'storyteller', daysBack: 19, durationSecs: ri(300,650)  },
  { project: 'brand-campaign',  model: 'gpt-5',             cat_type: 'storyteller', daysBack: 20, durationSecs: ri(250,550), source: 'codex' },
  { project: 'brand-campaign',  model: 'claude-sonnet-4-6', cat_type: 'architect',   daysBack: 22, durationSecs: ri(300,600)  },
  { project: 'brand-campaign',  model: 'claude-haiku-4-5',  cat_type: 'ghost',       daysBack: 22, durationSecs: ri(10,30)    },
  { project: 'brand-campaign',  model: 'claude-sonnet-4-6', cat_type: 'builder',     daysBack: 26, durationSecs: ri(200,450)  },
  { project: 'brand-campaign',  model: 'o4-mini',           cat_type: 'detective',   daysBack: 28, durationSecs: ri(180,380), source: 'codex' },
];

for (const def of standaloneDefs) {
  sessions.push(makeSession({
    project:      def.project,
    model:        def.model,
    cat_type:     def.cat_type,
    daysBack:     def.daysBack,
    durationSecs: def.durationSecs,
    source:       def.source ?? 'claude',
  }));
}

// Sort by started_at descending (newest first — matches dashboard expectation)
sessions.sort((a, b) => new Date(b.started_at) - new Date(a.started_at));

// ─── Cost summary ─────────────────────────────────────────────────────────────

const now = new Date('2026-04-11T18:00:00Z');

function bucket(sessions, from, to) {
  const s = sessions.filter(s => {
    const t = new Date(s.started_at).getTime();
    return t >= from && t <= to;
  });
  return {
    cost:     parseFloat(s.reduce((a, x) => a + x.estimated_cost_usd, 0).toFixed(4)),
    tokens:   s.reduce((a, x) => a + x.total_tokens, 0),
    sessions: s.length,
  };
}

const todayStart      = new Date(now); todayStart.setUTCHours(0,0,0,0);
const weekStart       = new Date(now.getTime() - 7  * 86_400_000);
const lastWeekStart   = new Date(now.getTime() - 14 * 86_400_000);
const monthStart      = new Date(now.getTime() - 30 * 86_400_000);
const lastMonthStart  = new Date(now.getTime() - 60 * 86_400_000);
const yearStart       = new Date('2026-01-01T00:00:00Z');

// Daily summary (last 30 days)
const daily_summary = [];
for (let d = 29; d >= 0; d--) {
  const dayStart = new Date(now.getTime() - d * 86_400_000); dayStart.setUTCHours(0,0,0,0);
  const dayEnd   = new Date(dayStart.getTime() + 86_399_999);
  const daySessions = sessions.filter(s => {
    const t = new Date(s.started_at).getTime();
    return t >= dayStart.getTime() && t <= dayEnd.getTime();
  });
  daily_summary.push({
    date:                 dayStart.toISOString().slice(0, 10),
    session_count:        daySessions.length,
    total_input_tokens:   daySessions.reduce((a, x) => a + x.input_tokens, 0),
    total_output_tokens:  daySessions.reduce((a, x) => a + x.output_tokens, 0),
    total_cache_creation: daySessions.reduce((a, x) => a + x.cache_creation_tokens, 0),
    total_cache_read:     daySessions.reduce((a, x) => a + x.cache_read_tokens, 0),
    total_tokens:         daySessions.reduce((a, x) => a + x.total_tokens, 0),
    estimated_cost_usd:   parseFloat(daySessions.reduce((a, x) => a + x.estimated_cost_usd, 0).toFixed(4)),
    active_projects:      new Set(daySessions.map(s => s.project)).size,
    ghost_count:          daySessions.filter(s => s.is_ghost).length,
  });
}

// bySource breakdown
const byClaude = sessions.filter(s => s.source === 'claude');
const byCodex  = sessions.filter(s => s.source === 'codex');

const costSummary = {
  exportedAt: now.toISOString(),
  today:      bucket(sessions, todayStart.getTime(), now.getTime()),
  thisWeek:   bucket(sessions, weekStart.getTime(), now.getTime()),
  lastWeek:   bucket(sessions, lastWeekStart.getTime(), weekStart.getTime()),
  thisMonth:  bucket(sessions, monthStart.getTime(), now.getTime()),
  lastMonth:  bucket(sessions, lastMonthStart.getTime(), monthStart.getTime()),
  thisYear:   bucket(sessions, yearStart.getTime(), now.getTime()),
  allTime:    bucket(sessions, 0, now.getTime()),
  bySource: {
    claude: bucket(byClaude, 0, now.getTime()),
    codex:  bucket(byCodex,  0, now.getTime()),
  },
  daily_summary,
};

// ─── Write files ──────────────────────────────────────────────────────────────

writeFileSync('public/data/sessions.json',     JSON.stringify(sessions, null, 2));
writeFileSync('public/data/cost-summary.json', JSON.stringify(costSummary, null, 2));

console.log(`✅  Generated ${sessions.length} sessions`);
console.log(`    Claude: ${byClaude.length} sessions | Codex: ${byCodex.length} sessions`);
console.log(`    Total cost: $${costSummary.allTime.cost.toFixed(2)}`);
console.log(`    Total tokens: ${(costSummary.allTime.tokens / 1_000_000).toFixed(1)}M`);
console.log(`    Agent runs: 5 (${sessions.filter(s => s.parent_session_id).length} subagent sessions)`);
console.log(`    Ghost sessions: ${sessions.filter(s => s.is_ghost).length}`);
console.log(`\n    Written: public/data/sessions.json`);
console.log(`    Written: public/data/cost-summary.json`);
