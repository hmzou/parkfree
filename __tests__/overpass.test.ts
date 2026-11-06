import {
  detectCity,
  fetchFreeParkingSpots,
  nearestFreeSpots,
  parseOverpassElements,
  OverpassElement,
} from '../app/_services/overpass';
import { ParkingSpot } from '../app/_types';

// Downtown Ottawa and downtown Gatineau (Hull)
const OTTAWA = { lat: 45.4215, lon: -75.6972 };
const GATINEAU = { lat: 45.4765, lon: -75.7013 };

function node(id: number, tags: Record<string, string>, at = OTTAWA): OverpassElement {
  return { type: 'node', id, lat: at.lat, lon: at.lon + id * 0.001, tags: { amenity: 'parking', ...tags } };
}

describe('parseOverpassElements', () => {
  it('keeps fee=no spots as confirmed free', () => {
    const [spot] = parseOverpassElements([node(1, { fee: 'no' })]);
    expect(spot.id).toBe('osm_node_1');
    expect(spot.feeRequired).toBe(false);
    expect(spot.feeUnknown).toBe(false);
  });

  it('flags spots with no fee tag as unconfirmed', () => {
    const [spot] = parseOverpassElements([node(1, { parking: 'surface' })]);
    expect(spot.type).toBe('lot');
    expect(spot.feeUnknown).toBe(true);
  });

  it('flags fee=no spots with a conditional fee as unconfirmed', () => {
    const [spot] = parseOverpassElements([
      node(1, { fee: 'no', 'fee:conditional': 'yes @ (Mo-Fr 08:00-18:00)' }),
    ]);
    expect(spot.feeUnknown).toBe(true);
  });

  it('drops paid spots, including time-based fee values', () => {
    expect(parseOverpassElements([
      node(1, { fee: 'yes' }),
      node(2, { fee: 'Mo-Fr 08:00-18:00' }),
    ])).toHaveLength(0);
  });

  it('drops untagged garages but keeps garages tagged free', () => {
    const spots = parseOverpassElements([
      node(1, { parking: 'multi-storey' }),
      node(2, { parking: 'underground', fee: 'no' }),
    ]);
    expect(spots.map(s => s.id)).toEqual(['osm_node_2']);
    expect(spots[0].type).toBe('garage');
  });

  it('drops restricted access', () => {
    const restricted = ['private', 'customers', 'permit', 'delivery', 'no'];
    expect(parseOverpassElements(
      restricted.map((access, i) => node(i + 1, { fee: 'no', access })),
    )).toHaveLength(0);
  });

  it('uses the way centre and drops elements without coordinates', () => {
    const spots = parseOverpassElements([
      { type: 'way', id: 7, center: { lat: OTTAWA.lat, lon: OTTAWA.lon }, tags: { amenity: 'parking', fee: 'no' } },
      { type: 'way', id: 8, tags: { amenity: 'parking', fee: 'no' } },
    ]);
    expect(spots.map(s => s.id)).toEqual(['osm_way_7']);
  });

  it('deduplicates spots at the same coordinates', () => {
    const a: OverpassElement = { type: 'node', id: 1, ...OTTAWA, tags: { amenity: 'parking', fee: 'no' } };
    const b: OverpassElement = { ...a, id: 2 };
    expect(parseOverpassElements([a, b])).toHaveLength(1);
  });

  it('drops spots outside Ottawa and Gatineau', () => {
    const toronto = { lat: 43.6532, lon: -79.3832 };
    expect(parseOverpassElements([node(1, { fee: 'no' }, toronto)])).toHaveLength(0);
  });

  it('treats untyped parking as a lot and street_side as street', () => {
    const spots = parseOverpassElements([
      node(1, { fee: 'no' }),
      node(2, { fee: 'no', parking: 'street_side' }),
      node(3, { fee: 'no', parking: 'lane' }),
    ]);
    expect(spots.map(s => s.type)).toEqual(['lot', 'street', 'street']);
  });

  it('reads time limits and seasonal bans', () => {
    const [spot] = parseOverpassElements([
      node(1, { fee: 'no', maxstay: '2 hours', 'parking:condition:winter': 'no_parking' }),
    ]);
    expect(spot.timeRestrictions).toBe('Max 2 hours');
    expect(spot.seasonalBan).toBe(true);
  });
});

