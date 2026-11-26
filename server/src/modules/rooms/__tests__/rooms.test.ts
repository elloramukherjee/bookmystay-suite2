import { describe, expect, it } from 'vitest';
import { createBookingViaApi, dayFromNow } from '../../../test/booking-fixtures.js';
import { api, createHotel, createUser, loginAs, useTestDatabase } from '../../../test/helpers.js';
import { Availability } from '../../availability/availability.model.js';
import { Hotel } from '../../hotels/hotel.model.js';
import { RoomType } from '../roomType.model.js';

useTestDatabase();

const newType = {
  name: 'Heritage Jharokha Room',
  maxAdults: 2,
  maxChildren: 1,
  maxOccupancy: 3,
  baseRatePaise: 640_000,
  otaRatePaise: 780_000,
  amenities: ['Copper soaking tub'],
  unitNumbers: ['201', '202'],
};

describe('room management', () => {
  it('creates a room type with units, a default rate plan, and syncs inventory counts', async () => {
    const hotel = await createHotel();
    const owner = await createUser('owner', hotel._id);
    const { token } = await loginAs(owner.email);

    const res = await api().post('/api/v1/rooms').set('Authorization', `Bearer ${token}`).send(newType);
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ name: 'Heritage Jharokha Room', slug: 'heritage-jharokha-room', totalRooms: 2 });
    expect(res.body.data.units.map((u: { number: string }) => u.number)).toEqual(['201', '202']);
    expect(res.body.data.ratePlans[0]).toMatchObject({ code: 'EP', name: 'Room only' });
    expect((await Hotel.findById(hotel._id).lean())!.totalRooms).toBe(2);

    // Public listing shows it without internal fields.
    const pub = await api().get(`/api/v1/hotels/${hotel._id}/rooms`);
    expect(pub.body.data).toHaveLength(1);
    expect(pub.body.data[0].totalRooms).toBeUndefined();
  });

  it('rejects duplicate room numbers and invalid occupancy', async () => {
    const hotel = await createHotel();
    const owner = await createUser('owner', hotel._id);
    const { token } = await loginAs(owner.email);
    await api().post('/api/v1/rooms').set('Authorization', `Bearer ${token}`).send(newType);
    expect(
      (
        await api()
          .post('/api/v1/rooms')
          .set('Authorization', `Bearer ${token}`)
          .send({ ...newType, name: 'Another', unitNumbers: ['202'] })
      ).status,
    ).toBe(409);
    expect(
      (
        await api()
          .post('/api/v1/rooms')
          .set('Authorization', `Bearer ${token}`)
          .send({ ...newType, name: 'Bad', maxAdults: 3, maxOccupancy: 2, unitNumbers: [] })
      ).status,
    ).toBe(400);
  });

  it('refuses to remove a room that future bookings depend on, and allows it otherwise', async () => {
    const hotel = await createHotel();
    const owner = await createUser('owner', hotel._id);
    const { token } = await loginAs(owner.email);
    const created = await api()
      .post('/api/v1/rooms')
      .set('Authorization', `Bearer ${token}`)
      .send({ ...newType, unitNumbers: ['301'] });
    const rt = await RoomType.findById(created.body.data.id).lean();
    await createBookingViaApi(hotel._id, rt!._id, { checkIn: dayFromNow(4), checkOut: dayFromNow(5) });

    const unitId = created.body.data.units[0].id;
    const blocked = await api().patch(`/api/v1/rooms/units/${unitId}`).set('Authorization', `Bearer ${token}`).send({ isActive: false });
    expect(blocked.status).toBe(409);
    expect((await RoomType.findById(rt!._id).lean())!.totalRooms).toBe(1);

    const add = await api().post(`/api/v1/rooms/${rt!._id}/units`).set('Authorization', `Bearer ${token}`).send({ number: '302' });
    expect(add.status).toBe(201);
    const night = await Availability.findOne({ roomTypeId: rt!._id, date: dayFromNow(4) }).lean();
    expect(night!.totalRooms).toBe(2);
    expect((await api().patch(`/api/v1/rooms/units/${add.body.data.id}`).set('Authorization', `Bearer ${token}`).send({ isActive: false })).status).toBe(200);
  });

  it('front desk can view rooms but not change them; other hotels are invisible', async () => {
    const hotel = await createHotel();
    const other = await createHotel();
    const fd = await createUser('front_desk', hotel._id);
    const otherOwner = await createUser('owner', other._id);
    const ownerToken = (await loginAs(otherOwner.email)).token;
    const created = await api().post('/api/v1/rooms').set('Authorization', `Bearer ${ownerToken}`).send(newType);
    const { token } = await loginAs(fd.email);

    expect((await api().get('/api/v1/rooms').set('Authorization', `Bearer ${token}`)).body.data).toEqual([]);
    expect((await api().post('/api/v1/rooms').set('Authorization', `Bearer ${token}`).send(newType)).status).toBe(403);
    expect(
      (await api().put(`/api/v1/rooms/${created.body.data.id}`).set('Authorization', `Bearer ${ownerToken}`).send({ baseRatePaise: 700_000 })).status,
    ).toBe(200);
  });
});

describe('public hotel directory & policies', () => {
  it('lists active hotels with a "from" rate and exposes published policies', async () => {
    const hotel = await createHotel({ slug: 'policy-haveli' });
    const owner = await createUser('owner', hotel._id);
    const { token } = await loginAs(owner.email);
    await api().post('/api/v1/rooms').set('Authorization', `Bearer ${token}`).send(newType);
    await api()
      .put(`/api/v1/hotels/${hotel._id}/policies/pets`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Pets', body: 'Pets are not allowed, except service animals.' });
    await api()
      .put(`/api/v1/hotels/${hotel._id}/policies/smoking`)
      .set('Authorization', `Bearer ${token}`)
      .send({ title: 'Smoking', body: 'Smoking only in the garden area.', published: false });

    const list = await api().get('/api/v1/hotels');
    expect(list.body.data[0]).toMatchObject({ slug: 'policy-haveli', fromRatePaise: 640_000 });
    const policies = await api().get('/api/v1/hotels/policy-haveli/policies');
    expect(policies.body.data.map((p: { type: string }) => p.type)).toEqual(['pets']);
  });
});
