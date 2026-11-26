import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '../api';
import { deskService } from '../chat.service';
import { crmService } from '../crm.service';
import { offlineQueue, runOrQueue } from '../offlineQueue';

vi.mock('../crm.service', () => ({ crmService: { checkIn: vi.fn(), checkOut: vi.fn() } }));
vi.mock('../chat.service', () => ({ deskService: { updateServiceRequest: vi.fn() } }));

const setOnline = (on: boolean) => Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => on });
const checkIn = { kind: 'checkIn' as const, payload: { bookingId: 'b1', idVerified: true, idDocType: 'aadhaar', sendWelcome: true } };

beforeEach(() => {
  vi.clearAllMocks();
  offlineQueue.reset();
  setOnline(true);
});
afterEach(() => setOnline(true));

describe('runOrQueue', () => {
  it('runs immediately when online', async () => {
    vi.mocked(crmService.checkIn).mockResolvedValue({ roomNumber: '101' } as never);
    const out = await runOrQueue('u1', 'Check in Arjun', checkIn);
    expect(out).toEqual({ queued: false, result: { roomNumber: '101' } });
    expect(offlineQueue.getState().items).toHaveLength(0);
  });

  it('queues without calling the server when the device is offline, and persists it', async () => {
    setOnline(false);
    const out = await runOrQueue('u1', 'Check in Arjun', checkIn);
    expect(out).toEqual({ queued: true });
    expect(crmService.checkIn).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem('bms.offlineQueue.v1')!)).toMatchObject([{ userId: 'u1', label: 'Check in Arjun', action: checkIn }]);
  });

  it('queues when the server cannot be reached even though the browser says online', async () => {
    vi.mocked(crmService.checkIn).mockRejectedValue(new ApiError(0, 'NETWORK', 'Could not reach the server'));
    expect(await runOrQueue('u1', 'Check in Arjun', checkIn)).toEqual({ queued: true });
  });

  it('does not queue real errors — they go back to the dialog', async () => {
    vi.mocked(crmService.checkIn).mockRejectedValue(new ApiError(409, 'CONFLICT', 'Room just taken'));
    await expect(runOrQueue('u1', 'Check in Arjun', checkIn)).rejects.toThrow('Room just taken');
    expect(offlineQueue.getState().items).toHaveLength(0);
  });
});

describe('flush', () => {
  it('replays this user’s actions in order and reports conflicts as already done', async () => {
    setOnline(false);
    await runOrQueue('u1', 'Check in Arjun', checkIn);
    await runOrQueue('u1', 'Towels request done', { kind: 'serviceRequest', payload: { id: 'sr1', status: 'done' } });
    await runOrQueue('u2', 'Check out Priya', { kind: 'checkOut', payload: { bookingId: 'b2', paymentCollected: false } });
    setOnline(true);
    vi.mocked(crmService.checkIn).mockResolvedValue({} as never);
    vi.mocked(deskService.updateServiceRequest).mockRejectedValue(new ApiError(409, 'CONFLICT', 'This request is already closed'));

    const report = await offlineQueue.flush('u1');
    expect(report).toEqual({ synced: ['Check in Arjun'], skipped: [{ label: 'Towels request done', message: expect.stringContaining('already closed') }] });
    expect(crmService.checkIn).toHaveBeenCalledWith(checkIn.payload);
    // Another staff member's queued action is untouched until they sign in.
    expect(crmService.checkOut).not.toHaveBeenCalled();
    expect(offlineQueue.getState().items.map((i) => i.label)).toEqual(['Check out Priya']);
  });

  it('stops and keeps the rest when the connection drops again mid-sync', async () => {
    setOnline(false);
    await runOrQueue('u1', 'Check in Arjun', checkIn);
    await runOrQueue('u1', 'Check out Priya', { kind: 'checkOut', payload: { bookingId: 'b2', paymentCollected: false } });
    setOnline(true);
    vi.mocked(crmService.checkIn).mockRejectedValue(new ApiError(0, 'NETWORK', 'offline'));

    const report = await offlineQueue.flush('u1');
    expect(report).toEqual({ synced: [], skipped: [] });
    expect(crmService.checkOut).not.toHaveBeenCalled();
    expect(offlineQueue.getState().items).toHaveLength(2);
  });

  it('does nothing while offline', async () => {
    setOnline(false);
    await runOrQueue('u1', 'Check in Arjun', checkIn);
    expect(await offlineQueue.flush('u1')).toBeNull();
    expect(crmService.checkIn).not.toHaveBeenCalled();
  });
});
