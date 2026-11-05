import {
  evaluateSpot,
  findSpotsForStay,
  gatineauBanAt,
  nextGatineauBan,
  ottawaDefaultLeaveBy,
  parseMaxstayMinutes,
  allowedStayMinutes,
} from '../app/_services/parkingRules';
import { ParkingSpot } from '../app/_types';

// Local-time dates. Nov 2 2026 is a Monday, Dec 2 2026 a Wednesday.
const at = (month: number, day: number, hour: number, minute = 0) =>
  new Date(2026, month - 1, day, hour, minute);

function spot(overrides: Partial<ParkingSpot> = {}): ParkingSpot {
  return {
    id: 'osm_node_1',
    source: 'osm',
    lat: 45.4215,
    lng: -75.6972,
    type: 'street',
    feeRequired: false,
    feeUnknown: false,
    timeRestrictions: null,
    seasonalBan: false,
    occupied: false,
    occupiedSince: null,
    occupiedBy: null,
    city: 'Ottawa',
    ...overrides,
  };
}

describe('ottawaDefaultLeaveBy', () => {
  it.each([
    ['weekday morning', at(11, 2, 10), at(11, 2, 13)],
    ['before the window opens', at(11, 2, 5), at(11, 2, 10)],
    ['late afternoon runs into the next morning', at(11, 2, 17), at(11, 3, 10)],
    ['evening', at(11, 2, 20), at(11, 3, 10)],
    ['Saturday gets 6 hours', at(11, 7, 9), at(11, 7, 15)],
    ['Friday evening rolls into Saturday', at(11, 6, 18), at(11, 7, 13)],
    ['Sunday is treated like Saturday', at(11, 8, 8), at(11, 8, 14)],
  ])('%s', (_label, start, expected) => {
    expect(ottawaDefaultLeaveBy(start)).toEqual(expected);
  });
});

describe('Gatineau winter overnight ban', () => {
  it('bans weekday nights from midnight to 6:00', () => {
    expect(gatineauBanAt(at(12, 2, 1))).toEqual({ start: at(12, 2, 0), end: at(12, 2, 6) });
    expect(gatineauBanAt(at(12, 2, 6))).toBeNull();
  });

  it('only bans 3:00 to 6:00 on weekend nights', () => {
    expect(gatineauBanAt(at(12, 5, 1))).toBeNull();
    expect(gatineauBanAt(at(12, 5, 4))).not.toBeNull();
  });

  it('does not apply outside Dec 1 – Apr 1', () => {
    expect(gatineauBanAt(at(11, 25, 2))).toBeNull();
    expect(nextGatineauBan(at(11, 30, 12))).toEqual(at(12, 1, 0));
    expect(nextGatineauBan(new Date(2027, 2, 31, 12))).toBeNull();
  });
});

describe('evaluateSpot', () => {
  it('applies the Ottawa 3-hour default to unsigned streets', () => {
    const verdict = evaluateSpot(spot(), at(11, 2, 10));
    expect(verdict.level).toBe('limited');
    expect(verdict.leaveBy).toEqual(at(11, 2, 13));
    expect(verdict.notes.map(n => n.key)).toEqual(['rules.ottawaDefault']);
  });

  it('uses a posted limit instead of the Ottawa default', () => {
    const verdict = evaluateSpot(spot({ timeRestrictions: 'Max 2 hours' }), at(11, 2, 10));
    expect(verdict.leaveBy).toEqual(at(11, 2, 12));
  });

  it('leaves lots without a known limit', () => {
    const verdict = evaluateSpot(spot({ type: 'lot' }), at(11, 2, 10));
    expect(verdict).toMatchObject({ level: 'ok', leaveBy: null });
  });

  it('marks Gatineau streets banned during the overnight window', () => {
    const verdict = evaluateSpot(spot({ city: 'Gatineau' }), at(12, 2, 1));
    expect(verdict).toMatchObject({ level: 'banned', allowedFrom: at(12, 2, 6) });
    expect(allowedStayMinutes(verdict, at(12, 2, 1))).toBe(0);
  });

  it('counts down to the next Gatineau ban during the day', () => {
    const verdict = evaluateSpot(spot({ city: 'Gatineau' }), at(12, 2, 14));
    expect(verdict.leaveBy).toEqual(at(12, 3, 0));
  });

  it('does not apply the Gatineau ban to lots', () => {
    expect(evaluateSpot(spot({ city: 'Gatineau', type: 'lot' }), at(12, 2, 1)).level).toBe('ok');
  });

  it('never presents an unconfirmed fee as certain', () => {
    const verdict = evaluateSpot(spot({ type: 'lot', feeUnknown: true }), at(11, 2, 10));
    expect(verdict.level).toBe('unclear');
  });

  it('flags Ottawa streets when a snow ban is likely, only in season', () => {
    expect(evaluateSpot(spot(), at(12, 2, 10), { ottawaBanLikely: true }).level).toBe('unclear');
    expect(evaluateSpot(spot(), at(11, 2, 10), { ottawaBanLikely: true }).level).toBe('limited');
  });
});

describe('parseMaxstayMinutes', () => {
  it.each([
    ['Max 2 hours', 120],
    ['Max 1h30m', 90],
    ['Max 30 min', 30],
    ['Mo-Fr', null],
    [null, null],
  ])('%s', (input, expected) => {
    expect(parseMaxstayMinutes(input)).toBe(expected);
  });
});

describe('findSpotsForStay', () => {
  const origin = { latitude: 45.4215, longitude: -75.6972 };
  const now = at(11, 2, 10);
  const near = (id: string, metres: number, overrides: Partial<ParkingSpot> = {}) =>
    spot({ id, lat: origin.latitude + metres / 111_000, type: 'lot', ...overrides });

  it('ranks confirmed spots before closer unconfirmed ones', () => {
    const result = findSpotsForStay([
      near('unconfirmed', 100, { feeUnknown: true }),
      near('confirmed', 400),
    ], origin, 120, now);
    expect(result.map(c => c.spot.id)).toEqual(['confirmed', 'unconfirmed']);
    expect(result[0].walkMinutes).toBe(5);
  });

  it('excludes occupied spots, spots too far away and limits that are too short', () => {
    const result = findSpotsForStay([
      near('occupied', 100, { occupied: true }),
      near('far', 3000),
      near('street3h', 200, { type: 'street' }),
      near('ok', 300),
    ], origin, 4 * 60, now);
    expect(result.map(c => c.spot.id)).toEqual(['ok']);
  });
});
