/**
 * Operator commands for production, where the seed is refused and there is no email-based reset.
 * Values come from environment variables (never command-line arguments, which end up in shell history).
 *
 *   ADMIN_HOTEL_NAME="Heritage Courtyard" ADMIN_HOTEL_SLUG=heritage-courtyard ADMIN_CITY=Jaipur ADMIN_STATE=Rajasthan \
 *   ADMIN_TOTAL_ROOMS=12 ADMIN_OWNER_NAME="…" ADMIN_OWNER_EMAIL=… ADMIN_PASSWORD=… \
 *     node dist/scripts/admin.js create-property
 *
 *   ADMIN_EMAIL=owner@… ADMIN_PASSWORD=… node dist/scripts/admin.js reset-password
 */
import { z } from 'zod';
import { connectDatabase, disconnectDatabase } from '../config/db.js';
import { env } from '../config/env.js';
import { passwordSchema } from '../modules/auth/auth.validation.js';
import { hashPassword } from '../modules/auth/password.js';
import { revokeAllForUser } from '../modules/auth/token.service.js';
import { Hotel } from '../modules/hotels/hotel.model.js';
import { User } from '../modules/users/user.model.js';
import { audit } from '../shared/audit/audit.service.js';

const read = <T extends z.ZodType>(schema: T): z.infer<T> => {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n'));
  }
  return parsed.data;
};

async function createProperty(): Promise<void> {
  const v = read(
    z.object({
      ADMIN_HOTEL_NAME: z.string().trim().min(2).max(120),
      ADMIN_HOTEL_SLUG: z.string().regex(/^[a-z0-9-]{3,80}$/, 'lowercase letters, digits and dashes'),
      ADMIN_CITY: z.string().trim().min(2),
      ADMIN_STATE: z.string().trim().min(2),
      ADMIN_TOTAL_ROOMS: z.coerce.number().int().min(1).max(500),
      ADMIN_OWNER_NAME: z.string().trim().min(2).max(120),
      ADMIN_OWNER_EMAIL: z.email().transform((e) => e.toLowerCase()),
      ADMIN_PASSWORD: passwordSchema,
    }),
  );
  if (await Hotel.exists({ slug: v.ADMIN_HOTEL_SLUG })) throw new Error(`A property with slug "${v.ADMIN_HOTEL_SLUG}" already exists`);
  if (await User.exists({ email: v.ADMIN_OWNER_EMAIL })) throw new Error(`A user with email ${v.ADMIN_OWNER_EMAIL} already exists`);
  const hotel = await Hotel.create({
    name: v.ADMIN_HOTEL_NAME,
    slug: v.ADMIN_HOTEL_SLUG,
    address: { city: v.ADMIN_CITY, state: v.ADMIN_STATE },
    totalRooms: v.ADMIN_TOTAL_ROOMS,
    status: 'active',
  });
  const owner = await User.create({
    name: v.ADMIN_OWNER_NAME,
    email: v.ADMIN_OWNER_EMAIL,
    role: 'owner',
    hotelId: hotel._id,
    passwordHash: await hashPassword(v.ADMIN_PASSWORD),
  });
  await audit({ hotelId: hotel._id, actor: { type: 'system' }, action: 'admin.property_created', entity: { type: 'User', id: owner._id } });
  console.log(`Created property "${hotel.name}" (/h/${hotel.slug}) and owner ${owner.email}. Ask them to change the password after first sign-in.`);
}

async function resetPassword(): Promise<void> {
  const v = read(z.object({ ADMIN_EMAIL: z.email().transform((e) => e.toLowerCase()), ADMIN_PASSWORD: passwordSchema }));
  const user = await User.findOne({ email: v.ADMIN_EMAIL }).select('+passwordHash +failedLoginCount +lockedUntil');
  if (!user) throw new Error(`No user with email ${v.ADMIN_EMAIL}`);
  user.passwordHash = await hashPassword(v.ADMIN_PASSWORD);
  user.tokenVersion += 1;
  user.failedLoginCount = 0;
  user.lockedUntil = null;
  await user.save();
  await revokeAllForUser(user._id);
  await audit({ hotelId: user.hotelId ?? null, actor: { type: 'system' }, action: 'admin.password_reset', entity: { type: 'User', id: user._id } });
  console.log(`Password reset for ${user.email}; all their sessions were signed out. Ask them to change it after sign-in.`);
}

const COMMANDS: Record<string, () => Promise<void>> = { 'create-property': createProperty, 'reset-password': resetPassword };

async function main(): Promise<void> {
  const command = process.argv[2] ?? '';
  const run = COMMANDS[command];
  if (!run) {
    console.error(`Usage: admin <${Object.keys(COMMANDS).join('|')}> (inputs via ADMIN_* environment variables, see the file header)`);
    process.exit(2);
  }
  await connectDatabase(env.MONGODB_URI);
  try {
    await run();
  } finally {
    await disconnectDatabase();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
