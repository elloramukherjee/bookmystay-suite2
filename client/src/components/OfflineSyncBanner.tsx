import { useQueryClient } from '@tanstack/react-query';
import { CloudOff, RefreshCw, TriangleAlert, X } from 'lucide-react';
import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { offlineQueue, useOfflineQueue } from '../services/offlineQueue';
import { Button } from './Button';

function subscribeOnline(cb: () => void) {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
}
const getOnline = () => navigator.onLine;

/**
 * Staff-area banner: tells the desk when it's offline, how many actions are waiting, and replays them
 * automatically when the connection comes back (or on demand).
 */
export function OfflineSyncBanner() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const toast = useToast();
  const online = useSyncExternalStore(subscribeOnline, getOnline, () => true);
  const { items, syncing, lastReport } = useOfflineQueue();
  const mine = items.filter((i) => i.userId === user?.id);

  const sync = useCallback(async () => {
    if (!user) return;
    const report = await offlineQueue.flush(user.id);
    if (!report) return;
    await queryClient.invalidateQueries();
    if (report.synced.length && !report.skipped.length) {
      toast.success(`${report.synced.length} offline action${report.synced.length === 1 ? '' : 's'} synced.`, 'Back online');
    }
  }, [user, queryClient, toast]);

  // Sync when connectivity returns, and keep retrying every 30 s while items wait: the browser can report
  // "online" while the hotel's internet (or our server) is still unreachable.
  useEffect(() => {
    if (!online || !mine.length) return;
    void sync();
    const timer = window.setInterval(() => void sync(), 30_000);
    return () => window.clearInterval(timer);
  }, [online, mine.length, sync]);

  if (!user) return null;

  if (!online || mine.length) {
    return (
      <div role="status" className="mb-4 flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] bg-warning-50 px-4 py-3 text-body-sm text-ink">
        <CloudOff className="size-5 shrink-0 text-warning" aria-hidden />
        <p className="min-w-0 flex-1">
          {!online ? <strong>You’re offline.</strong> : <strong>Connection restored.</strong>}{' '}
          {mine.length
            ? `${mine.length} action${mine.length === 1 ? '' : 's'} saved on this device: ${mine.map((i) => i.label).join(', ')}. ${online ? 'Syncing…' : 'They’ll sync automatically when you’re back online.'}`
            : 'Check-ins, check-outs and request updates will be saved on this device and synced later.'}
        </p>
        {online && mine.length > 0 && (
          <Button size="sm" variant="secondary" icon={<RefreshCw className="size-4" aria-hidden />} loading={syncing} onClick={() => void sync()}>
            Sync now
          </Button>
        )}
      </div>
    );
  }

  if (lastReport?.skipped.length) {
    return (
      <div role="alert" className="mb-4 flex items-start gap-3 rounded-[var(--radius-card)] bg-danger-50 px-4 py-3 text-body-sm text-ink">
        <TriangleAlert className="mt-0.5 size-5 shrink-0 text-danger" aria-hidden />
        <div className="min-w-0 flex-1">
          <p>
            <strong>Synced {lastReport.synced.length}</strong>, but {lastReport.skipped.length} offline action{lastReport.skipped.length === 1 ? '' : 's'}{' '}
            couldn’t be applied:
          </p>
          <ul className="mt-1 list-disc pl-5">
            {lastReport.skipped.map((s) => (
              <li key={s.label}>
                {s.label}: {s.message}
              </li>
            ))}
          </ul>
        </div>
        <button type="button" onClick={() => offlineQueue.dismissReport()} className="rounded-full p-1 text-slate hover:bg-white" aria-label="Dismiss">
          <X className="size-4" />
        </button>
      </div>
    );
  }
  return null;
}
