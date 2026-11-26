import { createApp } from './app.js';
import { connectDatabase, disconnectDatabase } from './config/db.js';
import { env } from './config/env.js';
import { logger } from './config/logger.js';
import { readinessReport } from './config/readiness.js';
import { startJobs } from './jobs/index.js';
import { whatsappIdle } from './modules/whatsapp/whatsapp.service.js';

async function main(): Promise<void> {
  await connectDatabase(env.MONGODB_URI);
  const app = createApp();
  const stopJobs = startJobs();
  // What guests will and won't get with this configuration (no secret values).
  for (const r of readinessReport()) {
    if (r.level !== 'ok') logger[r.level === 'error' ? 'error' : 'warn']({ area: r.area }, `Readiness: ${r.message}`);
  }

  const server = app.listen(env.PORT, () => {
    logger.info(
      {
        port: env.PORT,
        env: env.NODE_ENV,
        gemini: env.geminiConfigured ? 'configured' : 'not configured',
        whatsapp: env.whatsappConfigured ? 'cloud-api' : 'simulator',
        payments: env.PAYMENT_PROVIDER,
      },
      `BookMyStay API listening on http://localhost:${env.PORT}/api/v1`,
    );
  });

  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down gracefully');
    stopJobs();
    server.close(async () => {
      // Let in-flight WhatsApp replies finish; anything unfinished is picked up by the recovery job.
      await Promise.race([whatsappIdle(), new Promise((r) => setTimeout(r, 5_000))]);
      await disconnectDatabase();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => logger.error({ err: reason }, 'Unhandled promise rejection'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Failed to start server');
  process.exit(1);
});
