import { streetStayMinutes, streetVerdict } from '../app/_services/parkingRules';

// Local times; the rules use the device clock
const at = (y: number, mo: number, d: number, h: number, mi = 0) => new Date(y, mo - 1, d, h, mi);

describe('streetVerdict', () => {
  it('uses the Ottawa unsigned-street default when nothing is mapped', () => {
    const now = at(2026, 6, 10, 10); // Wednesday 10:00
    const verdict = streetVerdict({ kind: 'street', city: 'Ottawa' }, now);
    expect(verdict.leaveBy).toEqual(at(2026, 6, 10, 13));
  });

  it('uses the mapped limit instead of the default', () => {
    const now = at(2026, 6, 10, 10);
    const verdict = streetVerdict({ kind: 'street', city: 'Ottawa', maxstay: '1 h' }, now);
    expect(verdict.leaveBy).toEqual(at(2026, 6, 10, 11));
  });

  it('has no time limit on a Gatineau street outside winter', () => {
    const verdict = streetVerdict({ kind: 'street', city: 'Gatineau' }, at(2026, 6, 10, 10));
    expect(verdict.leaveBy).toBeNull();
    expect(verdict.level).toBe('ok');
  });

  it('applies the Gatineau winter overnight ban', () => {
    // Tuesday Jan 13 2026, 02:00: inside the 0–6 h weekday ban
    const banned = streetVerdict({ kind: 'street', city: 'Gatineau' }, at(2026, 1, 13, 2));
    expect(banned.level).toBe('banned');
    expect(banned.allowedFrom).toEqual(at(2026, 1, 13, 6));
    // Same day at 20:00: allowed until midnight
    const evening = streetVerdict({ kind: 'street', city: 'Gatineau' }, at(2026, 1, 13, 20));
    expect(evening.leaveBy).toEqual(at(2026, 1, 14, 0));
  });
});

describe('streetStayMinutes', () => {
  it('returns null for no limit, 0 when banned, minutes otherwise', () => {
    expect(streetStayMinutes({ kind: 'street', city: 'Gatineau' }, at(2026, 6, 10, 10))).toBeNull();
    expect(streetStayMinutes({ kind: 'street', city: 'Gatineau' }, at(2026, 1, 13, 2))).toBe(0);
    expect(streetStayMinutes({ kind: 'street', city: 'Ottawa' }, at(2026, 6, 10, 10))).toBe(180);
    expect(streetStayMinutes({ kind: 'free15' })).toBe(15);
    expect(streetStayMinutes({ kind: 'paid', maxStayHours: 2 })).toBe(120);
    expect(streetStayMinutes({ kind: 'noParking' })).toBe(0);
  });
});
