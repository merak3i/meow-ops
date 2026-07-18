#!/usr/bin/env node

import {
  queryAgentEvidence, rebuildEvidenceIndex, searchEvidenceIndex,
} from './project-evidence.mjs';

function option(name) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : null;
}
const action = process.argv[2] || 'status';

if (action === 'reindex') {
  console.log(JSON.stringify(rebuildEvidenceIndex(), null, 2));
} else if (action === 'search') {
  const search = option('query');
  const project_id = option('project');
  const indexed = searchEvidenceIndex({ search, project_id, limit: option('limit') });
  const result = indexed || queryAgentEvidence({ search, project_id, limit: option('limit') });
  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} else if (action === 'status') {
  const result = queryAgentEvidence({ limit: 1 });
  console.log(JSON.stringify({ ok: true, events: result.total, page_limit: result.limit }, null, 2));
} else {
  console.error('Usage: project-evidence-cli.mjs reindex|search|status [--query TEXT] [--project ID] [--limit N]');
  process.exitCode = 1;
}
