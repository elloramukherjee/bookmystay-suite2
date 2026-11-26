/**
 * Production preflight: validates the environment (by importing it), connects to MongoDB, makes sure all
 * indexes exist, and prints the readiness report. Exit code 1 if anything is an error.
 *   npm run preflight --workspace server
 */
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { env } from '../config/env.js';
import { readinessReport } from '../config/readiness.js';
import '../app.js'; // registers every model

async function main(): Promise<void> {
  await connectDatabase(env.MONGODB_URI);
  for (const model of Object.values(mongoose.models)) await model.syncIndexes();
  const report = readinessReport();
  const icon = { ok: '✓', warn: '!', error: '✗' } as const;
  console.log(`\nBookMyStay preflight (${env.NODE_ENV})\n`);
  for (const r of report) console.log(`  ${icon[r.level]} [${r.area}] ${r.message}`);
  const errors = report.filter((r) => r.level === 'error').length;
  console.log(`\n${errors ? `${errors} error(s): fix before going live.` : 'No blocking errors.'}\n`);
  await disconnectDatabase();
  process.exit(errors ? 1 : 0);
}

main().catch(async (err) => {
  console.error(`Preflight failed: ${err instanceof Error ? err.message : String(err)}`);
  await disconnectDatabase().catch(() => undefined);
  process.exit(1);
});
