export interface StorageTotals {
  fileCount: number;
  logicalBytes: number;
  allocatedBytes: number | null;
  allocatedFileCount: number;
}
export interface StorageGrowth {
  status: 'available' | 'unavailable';
  logicalBytes: number | null;
  allocatedBytes: number | null;
  fileCount: number | null;
}
export interface StorageCategory extends StorageTotals { category: string }
export interface StorageModelBucket extends StorageTotals { kind: 'single' | 'mixed' | 'unknown'; models: string[] }
export interface StorageRoot extends StorageTotals {
  id: string;
  source: string;
  path: string;
  category: string;
  status: 'complete' | 'partial' | 'missing';
  oldestModifiedAt: string | null;
  newestModifiedAt: string | null;
  errorCount: number;
  categories: StorageCategory[];
  modelBuckets: StorageModelBucket[];
  growth: StorageGrowth;
}
export interface StorageSnapshot {
  schemaVersion: 1;
  scope: 'local-metadata-only';
  generatedAt: string;
  previousGeneratedAt: string | null;
  measurement: string;
  totals: StorageTotals;
  growth: StorageGrowth;
  coverage: { status: 'complete' | 'partial'; registeredRoots: number; completeRoots: number; missingRoots: number; partialRoots: number; errorCount: number; errorsTruncated: boolean };
  categories: StorageCategory[];
  modelBuckets: StorageModelBucket[];
  roots: StorageRoot[];
  unresolvedLocations?: { source: string; status: string; reason: string }[];
  errors: { rootId: string; code: string; operation: string }[];
}
export interface StorageResponse { snapshot: StorageSnapshot | null; refreshing: boolean; error?: string }

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const record = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
const signed = (value: unknown): value is number | null => value === null || (typeof value === 'number' && Number.isSafeInteger(value));
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value));
const maybeDate = (value: unknown): value is string | null => value === null || date(value);

function totals(value: unknown): value is StorageTotals {
  return record(value) && count(value.fileCount) && count(value.logicalBytes) && (value.allocatedBytes === null || count(value.allocatedBytes)) && count(value.allocatedFileCount);
}
function growth(value: unknown): value is StorageGrowth {
  return record(value) && ['available', 'unavailable'].includes(String(value.status)) && signed(value.logicalBytes) && signed(value.allocatedBytes) && signed(value.fileCount);
}
function categories(value: unknown): value is StorageCategory[] {
  return Array.isArray(value) && value.every(item => totals(item) && record(item) && typeof item.category === 'string');
}
function models(value: unknown): value is StorageModelBucket[] {
  return Array.isArray(value) && value.every(item => totals(item) && record(item) && ['single', 'mixed', 'unknown'].includes(String(item.kind)) && Array.isArray(item.models) && item.models.every(model => typeof model === 'string'));
}

export function isStorageSnapshot(value: unknown): value is StorageSnapshot {
  if (!record(value) || value.schemaVersion !== 1 || value.scope !== 'local-metadata-only' || !date(value.generatedAt) || !maybeDate(value.previousGeneratedAt) || typeof value.measurement !== 'string' || !totals(value.totals) || !growth(value.growth) || !categories(value.categories) || !models(value.modelBuckets)) return false;
  const coverage = value.coverage;
  if (!record(coverage) || !['complete', 'partial'].includes(String(coverage.status)) || !['registeredRoots', 'completeRoots', 'missingRoots', 'partialRoots', 'errorCount'].every(key => count(coverage[key])) || typeof coverage.errorsTruncated !== 'boolean') return false;
  if (!Array.isArray(value.roots) || !value.roots.every(item => record(item) && totals(item) && typeof item.id === 'string' && typeof item.source === 'string' && typeof item.path === 'string' && typeof item.category === 'string' && ['complete', 'partial', 'missing'].includes(String(item.status)) && maybeDate(item.oldestModifiedAt) && maybeDate(item.newestModifiedAt) && count(item.errorCount) && growth(item.growth) && categories(item.categories) && models(item.modelBuckets))) return false;
  if (value.unresolvedLocations !== undefined && (!Array.isArray(value.unresolvedLocations) || !value.unresolvedLocations.every(item => record(item) && typeof item.source === 'string' && typeof item.status === 'string' && typeof item.reason === 'string'))) return false;
  return Array.isArray(value.errors) && value.errors.every(item => record(item) && typeof item.rootId === 'string' && typeof item.code === 'string' && typeof item.operation === 'string');
}

