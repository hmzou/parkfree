import { setLocale } from '../app/_i18n';
import { buildStreetRecord, recordLines, recordText } from '../app/_services/parkingRecord';
import { ParkingSession } from '../app/_types';

const start = new Date(2026, 5, 10, 10, 0);

function session(endMinutes: number | null): ParkingSession {
  const record = buildStreetRecord(
    { kind: 'street', city: 'Ottawa', basis: 'default', road: 'GLEBE AVE' },
    'free until 1:00 p.m.',
    { positionSource: 'gps', accuracyMeters: 8.4, dataAsOf: '2026-11-06T12:00:00.000Z' },
    start,
  );
  return {
    id: 'abc123',
    spotId: 'street_45.40000_-75.70000',
    userId: 'u1',
    lat: 45.4,
    lng: -75.7,
    startTime: start,
    endTime: endMinutes === null ? null : new Date(start.getTime() + endMinutes * 60_000),
    active: endMinutes === null,
    record,
  };
}

describe('parking record', () => {
  afterEach(() => setLocale('en'));

  it('snapshots the street, rule and limit', () => {
    const { record } = session(null);
    expect(record).toMatchObject({
      road: 'Glebe Ave',
      city: 'Ottawa',
      basis: 'default',
      positionSource: 'gps',
      accuracyMeters: 8.4,
      leaveBy: new Date(2026, 5, 10, 13, 0).toISOString(),
    });
  });

  it('says whether the car left before the limit', () => {
    const lines = (s: ParkingSession) => Object.fromEntries(recordLines(s).map(l => [l.label, l.value]));
    expect(lines(session(120))['Left before the limit']).toBe('Yes');
    expect(lines(session(200))['Left before the limit']).toBe('No');
    expect(lines(session(null))['Left before the limit']).toBeUndefined();
  });

  it('is written in the chosen language', () => {
    setLocale('fr');
    const text = recordText(session(60));
    expect(text).toContain('Preuve de stationnement');
    expect(text).toContain('GPS du téléphone');
    expect(text).toContain('abc123');
  });
});
