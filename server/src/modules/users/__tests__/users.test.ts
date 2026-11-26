import { describe, expect, it } from 'vitest';
import { api, createHotel, createUser, loginAs, useTestDatabase } from '../../../test/helpers.js';

useTestDatabase();

describe('staff management & property isolation', () => {
  it('lists only staff of the caller’s own hotel', async () => {
    const hotelA = await createHotel();
    const hotelB = await createHotel();
    const ownerA = await createUser('owner', hotelA._id);
    await createUser('front_desk', hotelA._id);
    await createUser('front_desk', hotelB._id);
    await createUser('manager', hotelB._id);

    const { token } = await loginAs(ownerA.email);
    const res = await api().get('/api/v1/users').set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(2);
    expect(res.body.data.every((u: { hotelId: string }) => u.hotelId === String(hotelA._id))).toBe(true);
    expect(res.body.meta).toMatchObject({ page: 1, total: 2 });
  });

  it('ignores operator injection in query strings', async () => {
    const hotel = await createHotel();
    const owner = await createUser('owner', hotel._id);
    const { token } = await loginAs(owner.email);
    const res = await api().get('/api/v1/users?role[$ne]=x&q[$regex]=.*').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('front desk cannot list staff', async () => {
    const hotel = await createHotel();
    const fd = await createUser('front_desk', hotel._id);
    const { token } = await loginAs(fd.email);
    expect((await api().get('/api/v1/users').set('Authorization', `Bearer ${token}`)).status).toBe(403);
  });

  it('owner can deactivate staff, which kills their sessions immediately', async () => {
    const hotel = await createHotel();
    const owner = await createUser('owner', hotel._id);
    const fd = await createUser('front_desk', hotel._id);
    const ownerSession = await loginAs(owner.email);
    const fdSession = await loginAs(fd.email);

    const res = await api().patch(`/api/v1/users/${fd._id}`).set('Authorization', `Bearer ${ownerSession.token}`).send({ isActive: false });
    expect(res.status).toBe(200);
    expect(res.body.data.user.isActive).toBe(false);

    expect((await api().get('/api/v1/auth/me').set('Authorization', `Bearer ${fdSession.token}`)).status).toBe(401);
    expect((await api().post('/api/v1/auth/refresh').set('Cookie', fdSession.cookie)).status).toBe(401);
  });

  it('cannot modify staff of another hotel (404, no existence leak)', async () => {
    const hotelA = await createHotel();
    const hotelB = await createHotel();
    const ownerA = await createUser('owner', hotelA._id);
    const fdB = await createUser('front_desk', hotelB._id);
    const { token } = await loginAs(ownerA.email);

    const res = await api().patch(`/api/v1/users/${fdB._id}`).set('Authorization', `Bearer ${token}`).send({ isActive: false });
    expect(res.status).toBe(404);
  });

  it('owner cannot demote themselves or promote staff to owner', async () => {
    const hotel = await createHotel();
    const owner = await createUser('owner', hotel._id);
    const mgr = await createUser('manager', hotel._id);
    const { token } = await loginAs(owner.email);

    expect((await api().patch(`/api/v1/users/${owner._id}`).set('Authorization', `Bearer ${token}`).send({ role: 'manager' })).status).toBe(400);
    expect((await api().patch(`/api/v1/users/${mgr._id}`).set('Authorization', `Bearer ${token}`).send({ role: 'owner' })).status).toBe(403);
  });

  it('super admin must name a hotel and can manage any property', async () => {
    const hotel = await createHotel();
    await createUser('manager', hotel._id);
    const admin = await createUser('super_admin', null);
    const { token } = await loginAs(admin.email);

    expect((await api().get('/api/v1/users').set('Authorization', `Bearer ${token}`)).status).toBe(400);
    const res = await api().get(`/api/v1/users?hotelId=${hotel._id}`).set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
  });
});
