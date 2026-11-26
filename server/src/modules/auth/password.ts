import bcrypt from 'bcrypt';
import { env } from '../../config/env.js';

// Low cost only under test, where hashing speed matters and the hashes are throwaway.
const ROUNDS = env.isTest ? 4 : 12;

export const hashPassword = (plain: string): Promise<string> => bcrypt.hash(plain, ROUNDS);

export const verifyPassword = (plain: string, hash: string): Promise<boolean> => bcrypt.compare(plain, hash);

/** Compared against when the email is unknown, so response timing doesn't reveal which accounts exist. */
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-real-password', ROUNDS);
export const burnPasswordCheck = (plain: string): Promise<boolean> => bcrypt.compare(plain, DUMMY_HASH);
