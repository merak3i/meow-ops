import { test } from 'node:test';
import assert from 'node:assert/strict';
import { claudeProjectRoots } from '../claude-roots.mjs';

const home = '/Users/me';
const real = (p) => p;

test('reads both the legacy and the XDG Claude Code project roots', () => {
  const present = new Set(['/Users/me/.claude/projects', '/Users/me/.config/claude/projects']);
  assert.deepEqual(claudeProjectRoots({ env: {}, home, exists: (p) => present.has(p), real }),
    ['/Users/me/.config/claude/projects', '/Users/me/.claude/projects']);
});

test('CLAUDE_CONFIG_DIR entries are honoured, expanded and deduplicated', () => {
  const present = new Set(['/work/claude-a/projects', '/Users/me/alt/projects', '/Users/me/.claude/projects']);
  const roots = claudeProjectRoots({
    env: { CLAUDE_CONFIG_DIR: '/work/claude-a, ~/alt, /work/claude-a' }, home, exists: (p) => present.has(p), real,
  });
  assert.deepEqual(roots, ['/work/claude-a/projects', '/Users/me/alt/projects', '/Users/me/.claude/projects']);
});

test('symlinked duplicates are collapsed and a missing install keeps the default path', () => {
  const present = new Set(['/Users/me/.claude/projects', '/Users/me/.config/claude/projects']);
  const link = (p) => (p === '/Users/me/.config/claude/projects' ? '/Users/me/.claude/projects' : p);
  assert.deepEqual(claudeProjectRoots({ env: {}, home, exists: (p) => present.has(p), real: link }), ['/Users/me/.config/claude/projects']);
  assert.deepEqual(claudeProjectRoots({ env: {}, home, exists: () => false, real }), ['/Users/me/.claude/projects']);
});
