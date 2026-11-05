import { ParkingSpot, SpotType, City } from '../_types';

const OVERPASS_ENDPOINTS = [
  // mail.ru has been the mirror that actually answers from this network
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];
// Slightly above the [timeout:25] in the query, so a busy server can still answer
const ENDPOINT_TIMEOUT_MS = 30_000;

// Combined Ottawa + Gatineau service area
export const REGION_LAT_MIN = 45.2520;
export const REGION_LAT_MAX = 45.5505;
export const REGION_LNG_MIN = -76.3548;
export const REGION_LNG_MAX = -75.2467;

// Gatineau's west (Aylmer) and east (Masson-Angers) limits along the river
const GATINEAU_LNG_MIN = -76.0356;
const GATINEAU_LNG_MAX = -75.40;

/**
 * Approximate Ottawa River centreline as [lng, lat], west to east. The river is
 * the Ontario/Quebec border, so it separates Ottawa (south) from Gatineau
 * (north). Accurate to a few hundred metres, which is enough for a label.
 */
const OTTAWA_RIVER: [number, number][] = [
  [-76.36, 45.44],
  [-76.24, 45.48],
  [-76.10, 45.51],
  [-76.03, 45.475],
  [-75.95, 45.42],
  [-75.85, 45.375],
  [-75.80, 45.37],
  [-75.755, 45.395],
  [-75.72, 45.418],
  [-75.705, 45.43],
  [-75.69, 45.442],
  [-75.67, 45.462],
  [-75.65, 45.468],
  [-75.61, 45.478],
  [-75.50, 45.51],
  [-75.40, 45.53],
  [-75.24, 45.56],
];

function riverLatAt(lng: number): number {
  if (lng <= OTTAWA_RIVER[0][0]) return OTTAWA_RIVER[0][1];
  for (let i = 1; i < OTTAWA_RIVER.length; i++) {
    const [lng1, lat1] = OTTAWA_RIVER[i];
    if (lng <= lng1) {
      const [lng0, lat0] = OTTAWA_RIVER[i - 1];
      return lat0 + ((lng - lng0) / (lng1 - lng0)) * (lat1 - lat0);
    }
  }
  return OTTAWA_RIVER[OTTAWA_RIVER.length - 1][1];
}

export function detectCity(lat: number, lng: number): City {
  if (
    lat < REGION_LAT_MIN || lat > REGION_LAT_MAX ||
    lng < REGION_LNG_MIN || lng > REGION_LNG_MAX
  ) {
    return 'Unknown';
  }
  if (lat <= riverLatAt(lng)) return 'Ottawa';
  // North shore outside Gatineau is other Quebec municipalities
  return lng >= GATINEAU_LNG_MIN && lng <= GATINEAU_LNG_MAX ? 'Gatineau' : 'Unknown';
}

const STREET_PARKING = new Set(['street_side', 'lane', 'on_street', 'layby']);

function parseSpotType(tags: Record<string, string>): SpotType {
  const parking = tags['parking'] ?? '';
  if (parking === 'multi-storey' || parking === 'underground' || parking === 'rooftop') return 'garage';
  if (STREET_PARKING.has(parking)) return 'street';
  // amenity=parking without a parking=* tag is almost always a surface lot
  return 'lot';
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

export interface OverpassElement {
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

export interface BBox {
  south: number;
  west: number;
  north: number;
  east: number;
}

export const REGION_BBOX: BBox = {
  south: REGION_LAT_MIN,
  west: REGION_LNG_MIN,
  north: REGION_LAT_MAX,
  east: REGION_LNG_MAX,
};

/** Same filters as buildQuery, over a bounding box (default: the whole region). */
export function buildRegionQuery(bbox: BBox = REGION_BBOX): string {
  const box = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
  return `
[out:json][timeout:90];
(
  nwr["amenity"="parking"]["fee"="no"](${box});
  nwr["amenity"="parking"][!"fee"](${box});
);
out center tags;
`.trim();
}

export async function fetchFreeParkingSpots(
  lat: number,
  lng: number,
  radiusMeters = 1000,
): Promise<ParkingSpot[]> {
  return parseOverpassElements(await runOverpassQuery(buildQuery(lat, lng, radiusMeters)));
}

// Start with the mirror that answered last, so one dead mirror does not cost
// a full timeout on every request.
let preferredEndpoint = 0;

export async function runOverpassQuery(
  query: string,
  timeoutMs = ENDPOINT_TIMEOUT_MS,
): Promise<OverpassElement[]> {
  const body = `data=${encodeURIComponent(query)}`;

  let lastError: Error | null = null;
  let elements: OverpassElement[] = [];

  for (let i = 0; i < OVERPASS_ENDPOINTS.length; i++) {
    const endpointIndex = (preferredEndpoint + i) % OVERPASS_ENDPOINTS.length;
    const endpoint = OVERPASS_ENDPOINTS[endpointIndex];
    // An overloaded mirror can hold the connection open for a minute before
    // answering 504, so give up early and try the next one.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        // Overpass rejects requests without a descriptive User-Agent (HTTP 406);
        // browsers ignore this header and send their own, which is accepted.
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'ParkFree/1.0 (https://github.com/hmzou/parkfree)',
        },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        lastError = new Error(`Overpass API error: ${response.status}`);
        continue;
      }

      const json = await response.json();
      elements = json.elements ?? [];
      lastError = null;
      preferredEndpoint = endpointIndex;
      break;
    } catch (err) {
      lastError = controller.signal.aborted
        ? new Error('Overpass request timed out')
        : err instanceof Error ? err : new Error('Overpass request failed');
    } finally {
      clearTimeout(timer);
    }
  }

  if (lastError) throw lastError;

  return elements;
}

const RESTRICTED_ACCESS = new Set(['private', 'customers', 'permit', 'delivery', 'no']);

/** Turn raw Overpass elements into free (or possibly free) Ottawa/Gatineau spots. */
export function parseOverpassElements(elements: OverpassElement[]): ParkingSpot[] {
  const spots: ParkingSpot[] = [];
  const seen = new Set<string>();

  for (const el of elements) {
    const elLat = el.lat ?? el.center?.lat;
    const elLng = el.lon ?? el.center?.lon;

    if (elLat == null || elLng == null) continue;

    const tags = el.tags ?? {};
    const fee = tags['fee'];

    // Any fee value other than "no" (e.g. "yes", "Mo-Fr 08:00-18:00") means paid at least sometimes
    if (fee !== undefined && fee !== 'no') continue;
    if (RESTRICTED_ACCESS.has(tags['access'] ?? '')) continue;

    const type = parseSpotType(tags);
    const feeUnknown = fee === undefined || tags['fee:conditional'] !== undefined;
    // Untagged garages in Ottawa/Gatineau are nearly always paid
    if (fee === undefined && type === 'garage') continue;

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
      type,
      feeRequired: false,
      feeUnknown,
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
 * Return the N nearest free (non-occupied, not banned right now) spots sorted by distance.
 */
export function nearestFreeSpots(
  spots: ParkingSpot[],
  lat: number,
  lng: number,
  n = 3,
  excludeId?: string,
): ParkingSpot[] {
  return spots
    .filter(s => !s.occupied && s.rule?.level !== 'banned' && s.id !== excludeId)
    .map(s => ({ spot: s, dist: haversineMeters(lat, lng, s.lat, s.lng) }))
    .sort((a, b) => a.dist - b.dist)
    .slice(0, n)
    .map(x => x.spot);
}
