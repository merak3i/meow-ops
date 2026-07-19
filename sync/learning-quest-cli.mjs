#!/usr/bin/env node
import { AGENT_ENGINEERING_CURRICULUM, SIDE_QUESTS } from './learning-quest-curriculum.mjs';
import { buildLearningQuestSnapshot, upsertLearningTopic } from './learning-quest.mjs';

const command = process.argv[2];

if (command === 'seed-agent-engineering') {
  const sourceRoot = process.env.MEOW_LEARNING_PROJECT_ROOT || null;
  for (const topic of [...AGENT_ENGINEERING_CURRICULUM, ...SIDE_QUESTS]) {
    upsertLearningTopic({ ...topic, source_project_root: topic.lane === 'code' ? sourceRoot : null });
  }
  const snapshot = buildLearningQuestSnapshot();
  console.log(`[learning-quest] seeded ${snapshot.summary.total_topics} generic topics`);
} else if (command === 'summary') {
  const snapshot = buildLearningQuestSnapshot();
  console.log(JSON.stringify({ summary: snapshot.summary, analytics: snapshot.analytics }, null, 2));
} else {
  console.error('Usage: learning-quest-cli.mjs seed-agent-engineering|summary');
  process.exitCode = 1;
}
