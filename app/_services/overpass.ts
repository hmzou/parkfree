import { ParkingSpot, SpotType, City } from '../_types';

// Main instance first, then public mirrors (wiki.openstreetmap.org/wiki/Overpass_API).
// The main instance rate-limits and sometimes refuses connections outright; a single
// endpoint made spot loading fail entirely whenever it was busy.
const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

// Overpass rejects requests without a descriptive User-Agent (HTTP 406), and the
// defaults sent by React Native's networking stack don't qualify. Browsers ignore
// this header and send their own, which is accepted.
const OVERPASS_USER_AGENT = 'ParkFree/1.0 (https://github.com/hmzou/parkfree)';

// The query's server-side timeout is 25 s; a busy server can still hold the
// connection open indefinitely, which would leave every later refresh queued.
const REQUEST_TIMEOUT_MS = 35_000;

// Ottawa + Gatineau bounding boxes
const OTTAWA_BBOX = '45.2520,-76.3548,45.5376,-75.2467';
const GATINEAU_BBOX = '45.3876,-76.0356,45.5505,-75.5835';

// Ottawa rough bounds for city labeling
const OTTAWA_LAT_MIN = 45.2520;
const OTTAWA_LAT_MAX = 45.5376;
const OTTAWA_LNG_MIN = -76.3548;
const OTTAWA_LNG_MAX = -75.2467;

// Gatineau rough bounds
const GATINEAU_LAT_MIN = 45.3876;
const GATINEAU_LAT_MAX = 45.5505;
const GATINEAU_LNG_MIN = -76.0356;
const GATINEAU_LNG_MAX = -75.5835;

// The Ottawa River separates the two cities, but the Gatineau bbox overlaps
// downtown Ottawa, so a bbox check alone labels central Ottawa as Gatineau.
// Rough south-bank polyline, west → east, as [lng, lat]; north of it is Gatineau.
const OTTAWA_RIVER: [number, number][] = [
  [-76.05, 45.47],
  [-75.95, 45.42],
  [-75.85, 45.375],
  [-75.78, 45.385],
  [-75.73, 45.41],
  [-75.70, 45.43],
  [-75.67, 45.445],
  [-75.60, 45.47],
  [-75.50, 45.50],
  [-75.40, 45.54],
];

function riverLatAt(lng: number): number {
  if (lng <= OTTAWA_RIVER[0][0]) return OTTAWA_RIVER[0][1];
  for (let i = 1; i < OTTAWA_RIVER.length; i++) {
    const [x1, y1] = OTTAWA_RIVER[i];
    if (lng <= x1) {
      const [x0, y0] = OTTAWA_RIVER[i - 1];
      return y0 + ((lng - x0) / (x1 - x0)) * (y1 - y0);
    }
  }
  return OTTAWA_RIVER[OTTAWA_RIVER.length - 1][1];
}

export function detectCity(lat: number, lng: number): City {
  if (
    lat >= GATINEAU_LAT_MIN && lat <= GATINEAU_LAT_MAX &&
    lng >= GATINEAU_LNG_MIN && lng <= GATINEAU_LNG_MAX &&
    lat > riverLatAt(lng)
  ) {
    return 'Gatineau';
  }
  if (
    lat >= OTTAWA_LAT_MIN && lat <= OTTAWA_LAT_MAX &&
    lng >= OTTAWA_LNG_MIN && lng <= OTTAWA_LNG_MAX
  ) {
    return 'Ottawa';
  }
  return 'Unknown';
}

function parseSpotType(tags: Record<string, string>): SpotType {
  const parking = tags['parking'] ?? tags['amenity'] ?? '';
  if (parking === 'multi-storey' || parking === 'underground') return 'garage';
  if (parking === 'surface' || parking === 'parking_lot') return 'lot';
  return 'street';
}

function hasSeasonalBan(tags: Record<string, string>): boolean {
  // Check for seasonal/winter parking bans in OSM tags
  const keys = Object.keys(tags);
  for (const key of keys) {
    if (
      key.startsWith('parking:condition') &&
      (tags[key] === 'no_parking' || tags[key] === 'no_stopping')
    ) {
      return true;
    }
  }
  // Also check maxstay with conditional
  if (tags['maxstay:conditional'] || tags['access:conditional']) return true;
  if (tags['parking:condition:winter'] === 'no_parking') return true;
  return false;
}