describe('fetchFreeParkingSpots', () => {
  const realFetch = global.fetch;
  // Fresh module per test: the service remembers which mirror answered last
  let fetchSpots: typeof fetchFreeParkingSpots;
  beforeEach(() => {
    jest.isolateModules(() => {
      fetchSpots = require('../app/_services/overpass').fetchFreeParkingSpots;
    });
  });
  afterEach(() => { global.fetch = realFetch; });

  const okResponse = (elements: OverpassElement[]) =>
    ({ ok: true, status: 200, json: async () => ({ elements }) }) as Response;

  it('falls back to the next mirror when the first is unreachable', async () => {
    const fetchMock = jest.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(okResponse([node(1, { fee: 'no' })]));
    global.fetch = fetchMock;

    const spots = await fetchSpots(OTTAWA.lat, OTTAWA.lon);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(spots.map(s => s.id)).toEqual(['osm_node_1']);
  });

  it('starts the next request at the mirror that answered', async () => {
    const fetchMock = jest.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValue(okResponse([]));
    global.fetch = fetchMock;

    await fetchSpots(OTTAWA.lat, OTTAWA.lon);
    await fetchSpots(OTTAWA.lat, OTTAWA.lon);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[2][0]).toBe(fetchMock.mock.calls[1][0]);
  });

  it('falls back when the first mirror returns an HTTP error', async () => {
    const fetchMock = jest.fn()
      .mockResolvedValueOnce({ ok: false, status: 504 } as Response)
      .mockResolvedValueOnce(okResponse([]));
    global.fetch = fetchMock;

    await expect(fetchSpots(OTTAWA.lat, OTTAWA.lon)).resolves.toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws the last error when every mirror fails', async () => {
    global.fetch = jest.fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce({ ok: false, status: 504 } as Response);

    await expect(fetchSpots(OTTAWA.lat, OTTAWA.lon)).rejects.toThrow('Overpass API error: 504');
  });
});

describe('nearestFreeSpots', () => {
  const origin = parseOverpassElements([node(1, { fee: 'no' })])[0];

  function at(id: string, ruleLevel?: 'banned'): ParkingSpot {
    return { ...origin, id, rule: ruleLevel
      ? { level: ruleLevel, leaveBy: null, allowedFrom: null, notes: [] }
      : undefined };
  }

  it('skips occupied and currently banned spots', () => {
    const spots = [
      { ...at('busy'), occupied: true },
      at('banned', 'banned'),
      at('open'),
    ];
    expect(nearestFreeSpots(spots, origin.lat, origin.lng, 3).map(s => s.id)).toEqual(['open']);
  });
});

describe('detectCity', () => {
  it('labels Ottawa and Gatineau', () => {
    expect(detectCity(OTTAWA.lat, OTTAWA.lon)).toBe('Ottawa');
    expect(detectCity(GATINEAU.lat, GATINEAU.lon)).toBe('Gatineau');
  });

  // Downtown Ottawa sits inside a naive Gatineau bounding box, so these guard
  // against labelling by box overlap instead of by river side.
  it.each([
    ['Parliament Hill', 45.4236, -75.7009, 'Ottawa'],
    ['ByWard Market', 45.4289, -75.6920, 'Ottawa'],
    ['Rockcliffe Park', 45.4520, -75.6800, 'Ottawa'],
    ['Orléans', 45.4700, -75.5200, 'Ottawa'],
    ['Kanata', 45.3100, -75.9100, 'Ottawa'],
    ['Aylmer', 45.3960, -75.8450, 'Gatineau'],
    ['Gatineau sector', 45.4900, -75.6500, 'Gatineau'],
    ['Canadian Museum of History', 45.4300, -75.7090, 'Gatineau'],
  ])('%s is in %s', (_name, lat, lng, city) => {
    expect(detectCity(lat, lng)).toBe(city);
  });

  it('returns Unknown elsewhere', () => {
    expect(detectCity(43.6532, -79.3832)).toBe('Unknown');
  });
});
