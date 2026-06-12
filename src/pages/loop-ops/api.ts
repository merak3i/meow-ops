// Loop-Ops data access (spec §Phase 4). Spec/runs load static-first — the
// gitignored local files are served by Vite in dev and simply 404 on the
// hosted build — then fall back to the local API on 127.0.0.1:7337, which is
// how the operator gets fresh local data while reviewing the deployed page.
// Status and sync are API-only actions (dev: vite middleware mirror).
import type { LoopSpec } from './types';

const DEV = import.meta.env.DEV;
const API_BASE = DEV ? '/api/loop-ops' : 'http://localhost:7337/loop-ops';

export interface LoopOpsStatus {
  ok: boolean;
  files: Record<string, { mtime: number; size: number } | null>;
  productionWritesEnabled: boolean;
}

export interface LoopOpsSyncResult {
  ok: boolean;
  code?: number;
  stdout?: string;
  stderr?: string;
  error?: string;
  mtime?: number | null;
}

async function fetchJson(url: string, init?: RequestInit): Promise<unknown> {
  // no-store everywhere: status/spec freshness is the whole point of these
  // calls, and the dev middleware sends no Cache-Control headers.
  const res = await fetch(url, { cache: 'no-store', ...init });
  if (!res.ok) throw new Error(`${url} HTTP ${res.status}`);
  return res.json();
}

export async function fetchLoopSpecRaw(): Promise<unknown> {
  try {
    return await fetchJson(`/data/loop-ops/spec.json?t=${Date.now()}`);
  } catch (staticErr) {
    try {
      return await fetchJson(`${API_BASE}/spec`);
    } catch {
      throw staticErr instanceof Error ? staticErr : new Error(String(staticErr));
    }
  }
}

export async function fetchLoopStatus(): Promise<LoopOpsStatus | null> {
  try {
    // ?t= bust matters even with no-store: the PWA service worker is
    // cache-first by REQUEST URL and ignores fetch cache directives — the
    // same reason lib/queries.js busts every data fetch.
    return await fetchJson(`${API_BASE}/status?t=${Date.now()}`) as LoopOpsStatus;
  } catch {
    // The local API not running is a designed state, not an error.
    return null;
  }
}

export async function postLoopSync(): Promise<LoopOpsSyncResult> {
  try {
    return await fetchJson(`${API_BASE}/sync`, { method: 'POST' }) as LoopOpsSyncResult;
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export type { LoopSpec };
