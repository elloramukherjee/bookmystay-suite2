import { existsSync } from 'node:fs';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { TestProject } from 'vitest/node';

declare module 'vitest' {
  export interface ProvidedContext {
    mongoUri: string;
  }
}

let replSet: MongoMemoryReplSet | undefined;

/**
 * One in-memory single-node replica set for the whole run (so transactions are exercised).
 * If a local MongoDB install exists we reuse its binary instead of downloading one.
 */
export async function setup(project: TestProject): Promise<void> {
  const candidates = [
    process.env.MONGOMS_SYSTEM_BINARY,
    'C:/Program Files/MongoDB/Server/8.2/bin/mongod.exe',
    '/usr/bin/mongod',
    '/usr/local/bin/mongod',
    '/opt/homebrew/bin/mongod',
  ].filter((p): p is string => Boolean(p));
  const systemBinary = candidates.find((p) => existsSync(p));

  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    binary: systemBinary ? { systemBinary, checkMD5: false } : undefined,
  });
  project.provide('mongoUri', replSet.getUri());
}

export async function teardown(): Promise<void> {
  await replSet?.stop();
}
