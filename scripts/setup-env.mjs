#!/usr/bin/env node
// Creates .env from .env.example with freshly generated secrets. Never overwrites an existing .env.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, '.env');
if (existsSync(target)) {
  console.log('.env already exists — leaving it untouched.');
  process.exit(0);
}
const secret = (n = 48) => randomBytes(n).toString('base64url');
const content = readFileSync(join(root, '.env.example'), 'utf8')
  .replace(/^JWT_ACCESS_SECRET=$/m, `JWT_ACCESS_SECRET=${secret()}`)
  .replace(/^JWT_REFRESH_SECRET=$/m, `JWT_REFRESH_SECRET=${secret()}`)
  .replace(/^IP_HASH_SALT=$/m, `IP_HASH_SALT=${secret(16)}`);
writeFileSync(target, content, { mode: 0o600 });
console.log('Created .env with random JWT secrets. Add GEMINI_API_KEY / WhatsApp credentials when available.');
