jest.mock('../app/_services/firebase', () => ({ auth: {}, db: {} }));
jest.mock('firebase/auth', () => ({
  EmailAuthProvider: {},
  GoogleAuthProvider: class {},
  OAuthProvider: class {},
}));
jest.mock('firebase/firestore', () => ({}));
jest.mock('../app/_services/occupancy', () => jest.requireActual('../app/_services/occupancy'));

import { authErrorKey, availableProviders, isEmail, validateSignUp } from '../app/_services/auth';
import { takenStreetSpots } from '../app/_hooks/useSpots';
import type { ParkingSpot } from '../app/_types';

describe('validateSignUp', () => {
  const ok = { name: 'Hamza', email: 'h@example.com', password: 'parking123', confirm: 'parking123' };
  it('accepts a complete form', () => expect(validateSignUp(ok)).toBeNull());
  it('needs a name', () => expect(validateSignUp({ ...ok, name: ' ' })).toBe('account.errors.nameShort'));
  it('needs a real email', () => expect(validateSignUp({ ...ok, email: 'nope' })).toBe('account.errors.emailInvalid'));
  it('needs 8+ characters', () => {
    expect(validateSignUp({ ...ok, password: 'ab1', confirm: 'ab1' })).toBe('account.errors.passwordShort');
  });
  it('needs letters and numbers', () => {
    expect(validateSignUp({ ...ok, password: 'abcdefgh', confirm: 'abcdefgh' })).toBe('account.errors.passwordWeak');
  });
  it('needs matching passwords', () => {
    expect(validateSignUp({ ...ok, confirm: 'parking124' })).toBe('account.errors.passwordMismatch');
  });
});

describe('isEmail', () => {
  it('trims and checks the shape', () => {
    expect(isEmail(' a@b.ca ')).toBe(true);
    expect(isEmail('a@b')).toBe(false);
    expect(isEmail('a b@c.com')).toBe(false);
  });
});

describe('authErrorKey', () => {
  it('turns Firebase codes into messages', () => {
    expect(authErrorKey({ code: 'auth/email-already-in-use' })).toBe('account.errors.emailInUse');
    expect(authErrorKey({ code: 'auth/invalid-credential' })).toBe('account.errors.wrongCredentials');
    expect(authErrorKey({ code: 'auth/operation-not-allowed' })).toBe('account.errors.providerOff');
    expect(authErrorKey({ code: 'auth/popup-closed-by-user' })).toBe('account.errors.cancelled');
    expect(authErrorKey(new Error('?'))).toBe('account.errors.generic');
  });
});

describe('availableProviders', () => {
  it('shows no provider buttons until they are configured (email always works)', () => {
    expect(availableProviders('web')).toEqual([]);
    expect(availableProviders('ios')).toEqual([]);
    expect(availableProviders('android')).toEqual([]);
  });
});

describe('takenStreetSpots', () => {
  const now = new Date('2026-11-07T12:00:00Z');
  const spot = (id: string, until: Date | null): ParkingSpot => ({
    id, source: 'osm', lat: 0, lng: 0, type: 'street', feeRequired: false, timeRestrictions: null,
    seasonalBan: false, occupied: true, occupiedSince: now, occupiedBy: 'u1', occupiedUntil: until,
    city: 'Ottawa', verified: false, notes: '',
  });

  it('reads the position from street session ids and drops expired holds', () => {
    const taken = takenStreetSpots([
      spot('street_45.41234_-75.69876', new Date('2026-11-07T13:00:00Z')),
      spot('street_45.40000_-75.70000', new Date('2026-11-07T11:00:00Z')), // expired
      spot('osm_123', new Date('2026-11-07T13:00:00Z')), // a pin, not a street line
    ], now);
    expect(taken).toEqual([{
      id: 'street_45.41234_-75.69876', lat: 45.41234, lng: -75.69876,
      until: new Date('2026-11-07T13:00:00Z'), userId: 'u1',
    }]);
  });
});
