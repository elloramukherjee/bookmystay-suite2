import { randomUUID } from 'node:crypto';
import mongoose, { type Types } from 'mongoose';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, inject } from 'vitest';
import { createApp } from '../app.js';
import { connectDatabase } from '../config/db.js';
import type { StaffRole } from '../modules/auth/permissions.js';
import { hashPassword } from '../modules/auth/password.js';
import { Hotel } from '../modules/hotels/hotel.model.js';
import { User } from '../modules/users/user.model.js';

export const TEST_PASSWORD = 'Courtyard2024!';

/** Gives each test file its own database on the shared replica set and wipes collections between tests. */
export function useTestDatabase(): void {
  beforeAll(async () => {
    const base = inject('mongoUri');
    const url = new URL(base);
    url.pathname = `/bms_test_${randomUUID().slice(0, 8)}`;
    await connectDatabase(url.toString());
    await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));
  });
  beforeEach(async () => {
    const collections = await mongoose.connection.db!.collections();
    await Promise.all(collections.map((c) => c.deleteMany({})));
  });
  afterAll(async () => {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });
}

export const app = createApp();
export const api = () => request(app);

export async function createHotel(overrides: Partial<{ name: string; slug: string; status: 'active' | 'suspended' }> = {}) {
  return Hotel.create({
    name: overrides.name ?? 'Test Haveli',
    slug: overrides.slug ?? `test-haveli-${randomUUID().slice(0, 6)}`,
    address: { city: 'Jaipur', state: 'Rajasthan' },
    totalRooms: 12,
    status: overrides.status ?? 'active',
    gstin: '08ABCDE1234F1Z5',
  });
}

export async function createUser(role: StaffRole, hotelId: Types.ObjectId | null, overrides: Partial<{ email: string; isActive: boolean }> = {}) {
  return User.create({
    name: `${role} user`,
    email: overrides.email ?? `${role}.${randomUUID().slice(0, 8)}@test.example`,
    role,
    hotelId: role === 'super_admin' ? null : hotelId,
    passwordHash: await hashPassword(TEST_PASSWORD),
    isActive: overrides.isActive ?? true,
  });
}

/** The full Set-Cookie string for the refresh cookie on a Supertest response, if present. */
export function refreshCookieFrom(res: { headers: Record<string, unknown> }): string | undefined {
  const raw = res.headers['set-cookie'];
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];
  return list.find((c) => c.startsWith('bms_rt='));
}

export async function loginAs(email: string, password = TEST_PASSWORD) {
  const res = await api().post('/api/v1/auth/login').send({ email, password });
  if (res.status !== 200) throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  const cookie = refreshCookieFrom(res);
  return { token: res.body.data.accessToken as string, cookie: cookie!.split(';')[0]!, body: res.body };
}
