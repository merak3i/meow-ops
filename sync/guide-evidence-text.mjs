// Only explicitly textual blocks become evidence. Images, opaque objects,
// tool arguments and privileged instructions have separate contracts.
export function guideText(value) {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map(guideText).filter(Boolean).join('\n');
  if (value && typeof value === 'object' && ['text', 'input_text', 'output_text'].includes(value.type)) return typeof value.text === 'string' ? value.text : '';
  return '';
}

export function boundGuideText(value, limit = 2_000) {
  const text = String(value);
  if (text.length <= limit) return text;
  const marker = '\n[... middle of recorded output omitted ...]\n';
  if (limit <= marker.length) return text.slice(0, Math.max(0, limit));
  const available = limit - marker.length;
  const head = Math.ceil(available / 2);
  const tail = Math.floor(available / 2);
  return `${text.slice(0, head)}${marker}${text.slice(-tail)}`;
}

export function guideUserParts(content, ambient = false) {
  const requests = [...content.matchAll(/<(user_query|USER_REQUEST)>([\s\S]*?)<\/\1>/g)];
  if (requests.length) {
    const context = content.replace(/<(user_query|USER_REQUEST)>[\s\S]*?<\/\1>/g, '').trim();
    return [
      ...(context ? [{ content: context, kind: 'ambient_context', suffix: 'context' }] : []),
      ...requests.map((match, index) => ({ content: match[2], kind: 'user_request', suffix: `request-${index}` })),
    ];
  }
  const onlyContext = ambient || /^\s*(?:<(?:environment_context|user_info|permissions|INSTRUCTIONS|system-reminder)\b|#\s*AGENTS\.md instructions\b)/i.test(content);
  return [{ content, kind: onlyContext ? 'ambient_context' : 'user_message', suffix: 'message' }];
}
