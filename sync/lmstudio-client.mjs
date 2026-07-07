const DEFAULT_BASE_URL = 'http://127.0.0.1:1234/v1';
const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MODEL = 'local-model';

function note(notes, value) {
  if (Array.isArray(notes)) notes.push(value);
}

export function resolveLmStudioEndpoint(env = process.env) {
  const raw = env.MEOW_LOCAL_LLM_URL || DEFAULT_BASE_URL;
  const url = new URL(raw);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname)) {
    throw new Error('[local-only] LM Studio URL must resolve to 127.0.0.1 or localhost');
  }
  const base = url.href.replace(/\/+$/, '');
  if (base.endsWith('/chat/completions')) return base;
  return `${base}/chat/completions`;
}

async function parseCompletionJson(response) {
  let json;
  try {
    json = await response.json();
  } catch {
    return null;
  }
  const content = json?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') return null;
  try {
    const parsed = JSON.parse(content);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function postOnce({ endpoint, messages, env, transport, signal }) {
  const response = await transport(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal,
    body: JSON.stringify({
      model: env.MEOW_LOCAL_LLM_MODEL || DEFAULT_MODEL,
      response_format: { type: 'json_object' },
      messages,
    }),
  });
  if (!response?.ok) return { status: 'unavailable', value: null };
  const value = await parseCompletionJson(response);
  return value ? { status: 'ok', value } : { status: 'malformed', value: null };
}

export async function callLmStudioJson({
  messages,
  env = process.env,
  transport = globalThis.fetch,
  notes,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  if (typeof transport !== 'function') {
    note(notes, 'intake skipped: no local model');
    return null;
  }

  const endpoint = resolveLmStudioEndpoint(env);
  for (let attempt = 0; attempt < 2; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const result = await postOnce({
        endpoint,
        messages,
        env,
        transport,
        signal: controller.signal,
      });
      if (result.status === 'ok') return result.value;
      if (result.status !== 'malformed') {
        note(notes, 'intake skipped: no local model');
        return null;
      }
    } catch {
      note(notes, 'intake skipped: no local model');
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

  note(notes, 'intake skipped: malformed json');
  return null;
}
