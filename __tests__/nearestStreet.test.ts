import { nearestFreeStreet } from '../app/_services/nearestStreet';

const line = (kind: string, road: string, coords: number[][]): GeoJSON.Feature => ({
  type: 'Feature',
  geometry: { type: 'LineString', coordinates: coords },
  properties: { kind, road },
});

// Two east-west streets ~110 m and ~330 m north of the origin, plus paid and
// no-parking lines right on top of it that must be ignored.
const origin = { latitude: 45.4, longitude: -75.7 };
const overlays: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    line('paid', 'PAID ST', [[-75.701, 45.4], [-75.699, 45.4]]),
    line('noParking', 'HWY', [[-75.701, 45.4001], [-75.699, 45.4001]]),
    line('street', 'NEAR ST', [[-75.702, 45.401], [-75.698, 45.401]]),
    line('permit', 'FAR ST', [[-75.702, 45.403], [-75.698, 45.403]]),
  ],
};

describe('nearestFreeStreet', () => {
  it('picks the closest free street and measures to the line, not its ends', () => {
    const hit = nearestFreeStreet(overlays, origin)!;
    expect(hit.road).toBe('Near St');
    expect(hit.distanceMeters).toBeGreaterThan(105);
    expect(hit.distanceMeters).toBeLessThan(115);
    // Closest point is straight north of the origin
    expect(hit.lng).toBeCloseTo(-75.7, 5);
    expect(hit.lat).toBeCloseTo(45.401, 5);
  });

  it('ignores paid and no-parking lines', () => {
    const onlyBad: GeoJSON.FeatureCollection = { ...overlays, features: overlays.features.slice(0, 2) };
    expect(nearestFreeStreet(onlyBad, origin)).toBeNull();
  });

  it('returns null when nothing is within walking range', () => {
    expect(nearestFreeStreet(overlays, { latitude: 45.5, longitude: -75.7 })).toBeNull();
  });
});

describe('prettyRoad', () => {
  const { prettyRoad } = require('../app/_services/nearestStreet');
  it('title-cases city road names', () => {
    expect(prettyRoad('GLEBE AVE')).toBe('Glebe Ave');
    expect(prettyRoad("O'CONNOR ST")).toBe("O'Connor St");
    expect(prettyRoad('ST. PATRICK ST')).toBe('St. Patrick St');
    expect(prettyRoad('')).toBeNull();
  });
});

describe('prettyRoad possessives', () => {
  const { prettyRoad } = require('../app/_services/nearestStreet');
  it("keeps a possessive 's lower-case", () => {
    expect(prettyRoad("QUEEN'S WAY")).toBe("Queen's Way");
  });
});
