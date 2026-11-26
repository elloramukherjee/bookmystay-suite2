import { logger } from '../config/logger.js';
import { expireStaleHolds } from '../modules/bookings/booking.service.js';
import { processOutbox, recoverStuck } from '../modules/notifications/notification.service.js';
import { recoverInbound } from '../modules/whatsapp/whatsapp.service.js';

type Job = { name: string; everyMs: number; run: () => Promise<unknown> };

const JOBS: Job[] = [
  { name: 'hold-expiry-sweeper', everyMs: 60_000, run: () => expireStaleHolds() },
  { name: 'notification-outbox', everyMs: 10_000, run: () => processOutbox() },
  { name: 'notification-recovery', everyMs: 5 * 60_000, run: () => recoverStuck() },
  { name: 'whatsapp-inbound-recovery', everyMs: 60_000, run: () => recoverInbound() },
];

/**
 * In-process interval jobs. Every job is safe to run on several instances at once because each unit of
 * work is claimed with an atomic findOneAndUpdate. A job never overlaps with itself on one instance.
 */
export function startJobs(): () => void {
  const timers = JOBS.map((job) => {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        await job.run();
      } catch (err) {
        logger.error({ err, job: job.name }, 'Background job failed');
      } finally {
        running = false;
      }
    };
    void tick();
    return setInterval(tick, job.everyMs);
  });
  logger.info({ jobs: JOBS.map((j) => j.name) }, 'Background jobs started');
  return () => timers.forEach(clearInterval);
}
