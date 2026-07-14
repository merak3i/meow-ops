export type SyncPhase = {
  id: string;
  status: 'pending' | 'running' | 'succeeded' | 'failed' | 'warning' | 'skipped';
  started_at?: string | null;
  completed_at?: string | null;
};

export type SyncStatus = {
  ok: boolean;
  mode?: 'dev-sync' | 'local-sync' | 'refresh-only';
  run_id?: string | null;
  state?: 'idle' | 'running' | 'succeeded' | 'partial' | 'failed';
  phase?: string | null;
  phases?: SyncPhase[];
  started_at?: string | null;
  updated_at?: string | null;
  completed_at?: string | null;
  mtime?: number | null;
  size?: number | null;
  artifact?: {
    available?: boolean;
    mtime?: number | null;
    size?: number | null;
    sessions?: number;
    source_counts?: Record<string, number>;
  };
  failure?: { stage?: string; code?: string; summary?: string; retryable?: boolean } | null;
  warning?: { stage?: string; code?: string; summary?: string } | null;
  error?: string;
};

export function getSyncStatus(): Promise<SyncStatus>;
