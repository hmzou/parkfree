jest.mock('../app/_services/firebase', () => ({ db: {} }));
jest.mock('firebase/firestore', () => ({}));

import {
  ambassadorLevel,
  guessSignSide,
  ruleToKind,
  signReportFeatures,
  signStretch,
  snapToStreet,
  streetBearing,
  SignReport,
} from '../app/_services/ambassador';

// A straight east–west street drawn west → east along latitude 45.42
const LAT = 45.42;
const street: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [{
    type: 'Feature',
    properties: { kind: 'unknown', road: 'BANK ST' },
    geometry: { type: 'LineString', coordinates: [[-75.700, LAT], [-75.698, LAT], [-75.696, LAT]] },
  }],
};
// ~11 m north and south of the centreline
const north = { lat: LAT + 0.0001, lng: -75.699 };
const south = { lat: LAT - 0.0001, lng: -75.699 };

describe('snapToStreet', () => {
  it('finds the street, its name and distance', () => {
    const snap = snapToStreet(street, north)!;
    expect(snap.road).toBe('Bank St');
    expect(snap.distanceMeters).toBeGreaterThan(10);
    expect(snap.distanceMeters).toBeLessThan(12);
    expect(streetBearing(snap)).toBeCloseTo(90, 0); // drawn eastward
  });

  it('ignores streets farther than 35 m', () => {
    expect(snapToStreet(street, { lat: LAT + 0.001, lng: -75.699 })).toBeNull();
  });
});

describe('guessSignSide', () => {
  // Drawn eastward: north is on the left, south on the right
  it('uses the side you are standing on', () => {
    expect(guessSignSide(snapToStreet(street, north)!, north, null)).toEqual({ side: 'left', method: 'position' });
    expect(guessSignSide(snapToStreet(street, south)!, south, null)).toEqual({ side: 'right', method: 'position' });
  });

  it('keeps your side when the phone points along the street or at your own curb', () => {
    const snap = snapToStreet(street, north)!;
    expect(guessSignSide(snap, north, 90).side).toBe('left'); // facing east, along the street
    expect(guessSignSide(snap, north, 0).side).toBe('left'); // facing north, away from the street
  });

  it('picks the far side when the phone points across the street', () => {
    const snap = snapToStreet(street, north)!;
    // Standing on the north side and facing south (across): the sign is on the south curb
    expect(guessSignSide(snap, north, 180)).toEqual({ side: 'right', method: 'heading' });
    expect(guessSignSide(snap, north, 215).side).toBe('right'); // within 50°
    expect(guessSignSide(snap, north, 250).side).toBe('left'); // 70° off: not across
  });
});

describe('signStretch', () => {
  it('covers about 30 m either way along the street', () => {
    const snap = snapToStreet(street, { lat: LAT + 0.0001, lng: -75.698 })!;
    const stretch = signStretch(snap);
    const lngs = stretch.map(p => p[0]);
    const metresPerDegLng = 111_320 * Math.cos((LAT * Math.PI) / 180);
    const length = (Math.max(...lngs) - Math.min(...lngs)) * metresPerDegLng;
    expect(length).toBeGreaterThan(58);
    expect(length).toBeLessThan(62);
    stretch.forEach(([, lat]) => expect(lat).toBeCloseTo(LAT, 5));
  });

  it('stops at the end of the street', () => {
    const snap = snapToStreet(street, { lat: LAT, lng: -75.6961 })!;
    const lngs = signStretch(snap).map(p => p[0]);
    expect(Math.max(...lngs)).toBeLessThanOrEqual(-75.696);
  });
});

describe('signReportFeatures', () => {
  const base: SignReport = {
    id: 'a', userId: 'u', lat: LAT, lng: -75.699, side: 'right', road: 'Bank St', city: 'Ottawa',
    rule: 'noParking', hours: null, note: '', stretch: [[-75.6993, LAT], [-75.6987, LAT]],
    createdAt: new Date('2026-11-01T10:00:00Z'),
  };

  it('colours the curb on the photographed side', () => {
    const [f] = signReportFeatures([base]);
    expect(f.properties).toMatchObject({ kind: 'noParking', basis: 'ambassador', curb: 1, road: 'Bank St' });
    expect(signReportFeatures([{ ...base, side: 'left' }])[0].properties?.curb).toBe(-1);
  });

  it('keeps only the newest report for the same curb', () => {
    const newer = { ...base, id: 'b', rule: 'timeLimit' as const, hours: 2, createdAt: new Date('2026-11-05T10:00:00Z') };
    const features = signReportFeatures([base, newer]);
    expect(features).toHaveLength(1);
    expect(features[0].properties).toMatchObject({ kind: 'street', maxstay: '2 h', reportId: 'b' });
  });

  it('keeps both sides of the street', () => {
    expect(signReportFeatures([base, { ...base, id: 'c', side: 'left' }])).toHaveLength(2);
  });
});

describe('rules and levels', () => {
  it('maps sign rules to map colours', () => {
    expect(ruleToKind('free')).toBe('street');
    expect(ruleToKind('timeLimit')).toBe('street');
    expect(ruleToKind('paid')).toBe('paid');
    expect(ruleToKind('permit')).toBe('permit');
    expect(ruleToKind('noStopping')).toBe('noParking');
  });

  it('levels up with more signs', () => {
    expect(ambassadorLevel(0)).toEqual({ level: 0, next: 1 });
    expect(ambassadorLevel(3)).toEqual({ level: 1, next: 15 });
    expect(ambassadorLevel(20)).toEqual({ level: 2, next: 50 });
    expect(ambassadorLevel(80)).toEqual({ level: 3, next: null });
  });
});
