import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { loadEnv } from '../config/env.js';
import { signGuestToken } from '../modules/bookings/guestToken.js';
import { signChatToken } from '../modules/chatbot/chatToken.js';
import { api, createHotel, createUser, loginAs, refreshCookieFrom, TEST_PASSWORD, useTestDatabase } from '../test/helpers.js';
import { mountClient } from '../web.js';

/** Hardening checks from the Phase 6 security review (docs/SECURITY.md). */
useTestDatabase();

const PROD = {
  NODE_ENV: 'production',
  MONGODB_URI: 'mongodb+srv://cluster.example.net/bookmystay',
  JWT_ACCESS_SECRET: 'Zr8kQ2vN7xLp4sW1yT6bH3mJ9cF5dG0aE2uR8iO4nV7',
  JWT_REFRESH_SECRET: 'Yq7jP1uM6wKo3rV0xS5aG2lI8bE4cF9dH1tN6zQ3mB0',
  IP_HASH_SALT: 'k3J9xQ2mV8pL',
  CLIENT_URL: 'https://stay.heritagecourtyard.in',
  PAYMENT_PROVIDER: 'razorpay',
  PAYMENT_GATEWAY_KEY: 'rzp_live_x',
  PAYMENT_GATEWAY_SECRET: 'x',
  PAYMENT_WEBHOOK_SECRET: 'x',
};
const issues = (overrides: Record<string, string | undefined>) => {
  try {
    loadEnv({ ...PROD, ...overrides });
    return '';
  } catch (err) {
    return (err as Error).message;
  }
};

describe('production configuration is refused when unsafe', () => {
  it('accepts a complete production configuration', () => {
    expect(issues({})).toBe('');
  });
  it.each([
    ['mock payments', { PAYMENT_PROVIDER: 'mock' }, 'mock payment provider is not allowed'],
    ['placeholder JWT secret', { JWT_ACCESS_SECRET: 'change-me-change-me-change-me-change-me' }, 'looks like a placeholder'],
    ['identical JWT secrets', { JWT_REFRESH_SECRET: PROD.JWT_ACCESS_SECRET }, 'must differ'],
    ['plain-http origin', { CLIENT_URL: 'http://stay.heritagecourtyard.in' }, 'must use https://'],
    ['localhost origin', { CLIENT_URL: 'http://localhost:5173' }, 'public origin'],
    ['default IP salt', { IP_HASH_SALT: undefined }, 'IP_HASH_SALT'],
    ['an SMS gateway this version cannot use', { SMS_PROVIDER: 'msg91' }, 'Only "console" is available'],
  ])('%s', (_name, overrides, message) => {
    expect(issues(overrides)).toContain(message);
  });
});

describe('API hardening', () => {
  it('sends strict security headers on API responses', async () => {
    const res = await api().get('/api/v1/health');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it('a guest booking token or chat token is never accepted as a staff token', async () => {
    const hotel = await createHotel();
    const owner = await createUser('owner', hotel._id);
    const guest = signGuestToken({ bid: String(hotel._id), hid: String(hotel._id), gid: String(owner._id) }).token;
    const chat = signChatToken(String(hotel._id), String(hotel._id));
    for (const token of [guest, chat]) {
      const res = await api().get('/api/v1/crm/dashboard').set('Authorization', `Bearer ${token}`);
      expect(res.status).toBe(401);
    }
  });

  it('strips MongoDB operators from input (no NoSQL injection on login)', async () => {
    const hotel = await createHotel();
    await createUser('owner', hotel._id, { email: 'owner@inject.example' });
    const res = await api()
      .post('/api/v1/auth/login')
      .send({ email: { $gt: '' }, password: { $ne: null } });
    expect(res.status).toBe(400);
    expect(res.body.data).toBeUndefined();
  });

  it('rejects oversized bodies', async () => {
    const res = await api()
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a@b.c', password: 'x'.repeat(200_000) }));
    expect(res.status).toBe(413);
  });

  it('does not reveal whether an email exists on failed login', async () => {
    const hotel = await createHotel();
    await createUser('owner', hotel._id, { email: 'known@test.example' });
    const known = await api().post('/api/v1/auth/login').send({ email: 'known@test.example', password: 'wrong-password-1' });
    const unknown = await api().post('/api/v1/auth/login').send({ email: 'nobody@test.example', password: 'wrong-password-1' });
    expect(known.status).toBe(unknown.status);
    expect(known.body.error.message).toBe(unknown.body.error.message);
  });
});

describe('password change (ASVS 2.1.5 / 3.3)', () => {
  it('needs the current password, then ends every other session and keeps this one', async () => {
    const hotel = await createHotel();
    const user = await createUser('front_desk', hotel._id);
    const laptop = await loginAs(user.email);
    const phone = await loginAs(user.email);

    const wrong = await api()
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${laptop.token}`)
      .send({ currentPassword: 'nope-123456', newPassword: 'NewDesk2026pass' });
    expect(wrong.status).toBe(400);
    expect(wrong.body.error.details[0].path).toBe('currentPassword');

    const weak = await api()
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${laptop.token}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'short' });
    expect(weak.status).toBe(400);

    const ok = await api()
      .post('/api/v1/auth/change-password')
      .set('Authorization', `Bearer ${laptop.token}`)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'NewDesk2026pass' });
    expect(ok.status).toBe(200);
    const fresh = ok.body.data.accessToken as string;
    expect(refreshCookieFrom(ok)).toBeDefined();

    // Old access tokens (both devices) and the other device's refresh token stop working at once.
    expect((await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${laptop.token}`)).status).toBe(401);
    expect((await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${phone.token}`)).status).toBe(401);
    expect((await api().post('/api/v1/auth/refresh').set('Cookie', phone.cookie)).status).toBe(401);
    expect((await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${fresh}`)).status).toBe(200);

    expect((await api().post('/api/v1/auth/login').send({ email: user.email, password: TEST_PASSWORD })).status).toBe(401);
    expect((await api().post('/api/v1/auth/login').send({ email: user.email, password: 'NewDesk2026pass' })).status).toBe(200);
  });
});

