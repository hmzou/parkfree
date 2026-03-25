import { ParkingSpot, SpotType, City } from '../types';

const OVERPASS_ENDPOINT = 'https://overpass-api.de/api/interpreter';

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

function detectCity(lat: number, lng: number): City {
  if (
    lat >= GATINEAU_LAT_MIN && lat <= GATINEAU_LAT_MAX &&
    lng >= GATINEAU_LNG_MIN && lng <= GATINEAU_LNG_MAX
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

export async function fetchFreeParkingSpots(
  lat: number,
  lng: number,
  radiusMeters = 1000,
): Promise<ParkingSpot[]> {
  const query = buildQuery(lat, lng, radiusMeters);

  const response = await fetch(OVERPASS_ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!response.ok) {
    throw new Error(`Overpass API error: ${response.status}`);
  }

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
