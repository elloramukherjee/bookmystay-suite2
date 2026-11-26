import { describe, expect, it } from 'vitest';
import { api, createHotel, createUser, loginAs, useTestDatabase } from '../../../test/helpers.js';
import { Hotel } from '../hotel.model.js';

useTestDatabase();

describe('GET /hotels/:slug (public)', () => {
  it('returns the public profile without internal fields', async () => {
    const hotel = await createHotel({ slug: 'jaipur-haveli' });
    await Hotel.updateOne(
      { _id: hotel._id },
      {
        $set: {
          reviews: [
            { author: 'A', rating: 5, text: 'Wonderful stay here' },
            { author: 'B', rating: 4, text: 'Lovely courtyard' },
          ],
        },
      },
    );

    const res = await api().get('/api/v1/hotels/jaipur-haveli');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ slug: 'jaipur-haveli', rating: { average: 4.5, count: 2 } });
    expect(res.body.data.gstin).toBeUndefined();
    expect(res.body.data.settings).toBeUndefined();
    expect(res.body.data.integrations).toBeUndefined();
  });

  it('404s for unknown or suspended hotels', async () => {
    await createHotel({ slug: 'closed-haveli', status: 'suspended' });
    expect((await api().get('/api/v1/hotels/nope')).status).toBe(404);
    expect((await api().get('/api/v1/hotels/closed-haveli')).status).toBe(404);
  });
});

describe('hotel settings & updates', () => {
  it('staff can read their own hotel settings; other hotels look nonexistent', async () => {
    const mine = await createHotel();
    const other = await createHotel();
    const fd = await createUser('front_desk', mine._id);
    const { token } = await loginAs(fd.email);

    const own = await api().get(`/api/v1/hotels/${mine._id}/settings`).set('Authorization', `Bearer ${token}`);
    expect(own.status).toBe(200);
    expect(own.body.data.settings.directDiscountPercent).toBe(10);
    expect(own.body.data.integrations.paymentMode).toBe('development-mock');

    expect((await api().get(`/api/v1/hotels/${other._id}/settings`).set('Authorization', `Bearer ${token}`)).status).toBe(404);
  });

  it('owner can update profile & settings with partial nested updates', async () => {
    const hotel = await createHotel();
    const owner = await createUser('owner', hotel._id);
    const { token } = await loginAs(owner.email);

    const res = await api()
      .put(`/api/v1/hotels/${hotel._id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ address: { pincode: '302002' }, contact: { whatsapp: '098765 43210' }, settings: { directDiscountPercent: 12 } });

    expect(res.status).toBe(200);
    expect(res.body.data.address).toMatchObject({ city: 'Jaipur', pincode: '302002' }); // city preserved
    expect(res.body.data.contact.whatsapp).toBe('+919876543210');
    expect(res.body.data.settings.directDiscountPercent).toBe(12);
    expect(res.body.data.settings.otaCommissionRate).toBe(18); // untouched
  });

  it('rejects invalid settings and unknown fields', async () => {
    const hotel = await createHotel();
    const owner = await createUser('owner', hotel._id);
    const { token } = await loginAs(owner.email);
    const put = (body: object) => api().put(`/api/v1/hotels/${hotel._id}`).set('Authorization', `Bearer ${token}`).send(body);

    expect((await put({ settings: { directDiscountPercent: 90 } })).status).toBe(400);
    expect((await put({ status: 'suspended' })).status).toBe(400);
    expect((await put({ gstin: 'not-a-gstin' })).status).toBe(400);
    expect((await put({ settings: { taxSlabs: [{ upToPaise: 750000, ratePercent: 5 }] } })).status).toBe(400);
  });

  it('managers cannot update hotel profile; owners cannot update other hotels', async () => {
    const hotel = await createHotel();
    const other = await createHotel();
    const mgr = await createUser('manager', hotel._id);
    const owner = await createUser('owner', hotel._id);
    const mgrToken = (await loginAs(mgr.email)).token;
    const ownerToken = (await loginAs(owner.email)).token;

    expect((await api().put(`/api/v1/hotels/${hotel._id}`).set('Authorization', `Bearer ${mgrToken}`).send({ tagline: 'x' })).status).toBe(403);
    expect((await api().put(`/api/v1/hotels/${other._id}`).set('Authorization', `Bearer ${ownerToken}`).send({ tagline: 'x' })).status).toBe(404);
  });
});

describe('platform', () => {
  it('health reports db and transaction support', async () => {
    const res = await api().get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'ok', db: 'connected', transactions: true });
  });

  it('sets security headers and hides x-powered-by', async () => {
    const res = await api().get('/api/v1/health');
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-request-id']).toEqual(expect.any(String));
  });

  it('returns JSON 404 for unknown routes and 400 for malformed JSON', async () => {
    expect((await api().get('/api/v1/nope')).body.error.code).toBe('NOT_FOUND');
    const bad = await api().post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(bad.status).toBe(400);
  });
});
