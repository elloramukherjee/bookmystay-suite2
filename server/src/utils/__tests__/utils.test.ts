import { describe, expect, it } from 'vitest';
import { stripMongoOperators, safeQueryParser } from '../../middleware/sanitize.js';
import { ROLE_PERMISSIONS } from '../../modules/auth/permissions.js';
import { formatPhone, maskPhone, normalizePhone } from '../phone.js';

describe('normalizePhone', () => {
  it.each([
    ['98201 44552', '+919820144552'],
    ['09820144552', '+919820144552'],
    ['919820144552', '+919820144552'],
    ['+91-98201-44552', '+919820144552'],
    ['0091 98201 44552', '+919820144552'],
    ['+44 7911 123456', '+447911123456'],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(['12345', '5820144552', '+91 12345 67890', '', 'abc'])('rejects %s', (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it('formats and masks', () => {
    expect(formatPhone('+919820144552')).toBe('+91 98201 44552');
    expect(maskPhone('+919820144552')).toBe('+91•••••44552');
  });
});

describe('sanitisation', () => {
  it('removes $ and dotted keys recursively, including inside arrays', () => {
    const input = { email: { $ne: null }, 'a.b': 1, nested: [{ $where: 'x', ok: 1 }], keep: 'yes' };
    expect(stripMongoOperators(input)).toEqual({ email: {}, nested: [{ ok: 1 }], keep: 'yes' });
  });

  it('sanitises at query-parse time', () => {
    expect(safeQueryParser('role[$ne]=x&page=2')).toEqual({ role: {}, page: '2' });
  });
});

describe('role permissions', () => {
  it('is strictly hierarchical for front desk → manager → owner', () => {
    for (const p of ROLE_PERMISSIONS.front_desk) expect(ROLE_PERMISSIONS.manager.has(p)).toBe(true);
    for (const p of ROLE_PERMISSIONS.manager) expect(ROLE_PERMISSIONS.owner.has(p)).toBe(true);
    expect(ROLE_PERMISSIONS.manager.has('finance.read')).toBe(false);
    expect(ROLE_PERMISSIONS.front_desk.has('rates.manage')).toBe(false);
  });
});
