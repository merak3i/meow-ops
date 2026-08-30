import type { ReactElement } from 'react';
import type { SyncStatus } from '../lib/queries';

export default function SyncActivityDrawer(props: {
  open: boolean;
  status: SyncStatus | null;
  retrying?: boolean;
  onClose: () => void;
  onRetry: () => void;
}): ReactElement | null;
