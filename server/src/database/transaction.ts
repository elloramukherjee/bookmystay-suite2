import mongoose, { type ClientSession } from 'mongoose';
import { supportsTransactions } from '../config/db.js';

/**
 * Runs `fn` inside a MongoDB transaction when the deployment supports it; otherwise runs it
 * without a session. Callers must therefore keep each individual write safe on its own
 * (guarded atomic updates + compensation), which is how inventory is handled.
 */
export async function withTransaction<T>(fn: (session: ClientSession | undefined) => Promise<T>): Promise<T> {
  if (!supportsTransactions()) {
    return fn(undefined);
  }
  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
}