describe('staff password reset by the owner (no email/SMS reset in this version)', () => {
  it('owner sets a new password for front desk: old sessions end, lockout clears, new password works', async () => {
    const hotel = await createHotel();
    const owner = await createUser('owner', hotel._id);
    const desk = await createUser('front_desk', hotel._id);
    const ownerAuth = { Authorization: `Bearer ${(await loginAs(owner.email)).token}` };
    const deskSession = await loginAs(desk.email);

    const res = await api().put(`/api/v1/users/${desk._id}/password`).set(ownerAuth).send({ newPassword: 'FrontDesk2026new' });
    expect(res.status).toBe(204);
    expect((await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${deskSession.token}`)).status).toBe(401);
    expect((await api().post('/api/v1/auth/refresh').set('Cookie', deskSession.cookie)).status).toBe(401);
    expect((await api().post('/api/v1/auth/login').send({ email: desk.email, password: 'FrontDesk2026new' })).status).toBe(200);
  });

  it('is limited to roles you can assign, in your own property, and never yourself', async () => {
    const hotel = await createHotel();
    const other = await createHotel();
    const owner = await createUser('owner', hotel._id);
    const coOwner = await createUser('owner', hotel._id);
    const desk = await createUser('front_desk', hotel._id);
    const outsider = await createUser('front_desk', other._id);
    const as = async (email: string) => ({ Authorization: `Bearer ${(await loginAs(email)).token}` });
    const body = { newPassword: 'Another2026pass' };
    const ownerAuth = await as(owner.email);

    // Another owner's password is out of reach (only platform support), as is anyone without staff.manage.
    expect((await api().put(`/api/v1/users/${coOwner._id}/password`).set(ownerAuth).send(body)).status).toBe(403);
    expect(
      (
        await api()
          .put(`/api/v1/users/${owner._id}/password`)
          .set(await as(desk.email))
          .send(body)
      ).status,
    ).toBe(403);
    expect((await api().put(`/api/v1/users/${outsider._id}/password`).set(ownerAuth).send(body)).status).toBe(404);
    expect((await api().put(`/api/v1/users/${owner._id}/password`).set(ownerAuth).send(body)).status).toBe(400);
    expect((await api().put(`/api/v1/users/${desk._id}/password`).set(ownerAuth).send({ newPassword: 'weak' })).status).toBe(400);
  });
});

describe('web app serving (SERVE_CLIENT)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'bms-web-'));
  mkdirSync(join(dir, 'assets'));
  writeFileSync(join(dir, 'index.html'), '<!doctype html><title>BookMyStay</title><div id="root"></div>');
  writeFileSync(join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
  const app = express();
  app.get('/api/v1/ping', (_req, res) => {
    res.json({ ok: true });
  });
  mountClient(app, dir);
  app.use((_req, res) => {
    res.status(404).json({ error: 'not found' });
  });

  it('serves pages with a CSP that allows only what the app needs and forbids framing', async () => {
    const res = await request(app).get('/h/heritage-courtyard-jaipur');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<div id="root">');
    const csp = res.headers['content-security-policy'] as string;
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("script-src 'self' https://checkout.razorpay.com");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('caches hashed assets for a year and 404s missing ones instead of returning the page', async () => {
    const asset = await request(app).get('/assets/app-abc123.js');
    expect(asset.headers['cache-control']).toContain('immutable');
    const missing = await request(app).get('/assets/app-old999.js');
    expect(missing.status).toBe(404);
    expect(missing.text).not.toContain('<div id="root">');
  });

  it('leaves API routes to the API', async () => {
    expect((await request(app).get('/api/v1/ping')).body).toEqual({ ok: true });
    expect((await request(app).get('/api/v1/unknown')).status).toBe(404);
    expect((await request(app).post('/h/anything')).status).toBe(404);
  });
});
