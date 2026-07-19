const AGENT_TOPIC_IDS = [
  'structured-output-agent', 'grounded-rag-agent', 'react-planning-agent', 'multi-tool-orchestrator',
  'memory-conversation-agent', 'human-approval-agent', 'cost-aware-router', 'event-automation-agent',
  'multi-agent-debate', 'self-reflective-eval-agent', 'observable-production-agent',
  'open-source-framework-contribution',
];

export const AGENT_ENGINEERING_CURRICULUM = [
  ['structured-output-agent', 'Structured Output Agent', 'A schema acts like a customs desk: valid responses pass and malformed responses return for repair.', 1, ['schemas', 'validation', 'retries']],
  ['grounded-rag-agent', 'RAG Agent with Citation Grounding', 'Retrieval gives an answer an open-book evidence packet and requires every important claim to point back to it.', 2, ['retrieval', 'citations', 'confidence']],
  ['react-planning-agent', 'ReAct Planning Agent', 'A bounded observe, decide, act, and reflect loop behaves like a careful technician with a stop rule.', 2, ['planning', 'loops', 'degradation']],
  ['multi-tool-orchestrator', 'Multi-Tool Orchestrator Agent', 'A dispatcher matches each job to an allowed specialist, coordinates safe parallel work, and resolves collisions.', 3, ['tools', 'permissions', 'parallelism']],
  ['memory-conversation-agent', 'Memory-Enabled Conversational Agent', 'Working memory is a desk; long-term recall is a labeled archive that returns only relevant folders.', 3, ['memory', 'compression', 'relevance']],
  ['human-approval-agent', 'Human-in-the-Loop Approval Agent', 'A safety gate pauses uncertain or consequential work until a person validates the next move.', 3, ['approval', 'uncertainty', 'audit']],
  ['cost-aware-router', 'Cost-Aware Agent Router', 'A travel desk chooses the cheapest vehicle that can safely complete each journey within its budget.', 3, ['routing', 'budgets', 'analytics']],
  ['event-automation-agent', 'Event-Triggered Automation Agent', 'A reliable mailroom receives events once, survives retries, and quarantines work it cannot safely deliver.', 4, ['webhooks', 'queues', 'idempotency']],
  ['multi-agent-debate', 'Multi-Agent Debate System', 'Several specialists propose answers while an independent chair compares evidence and records uncertainty.', 4, ['multi-agent', 'consensus', 'critique']],
  ['self-reflective-eval-agent', 'Self-Reflective Agent with Auto-Eval', 'A maker builds, a measurable rubric inspects, and the next attempt changes only what failed.', 4, ['evaluation', 'reflection', 'metrics']],
  ['observable-production-agent', 'Production Agent with Observability', 'A flight recorder makes cost, latency, loops, failures, canaries, and rollback visible before users report trouble.', 5, ['observability', 'canary', 'rollback']],
  ['open-source-framework-contribution', 'Open Source Agent Framework Contribution', 'A reusable pattern earns trust through clear code, tests, documentation, benchmarks, and maintainer review.', 5, ['open-source', 'benchmarks', 'documentation']],
].map(([topic_id, title, summary, difficulty, tags], index) => ({
  topic_id, title, summary, lane: 'code', difficulty, tags,
  prerequisite_ids: index ? [AGENT_TOPIC_IDS[index - 1]] : [],
  approved_for_projection: true,
}));

export const SIDE_QUESTS = [
  { topic_id: 'product-proof-translation', title: 'Product Proof Translation', summary: 'Turn a technical reliability result into a user-visible promise with a measurable acceptance condition.', lane: 'product', difficulty: 2, tags: ['product', 'outcomes'] },
  { topic_id: 'marketing-proof-story', title: 'Marketing Proof Story', summary: 'Explain a shipped capability with a plain-language before, mechanism, and verified after story.', lane: 'marketing', difficulty: 2, tags: ['marketing', 'story'] },
  { topic_id: 'gtm-proof-channel', title: 'GTM Proof Channel', summary: 'Match a verified capability to the audience and channel where its evidence answers a real adoption barrier.', lane: 'gtm', difficulty: 3, tags: ['gtm', 'distribution'] },
  { topic_id: 'sales-proof-conversation', title: 'Sales Proof Conversation', summary: 'Connect an operational pain to a verified capability, qualification question, and honest next commitment.', lane: 'sales', difficulty: 3, tags: ['sales', 'qualification'] },
].map((topic) => ({ ...topic, prerequisite_ids: [], approved_for_projection: true }));