function extractTimeRestrictions(tags: Record<string, string>): string | null {
  const maxstay = tags['maxstay'];
  const restriction = tags['restriction'] ?? tags['parking:condition:default'];
  if (maxstay) return `Max ${maxstay}`;
  if (restriction && restriction !== 'free') return restriction;
  return null;
}

interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/**
 * Build Overpass QL query for free parking in Ottawa + Gatineau
 * within ~1km radius of the given coordinate.
 */
function buildQuery(lat: number, lng: number, radiusMeters = 1000): string {
  return `
[out:json][timeout:25];
(
  node["amenity"="parking"]["fee"="no"](around:${radiusMeters},${lat},${lng});
  way["amenity"="parking"]["fee"="no"](around:${radiusMeters},${lat},${lng});
  node["amenity"="parking"][!"fee"](around:${radiusMeters},${lat},${lng});
  way["amenity"="parking"][!"fee"](around:${radiusMeters},${lat},${lng});
  node["amenity"="parking"]["access"="yes"](around:${radiusMeters},${lat},${lng});
  way["amenity"="parking"]["access"="yes"](around:${radiusMeters},${lat},${lng});
);
out center tags;
`.trim();
}

async function postQuery(endpoint: string, query: string): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(endpoint, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': OVERPASS_USER_AGENT,
      },
      body: `data=${encodeURIComponent(query)}`,
    });
  } catch (err) {
    throw controller.signal.aborted ? new Error('Overpass API timed out') : err;
  } finally {
    clearTimeout(timeout);
  }
}

export async function fetchFreeParkingSpots(
  lat: number,
  lng: number,
  radiusMeters = 1000,
): Promise<ParkingSpot[]> {
  const query = buildQuery(lat, lng, radiusMeters);

  let response: Response | null = null;
  let lastError: unknown = null;
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      response = await postQuery(endpoint, query);
      if (response.ok) break;
      lastError = new Error(`Overpass API error: ${response.status}`);
      // Only rate limiting / server trouble is worth retrying elsewhere
      if (response.status !== 429 && response.status < 500) break;
    } catch (err) {
      lastError = err;
    }
    response = null;
  }
  if (!response || !response.ok) throw lastError ?? new Error('Overpass API unavailable');

  const json = await response.json();
  const elements: OverpassElement[] = json.elements ?? [];

  const spots: ParkingSpot[] = [];
  const seen = new Set<string>();

  for (const el of elements) {
    const elLat = el.lat ?? el.center?.lat;
    const elLng = el.lon ?? el.center?.lon;

    if (elLat == null || elLng == null) continue;

    const tags = el.tags ?? {};

    // Skip paid parking
    if (tags['fee'] === 'yes') continue;
    if (tags['access'] === 'private' || tags['access'] === 'customers') continue;

    const key = `${elLat.toFixed(5)}_${elLng.toFixed(5)}`;
    if (seen.has(key)) continue;
    seen.add(key);

    const city = detectCity(elLat, elLng);
    // Only include Ottawa + Gatineau
    if (city === 'Unknown') continue;

    const spot: ParkingSpot = {
      id: `osm_${el.type}_${el.id}`,
      source: 'osm',
      lat: elLat,
      lng: elLng,
      type: parseSpotType(tags),
      feeRequired: false,
      timeRestrictions: extractTimeRestrictions(tags),
      seasonalBan: hasSeasonalBan(tags),
      occupied: false,
      occupiedSince: null,
      occupiedBy: null,
      city,
      verified: true,
    };

    spots.push(spot);
  }

  return spots;
}

/**
 * Calculate distance between two coordinates in metres (Haversine).
 */
export function haversineMeters(
  lat1: number, lng1: number,
  lat2: number, lng2: number,
): number {
  const R = 6_371_000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
    Math.cos((lat2 * Math.PI) / 180) *
    Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Return the N nearest free (non-occupied) spots sorted by distance.
 */
export function nearestFreeSpots(
  spots: ParkingSpot[],
  lat: number,
  lng: number,
  n = 3,
  excludeId?: string,
): ParkingSpot[] {
  return spots
    .filter(s => !s.occupied && s.id !== excludeId)
    .map(s => ({ spot: s, dist: haversineMeters(lat, lng, s.lat, s.lng) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, n)
    .map(x => x.spot);
}
