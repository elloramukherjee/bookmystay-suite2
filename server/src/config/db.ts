import mongoose from 'mongoose';
import { logger } from './logger.js';

mongoose.set('strictQuery', true);

let transactionsSupported = false;

/** True when the connected deployment is a replica set / sharded cluster (multi-document transactions available). */
export function supportsTransactions(): boolean {
  return transactionOverride ?? transactionsSupported;
}

let transactionOverride: boolean | null = null;
/** Test hook: exercise the no-transaction (standalone MongoDB) code paths against a replica set. */
export function overrideTransactionSupport(value: boolean | null): void {
  transactionOverride = value;
}

export async function connectDatabase(uri: string): Promise<typeof mongoose> {
  const conn = await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    maxPoolSize: 20,
    autoIndex: true,
  });

  const admin = conn.connection.db?.admin();
  const hello = admin ? await admin.command({ hello: 1 }) : {};
  transactionsSupported = Boolean(hello.setName) || hello.msg === 'isdbgrid';

  if (!transactionsSupported) {
    logger.warn(
      'MongoDB is running standalone: multi-document transactions are unavailable. ' +
        'Inventory stays consistent via guarded atomic updates, but production MUST use a replica set.',
    );
  }
  logger.info({ transactions: transactionsSupported }, 'MongoDB connected');
  return conn;
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}

export function databaseState(): 'connected' | 'connecting' | 'disconnected' | 'disconnecting' {
  const states = ['disconnected', 'connected', 'connecting', 'disconnecting'] as const;
  return states[mongoose.connection.readyState as number] ?? 'disconnected';
}
