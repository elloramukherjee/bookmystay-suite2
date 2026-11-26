import { useSyncExternalStore } from 'react';
import { ApiError } from './api';
import { deskService } from './chat.service';
import { crmService } from './crm.service';

/**
 * Offline queue for front-desk actions. Hotel Wi-Fi drops; check-ins shouldn't. When the network is down
 * (or a request can't reach the server), the action is saved on this device and replayed when the
 * connection returns. Only actions that are safe to replay are queueable: the server rejects a duplicate
 * check-in/out or an already-closed request with 409, which is treated as "already done".
 */
type Runners = {
  checkIn: Parameters<typeof crmService.checkIn>[0];
  checkOut: Parameters<typeof crmService.checkOut>[0];
  serviceRequest: { id: string; status: 'done' | 'declined' | 'acknowledged' };
};
export type QueueKind = keyof Runners;
export type QueuedAction = { [K in QueueKind]: { kind: K; payload: Runners[K] } }[QueueKind];

export interface QueueItem {
  id: string;
  /** Staff member who queued it: items only replay under the same login. */
  userId: string;
  label: string;
  queuedAt: string;
  action: QueuedAction;
}

export interface SyncReport {
  synced: string[];
  skipped: { label: string; message: string }[];
}

interface QueueState {
  items: QueueItem[];
  syncing: boolean;
  lastReport: SyncReport | null;
}

const KEY = 'bms.offlineQueue.v1';
const runners: { [K in QueueKind]: (p: Runners[K]) => Promise<unknown> } = {
  checkIn: (p) => crmService.checkIn(p),
  checkOut: (p) => crmService.checkOut(p),
  serviceRequest: (p) => deskService.updateServiceRequest(p.id, p.status),
};
const run = (a: QueuedAction) => (runners[a.kind] as (p: unknown) => Promise<unknown>)(a.payload);

function load(): QueueItem[] {
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as QueueItem[]) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}
function persist(items: QueueItem[]): void {
  try {
    if (items.length) localStorage.setItem(KEY, JSON.stringify(items));
    else localStorage.removeItem(KEY);
  } catch {
    // Storage unavailable (private mode): the queue still works for this tab.
  }
}

let state: QueueState = { items: load(), syncing: false, lastReport: null };
const listeners = new Set<() => void>();
function setState(next: Partial<QueueState>): void {
  state = { ...state, ...next };
  if ('items' in next) persist(state.items);
  listeners.forEach((l) => l());
}

const isOfflineError = (err: unknown) => err instanceof ApiError && err.status === 0;
const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

export const offlineQueue = {
  subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  getState: () => state,

  add(userId: string, label: string, action: QueuedAction): QueueItem {
    const item: QueueItem = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, userId, label, queuedAt: new Date().toISOString(), action };
    setState({ items: [...state.items, item] });
    return item;
  },

  remove(id: string): void {
    setState({ items: state.items.filter((i) => i.id !== id) });
  },

  /**
   * Replays this user's queued actions in order. Stops at the first network failure (still offline);
   * a 409 means it was already done, other errors are reported. Returns null if nothing ran.
   */
  async flush(userId: string): Promise<SyncReport | null> {
    if (state.syncing || isOffline()) return null;
    const mine = state.items.filter((i) => i.userId === userId);
    if (!mine.length) return null;
    setState({ syncing: true });
    const report: SyncReport = { synced: [], skipped: [] };
    try {
      for (const item of mine) {
        try {
          await run(item.action);
          report.synced.push(item.label);
        } catch (err) {
          if (isOfflineError(err)) break;
          report.skipped.push({
            label: item.label,
            message:
              err instanceof ApiError && err.status === 409
                ? `Already updated by someone else — ${err.message}`
                : err instanceof Error
                  ? err.message
                  : 'Failed',
          });
        }
        offlineQueue.remove(item.id);
      }
    } finally {
      setState({ syncing: false, lastReport: report.synced.length || report.skipped.length ? report : state.lastReport });
    }
    return report;
  },

  dismissReport(): void {
    setState({ lastReport: null });
  },

  /** Test helper. */
  reset(): void {
    state = { items: [], syncing: false, lastReport: null };
    persist([]);
    listeners.forEach((l) => l());
  },
};

/**
 * Runs the action now, or queues it when the device is offline / the server can't be reached.
 * Everything else (validation, 409, 403…) is thrown as usual so the dialog can show it.
 */
export async function runOrQueue<T>(userId: string, label: string, action: QueuedAction): Promise<{ queued: true } | { queued: false; result: T }> {
  if (isOffline()) {
    offlineQueue.add(userId, label, action);
    return { queued: true };
  }
  try {
    return { queued: false, result: (await run(action)) as T };
  } catch (err) {
    if (!isOfflineError(err)) throw err;
    offlineQueue.add(userId, label, action);
    return { queued: true };
  }
}

export function useOfflineQueue(): QueueState {
  return useSyncExternalStore(offlineQueue.subscribe, offlineQueue.getState, offlineQueue.getState);
}
