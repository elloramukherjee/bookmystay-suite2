import { describe, expect, it } from 'vitest';
import { api, createHotel, createUser, loginAs, refreshCookieFrom, TEST_PASSWORD, useTestDatabase } from '../../../test/helpers.js';
import { AuditLog } from '../../../shared/audit/auditLog.model.js';
import { User } from '../../users/user.model.js';
import { RefreshToken } from '../refreshToken.model.js';
import { REUSE_GRACE_MS } from '../token.service.js';

useTestDatabase();

describe('POST /auth/login', () => {
  it('returns an access token, sets an httpOnly refresh cookie and never leaks secrets', async () => {
    const hotel = await createHotel();
    const owner = await createUser('owner', hotel._id);

    const res = await api().post('/api/v1/auth/login').send({ email: owner.email.toUpperCase(), password: TEST_PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.user).toMatchObject({ email: owner.email, role: 'owner', hotelId: String(hotel._id) });
    const serialized = JSON.stringify(res.body);
    expect(serialized).not.toMatch(/passwordHash|tokenVersion|failedLoginCount|\$2[aby]\$/);

    const cookie = refreshCookieFrom(res)!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Strict/i);
    expect(cookie).toMatch(/Path=\/api\/v1\/auth/);
    expect(await AuditLog.countDocuments({ action: 'auth.login' })).toBe(1);
  });

  it('gives the same generic error for unknown email and wrong password', async () => {
    const hotel = await createHotel();
    const owner = await createUser('owner', hotel._id);

    const unknown = await api().post('/api/v1/auth/login').send({ email: 'nobody@test.example', password: TEST_PASSWORD });
    const wrong = await api().post('/api/v1/auth/login').send({ email: owner.email, password: 'wrong-password-1' });

    expect(unknown.status).toBe(401);
    expect(wrong.status).toBe(401);
    expect(unknown.body.error.message).toBe(wrong.body.error.message);
    expect(unknown.body.error.code).toBe('INVALID_CREDENTIALS');
  });

  it('rejects deactivated accounts and suspended properties', async () => {
    const hotel = await createHotel();
    const inactive = await createUser('manager', hotel._id, { isActive: false });
    const suspendedHotel = await createHotel({ status: 'suspended' });
    const suspendedOwner = await createUser('owner', suspendedHotel._id);

    expect((await api().post('/api/v1/auth/login').send({ email: inactive.email, password: TEST_PASSWORD })).status).toBe(401);
    expect((await api().post('/api/v1/auth/login').send({ email: suspendedOwner.email, password: TEST_PASSWORD })).status).toBe(403);
  });

  it('locks the account after 5 failed attempts, even for the right password', async () => {
    const hotel = await createHotel();
    const fd = await createUser('front_desk', hotel._id);
    for (let i = 0; i < 5; i++) {
      await api()
        .post('/api/v1/auth/login')
        .send({ email: fd.email, password: `nope-${i}-password` });
    }
    const res = await api().post('/api/v1/auth/login').send({ email: fd.email, password: TEST_PASSWORD });
    expect(res.status).toBe(423);
    expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('validates input and strips NoSQL operators', async () => {
    const hotel = await createHotel();
    await createUser('owner', hotel._id);

    const injection = await api()
      .post('/api/v1/auth/login')
      .send({ email: { $ne: null }, password: { $ne: null } });
    expect(injection.status).toBe(400);
    expect(injection.body.error.code).toBe('VALIDATION_ERROR');

    const extra = await api().post('/api/v1/auth/login').send({ email: 'a@b.example', password: 'x', role: 'super_admin' });
    expect(extra.status).toBe(400);
  });
});

describe('refresh token rotation', () => {
  it('rotates the refresh token and issues a new access token', async () => {
    const hotel = await createHotel();
    const owner = await createUser('owner', hotel._id);
    const { cookie } = await loginAs(owner.email);

    const res = await api().post('/api/v1/auth/refresh').set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    const next = refreshCookieFrom(res)!.split(';')[0]!;
    expect(next).not.toBe(cookie);

    const me = await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${res.body.data.accessToken}`);
    expect(me.status).toBe(200);
  });

  it('tolerates concurrent refreshes from two tabs (reuse within the grace window)', async () => {
    const hotel = await createHotel();
    const owner = await createUser('owner', hotel._id);
    const { cookie } = await loginAs(owner.email);

    const [a, b] = await Promise.all([api().post('/api/v1/auth/refresh').set('Cookie', cookie), api().post('/api/v1/auth/refresh').set('Cookie', cookie)]);
    expect([a.status, b.status]).toEqual([200, 200]);
    // Both new tokens keep working.
    for (const res of [a, b]) {
      const next = refreshCookieFrom(res)!.split(';')[0]!;
      expect((await api().post('/api/v1/auth/refresh').set('Cookie', next)).status).toBe(200);
    }
  });

  it('detects reuse of a rotated token after the grace window and revokes the whole family', async () => {
    const hotel = await createHotel();
    const owner = await createUser('owner', hotel._id);
    const { cookie: original } = await loginAs(owner.email);

    const first = await api().post('/api/v1/auth/refresh').set('Cookie', original);
    const rotated = refreshCookieFrom(first)!.split(';')[0]!;
    // Age the rotation past the grace window.
    await RefreshToken.updateMany({ revokedAt: { $ne: null } }, { $set: { revokedAt: new Date(Date.now() - REUSE_GRACE_MS - 1000) } });

    const replay = await api().post('/api/v1/auth/refresh').set('Cookie', original);
    expect(replay.status).toBe(401);

    // The legitimate (rotated) token is now dead too.
    const afterTheft = await api().post('/api/v1/auth/refresh').set('Cookie', rotated);
    expect(afterTheft.status).toBe(401);
    expect(await RefreshToken.countDocuments({ revokedAt: null })).toBe(0);
    expect(await AuditLog.countDocuments({ action: 'auth.refresh_reuse_detected' })).toBeGreaterThan(0);
  });

  it('rejects refresh without a cookie', async () => {
    const res = await api().post('/api/v1/auth/refresh');
    expect(res.status).toBe(401);
  });
});

describe('POST /auth/logout', () => {
  it('revokes the refresh token and clears the cookie', async () => {
    const hotel = await createHotel();
    const owner = await createUser('owner', hotel._id);
    const { cookie } = await loginAs(owner.email);

    const res = await api().post('/api/v1/auth/logout').set('Cookie', cookie);
    expect(res.status).toBe(204);
    expect(refreshCookieFrom(res)).toMatch(/^bms_rt=;/);

    expect((await api().post('/api/v1/auth/refresh').set('Cookie', cookie)).status).toBe(401);
  });
});

describe('GET /auth/me', () => {
  it('requires a valid bearer token', async () => {
    expect((await api().get('/api/v1/auth/me')).status).toBe(401);
    expect((await api().get('/api/v1/auth/me').set('Authorization', 'Bearer not-a-jwt')).status).toBe(401);
  });

  it('returns user, hotel summary and role permissions', async () => {
    const hotel = await createHotel({ name: 'Courtyard Test' });
    const fd = await createUser('front_desk', hotel._id);
    const { token } = await loginAs(fd.email);

    const res = await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data.hotel).toMatchObject({ name: 'Courtyard Test', totalRooms: 12 });
    expect(res.body.data.permissions).toContain('stays.manage');
    expect(res.body.data.permissions).not.toContain('finance.read');
  });

  it('invalidates access tokens immediately when the account is deactivated', async () => {
    const hotel = await createHotel();
    const mgr = await createUser('manager', hotel._id);
    const { token } = await loginAs(mgr.email);

    await User.updateOne({ _id: mgr._id }, { $set: { isActive: false }, $inc: { tokenVersion: 1 } });
    expect((await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });
});

describe('POST /auth/register', () => {
  it('lets an owner create front desk staff inside their own hotel only', async () => {
    const hotel = await createHotel();
    const otherHotel = await createHotel();
    const owner = await createUser('owner', hotel._id);
    const { token } = await loginAs(owner.email);

    const res = await api()
      .post('/api/v1/auth/register')
      .set('Authorization', `Bearer ${token}`)
      .send({
        name: 'Asha Desk',
        email: 'asha@test.example',
        password: 'Welcome2024x',
        role: 'front_desk',
        phone: '98201 44552',
        hotelId: String(otherHotel._id),
      });

    expect(res.status).toBe(201);
    expect(res.body.data.user.hotelId).toBe(String(hotel._id)); // payload hotelId ignored
    expect(res.body.data.user.phone).toBe('+919820144552');
    expect(res.body.data.user.passwordHash).toBeUndefined();

    const login = await api().post('/api/v1/auth/login').send({ email: 'asha@test.example', password: 'Welcome2024x' });
    expect(login.status).toBe(200);
  });

  it('prevents owners from minting owners and enforces password strength + unique email', async () => {
    const hotel = await createHotel();
    const owner = await createUser('owner', hotel._id);
    const { token } = await loginAs(owner.email);
    const post = (body: object) => api().post('/api/v1/auth/register').set('Authorization', `Bearer ${token}`).send(body);

    expect((await post({ name: 'Second Owner', email: 'o2@test.example', password: 'Welcome2024x', role: 'owner' })).status).toBe(403);
    expect((await post({ name: 'Weak', email: 'weak@test.example', password: 'short', role: 'front_desk' })).status).toBe(400);
    expect((await post({ name: 'Dup', email: owner.email, password: 'Welcome2024x', role: 'front_desk' })).status).toBe(409);
  });

  it('is forbidden for managers and front desk', async () => {
    const hotel = await createHotel();
    const mgr = await createUser('manager', hotel._id);
    const { token } = await loginAs(mgr.email);
    const res = await api()
      .post('/api/v1/auth/register')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'X Person', email: 'x@test.example', password: 'Welcome2024x', role: 'front_desk' });
    expect(res.status).toBe(403);
  });
});
