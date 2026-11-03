// How the Swarm panel learns which models each harness runs: harness config,
// Meow Ops sessions, AutoSwarm call evidence and the roster. New models are
// flagged for a week after they first appear, never on the very first scan.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { modelCatalog, modelsInText, readDeclaredModels } from '../swarm-models.mjs';

const DAY = 24 * 60 * 60 * 1000;

test('model ids are read from TOML, YAML and JSON settings without guessing', () => {
  const toml = 'model = "gpt-5.5-codex"\nmodel_reasoning_effort = "xhigh"\n[profiles.fast]\nmodel = "gpt-5.5-mini"\n# model = "commented"\n';
  assert.deepEqual(modelsInText(toml, '.toml'), [{ id: 'gpt-5.5-codex', isDefault: true }, { id: 'gpt-5.5-mini', isDefault: false }]);
  const yaml = 'model:\n  default: x\nmodel: hermes-4-405b\nprovider: nous\n';
  assert.deepEqual(modelsInText(yaml, '.yaml').map((item) => item.id), ['hermes-4-405b']);
  const json = JSON.stringify({ model: 'opus', permissions: { allow: [] }, profiles: [{ name: 'a', modelId: 'anthropic/claude-opus-5.5' }], models: ['deepseek/v4.1-flash', 'https://not-a-model'], theme: 'dark' });
  assert.deepEqual(modelsInText(json, '.json').map((item) => item.id), ['opus', 'anthropic/claude-opus-5.5', 'deepseek/v4.1-flash']);
  assert.deepEqual(modelsInText('{"model": "default"}', '.json'), []);
  assert.deepEqual(modelsInText('not json', '.json'), []);
});

test('declared models come from each harness settings file only', () => {
  const home = mkdtempSync(join(tmpdir(), 'meow-models-'));
  try {
    mkdirSync(join(home, '.codex'), { recursive: true });
    writeFileSync(join(home, '.codex', 'config.toml'), 'model = "luna"\n');
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ model: 'opus' }));
    mkdirSync(join(home, '.dsh', 'profiles'), { recursive: true });
    writeFileSync(join(home, '.dsh', 'profiles', 'acp.json'), JSON.stringify({ default_model: 'anthropic/claude-opus-5.5', second_actor: { model: 'deepseek/v4.1-flash' } }));
    mkdirSync(join(home, '.dsh', 'sessions'), { recursive: true });
    writeFileSync(join(home, '.dsh', 'sessions', 'x.json'), JSON.stringify({ model: 'should-not-read' }));
    const declared = readDeclaredModels(['codex', 'claude-code', 'dsh', 'hermes'], { home, env: {} });
    assert.deepEqual(declared.codex, [{ id: 'luna', isDefault: true }]);
    assert.deepEqual(declared['claude-code'], [{ id: 'opus', isDefault: true }]);
    assert.deepEqual(declared.dsh.map((item) => item.id).sort(), ['anthropic/claude-opus-5.5', 'deepseek/v4.1-flash']);
    assert.deepEqual(declared.hermes, []);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test('evidence merges per model, new models are flagged after the first scan', () => {
  const dir = mkdtempSync(join(tmpdir(), 'meow-models-state-'));
  const statePath = join(dir, 'models.json');
  try {
    const t0 = Date.parse('2026-11-01T00:00:00Z');
    const first = modelCatalog(['codex', 'claude-code', 'hermes'], {
      declared: { codex: [{ id: 'luna', isDefault: true }] },
      sessions: [{ source: 'codex', model: 'luna', started_at: '2026-10-31T10:00:00Z' }, { source: 'claude', model: 'claude-opus-5-5', started_at: '2026-10-30T10:00:00Z' }, { source: 'aider', model: 'x' }],
      statePath, now: t0,
    });
    assert.deepEqual(first.codex.models.map((item) => [item.id, item.sources, item.default, item.new]), [['luna', ['config', 'sessions'], true, false]]);
    assert.equal(first['claude-code'].models[0].id, 'claude-opus-5-5');
    assert.equal(first['claude-code'].models[0].new, false);

    const later = modelCatalog(['codex', 'claude-code', 'hermes'], {
      declared: { codex: [{ id: 'luna', isDefault: true }] },
      sessions: [{ source: 'codex', model: 'luna-2', started_at: '2026-11-02T10:00:00Z' }],
      calls: [
        { id: 'call_1', provider: 'hermes', model: 'hermes-4', effort: 'high', status: 'failed', error: 'hermes did not advertise a reasoning-effort control for this model; omit --effort' },
        { id: 'call_2', provider: 'claude-code', model: 'opus', effort: 'high', status: 'completed' },
        { id: 'call_3', provider: 'codex', model: 'nope', status: 'failed', errorCode: 'invalid_model' },
      ],
      roster: { hermes: ['hermes-4'] },
      statePath, now: t0 + 2 * DAY,
    });
    const codex = Object.fromEntries(later.codex.models.map((item) => [item.id, item]));
    assert.equal(codex['luna-2'].new, true);
    assert.equal(codex.luna.new, false);
    assert.equal(codex.nope.rejected, 1);
    assert.equal(later.hermes.effort.supported, false);
    assert.equal(later.hermes.effort.evidence, 'call_1');
    assert.equal(later.hermes.models[0].effortRejected, 1);
    assert.deepEqual(later.hermes.models[0].sources, ['autoswarm', 'roster']);
    assert.equal(later['claude-code'].effort.supported, true);
    assert.equal(later['claude-code'].models.find((item) => item.id === 'opus').accepted, 1);

    const muchLater = modelCatalog(['codex'], { sessions: [{ source: 'codex', model: 'luna-2' }], statePath, now: t0 + 20 * DAY });
    assert.equal(muchLater.codex.models.find((item) => item.id === 'luna-2').new, false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