export function isLocalStorageSurface(hostname = typeof window === 'undefined' ? '' : window.location.hostname): boolean {
  return LOCAL_HOSTS.has(hostname);
}

export function formatStorageBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return 'Unavailable';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  const magnitude = Math.abs(bytes);
  const index = magnitude > 0 ? Math.min(Math.floor(Math.log(magnitude) / Math.log(1024)), units.length - 1) : 0;
  return `${(bytes / 1024 ** index).toLocaleString(undefined, { maximumFractionDigits: index === 0 ? 0 : 2 })} ${units[index]}`;
}

interface StorageClientOptions { hostname?: string; baseUrl?: string; fetcher?: typeof fetch }
export function createStorageClient(options: StorageClientOptions = {}) {
  const hostname = options.hostname ?? (typeof window === 'undefined' ? '' : window.location.hostname);
  const fetcher = options.fetcher ?? fetch;
  const request = async (path: string, body?: { rootId: string } | Record<string, never>, signal?: AbortSignal): Promise<unknown> => {
    if (!isLocalStorageSurface(hostname)) throw new Error('Storage is available in the local dashboard only.');
    let base: URL;
    try { base = new URL(options.baseUrl || import.meta.env?.VITE_LOCAL_SYNC_URL || 'http://127.0.0.1:7337'); }
    catch { throw new Error('Storage requires a valid local helper address.'); }
    if (base.protocol !== 'http:' || !LOCAL_HOSTS.has(base.hostname) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) throw new Error('Storage requires a loopback local helper address.');
    const url = new URL(path, base);
    if (!body) url.searchParams.set('t', String(Date.now()));
    const timeout = AbortSignal.timeout(body ? 25_000 : 8_000);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await fetcher(url, {
        method: body ? 'POST' : 'GET', headers: { 'x-meow-ops-local': '1', ...(body ? { 'Content-Type': 'application/json' } : {}) },
        mode: 'cors', redirect: 'error', cache: 'no-store', signal: combined,
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch {
      if (signal?.aborted) throw new Error('Storage request cancelled.');
      throw new Error(combined.aborted ? 'The storage helper timed out. Retry to check its status.' : 'Storage could not reach the local helper. Check the helper and retry.');
    }
    let data: unknown;
    try { data = await response.json(); } catch { throw new Error('The local helper returned an invalid storage response.'); }
    if (!response.ok || (record(data) && data.ok === false)) throw new Error(response.status === 404 ? 'This helper does not support storage yet. Restart it with the updated app.' : 'The local helper could not complete this storage request.');
    return data;
  };
  const snapshot = (data: unknown): StorageResponse => {
    if (isStorageSnapshot(data)) return { snapshot: data, refreshing: false };
    if (!record(data) || data.ok !== true || !(data.snapshot === null || isStorageSnapshot(data.snapshot))) throw new Error('Storage measurements could not be verified. Retry instead of treating them as zero.');
    return { snapshot: data.snapshot, refreshing: data.refreshing === true, ...(data.error ? { error: 'The latest storage measurement failed. Retry to measure it again.' } : {}) };
  };
  return {
    read: async (signal?: AbortSignal) => snapshot(await request('/storage', undefined, signal)),
    refresh: async (signal?: AbortSignal) => snapshot(await request('/storage/refresh', {}, signal)),
    openFolder: async (rootId: string, signal?: AbortSignal) => {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,150}$/.test(rootId)) throw new Error('Select a registered storage location.');
      const result = await request('/storage/open-folder', { rootId }, signal);
      if (!record(result) || result.ok !== true) throw new Error('The local helper could not open this folder.');
    },
  };
}

export const fetchStorageSnapshot = (signal?: AbortSignal) => createStorageClient().read(signal);
export const refreshStorageSnapshot = (signal?: AbortSignal) => createStorageClient().refresh(signal);
export const openStorageFolder = (rootId: string, signal?: AbortSignal) => createStorageClient().openFolder(rootId, signal);
