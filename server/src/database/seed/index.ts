import { randomBytes } from 'node:crypto';
import mongoose from 'mongoose';
import { connectDatabase, disconnectDatabase } from '../../config/db.js';
import { env } from '../../config/env.js';
import { hashPassword } from '../../modules/auth/password.js';
import { Hotel } from '../../modules/hotels/hotel.model.js';
import { User } from '../../modules/users/user.model.js';
import { SEED_HOTEL, SEED_STAFF } from './data.js';
import { seedBookings, seedPolicies, seedRooms } from './inventory.js';
import { seedReceptionist } from './receptionist.js';
import { seedCrm } from './crm.js';

/**
 * Idempotent development seed.
 *   npm run seed            → upsert the sample hotel and staff (existing passwords are left untouched)
 *   npm run seed -- --reset → drop the database first (refused in production)
 */
async function seed(): Promise<void> {
  const reset = process.argv.includes('--reset');
  if (env.isProduction) {
    throw new Error('Refusing to seed a production database.');
  }

  await connectDatabase(env.MONGODB_URI);
  if (reset) {
    await mongoose.connection.dropDatabase();
    console.log('• Database dropped');
  }
  await Promise.all(Object.values(mongoose.models).map((m) => m.syncIndexes()));

  const hotel = await Hotel.findOneAndUpdate({ slug: SEED_HOTEL.slug }, { $set: SEED_HOTEL }, { upsert: true, new: true, runValidators: true });
  console.log(`• Hotel: ${hotel.name} (${hotel.slug}) id=${hotel._id}`);

  const password = process.env.SEED_DEFAULT_PASSWORD || `Stay${randomBytes(6).toString('hex')}9`;
  const generated = !process.env.SEED_DEFAULT_PASSWORD;
  const passwordHash = await hashPassword(password);

  const created: string[] = [];
  for (const staff of SEED_STAFF) {
    const result = await User.updateOne(
      { email: staff.email },
      {
        $setOnInsert: {
          name: staff.name,
          email: staff.email,
          phone: staff.phone,
          role: staff.role,
          hotelId: staff.hotelBound ? hotel._id : null,
          passwordHash,
          isActive: true,
        },
      },
      { upsert: true },
    );
    if (result.upsertedCount) created.push(staff.email);
  }

  console.log('• Staff accounts:');
  for (const s of SEED_STAFF) {
    console.log(`    ${s.role.padEnd(12)} ${s.email}${created.includes(s.email) ? '  (new)' : '  (existing, password unchanged)'}`);
  }
  if (created.length) {
    console.log(
      generated
        ? `• Generated password for new accounts: ${password}\n  (set SEED_DEFAULT_PASSWORD in .env to choose your own; it is not stored anywhere else)`
        : '• New accounts use SEED_DEFAULT_PASSWORD from your .env',
    );
  }
  await seedRooms(hotel._id);
  await seedPolicies(hotel._id);
  const fresh = await Hotel.findById(hotel._id).lean();
  const bookings = fresh ? await seedBookings(fresh) : 0;
  console.log(`• Rooms, rate plans and policies seeded${bookings ? `; ${bookings} sample bookings created` : '; sample bookings already present (skipped)'}`);
  const rec = await seedReceptionist(hotel._id);
  console.log(`• Receptionist knowledge base: ${rec.faqs} new FAQs; ${rec.conversations} sample conversations`);
  const crm = await seedCrm(hotel._id);
  console.log(`• CRM: ${crm.templates} new follow-up templates; ${crm.preferences} guest preferences`);
  console.log(`• Public site: ${env.clientOrigins[0]}/h/${hotel.slug}`);
}

seed()
  .then(async () => {
    await disconnectDatabase();
    process.exit(0);
  })
  .catch(async (err) => {
    console.error(err);
    await disconnectDatabase().catch(() => undefined);
    process.exit(1);
  });
