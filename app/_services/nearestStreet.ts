import { Coordinate } from '../_types';
import { streetVerdict } from './parkingRules';

/** City data spells roads in capitals ("GLEBE AVE", "O'CONNOR ST"); show "Glebe Ave". */
export function prettyRoad(name: unknown): string | null {
  if (typeof name !== 'string' || !name.trim()) return null;
  return name
    .toLowerCase()
    .replace(/(^|[\s\-.(/])([a-zà-ÿ])/g, (_, sep: string, ch: string) => sep + ch.toUpperCase())
    // Irish surnames only ("O'Connor"); a possessive "'s" stays lower-case
    .replace(/\bO['’]([a-z])/g, (_, ch: string) => `O'${ch.toUpperCase()}`);
}

/** Street-line kinds a driver can park on for free (time limits still apply). */
const FREE_KINDS = new Set(['street', 'permit', 'free15']);

export interface NearestStreet {
  kind: string;
  road: string | null;
  /** Closest point on the street to the query point */
  lat: number;
  lng: number;
  distanceMeters: number;
  properties: Record<string, unknown>;
}

/** Ignore streets farther than this; a "nearest" 3 km away isn't useful on foot. */
const MAX_DISTANCE_M = 1500;

function lineParts(geometry: GeoJSON.Geometry): number[][][] {
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

/**
 * The free street segment closest to `from`, measured to the line itself (not
 * its endpoints), within MAX_DISTANCE_M. Uses a flat projection around `from`,
 * accurate to well under a metre at street scale.
 */
export function nearestFreeStreet(
  overlays: GeoJSON.FeatureCollection,
  from: Coordinate,
  now: Date = new Date(),
): NearestStreet | null {
  const kx = 111_320 * Math.cos((from.latitude * Math.PI) / 180);
  const ky = 110_540;
  // Cheap reject box: anything whose vertices are all outside it is too far
  const dLat = MAX_DISTANCE_M / ky;
  const dLng = MAX_DISTANCE_M / kx;

  let best: NearestStreet | null = null;
  for (const feature of overlays.features) {
    const kind = feature.properties?.kind as string | undefined;
    if (!kind || !FREE_KINDS.has(kind) || !feature.geometry) continue;
    // Gatineau's overnight winter ban: free streets that are closed right now don't count
    if (kind === 'street' && feature.properties?.city === 'Gatineau'
      && streetVerdict(feature.properties, now).level === 'banned') continue;
    for (const line of lineParts(feature.geometry)) {
      if (!line.some(([lng, lat]) => Math.abs(lat - from.latitude) < dLat && Math.abs(lng - from.longitude) < dLng)) {
        continue;
      }
      for (let i = 1; i < line.length; i++) {
        const ax = (line[i - 1][0] - from.longitude) * kx;
        const ay = (line[i - 1][1] - from.latitude) * ky;
        const bx = (line[i][0] - from.longitude) * kx;
        const by = (line[i][1] - from.latitude) * ky;
        const dx = bx - ax;
        const dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
        const px = ax + t * dx;
        const py = ay + t * dy;
        const d = Math.hypot(px, py);
        if (d <= MAX_DISTANCE_M && (!best || d < best.distanceMeters)) {
          best = {
            kind,
            road: prettyRoad(feature.properties?.road),
            lat: from.latitude + py / ky,
            lng: from.longitude + px / kx,
            distanceMeters: d,
            properties: { ...feature.properties },
          };
        }
      }
    }
  }
  return best;
}
