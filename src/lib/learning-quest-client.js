const OFFLINE_MESSAGE = 'The local learning helper is offline. Start it with `npm run agents:install`, then retry.';
const OUTDATED_MESSAGE = 'Your local helper is out of date. Restart it with `npm run agents:install`, then retry.';
const GENERIC_MESSAGE = 'The local learning helper could not complete that action.';

function sentence(value) {
  const cleaned = String(value || '')
    .replace(/^\[learning-quest\]\s*/i, '')
    .trim();
  if (!cleaned) return '';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1).replace(/[.!?]*$/, '.');
}

export function learningQuestMutationMessage(result) {
  if (!result) return OFFLINE_MESSAGE;
  if (result.status === 404) return OUTDATED_MESSAGE;
  return sentence(result.error) || GENERIC_MESSAGE;
}

export function learningQuestHelperMessage(snapshot) {
  return Number(snapshot?.schema_version || 0) < 2 ? OUTDATED_MESSAGE : '';
}
