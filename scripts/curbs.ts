/**
 * Street-side parking from OpenStreetMap curb tags. Mappers record each side of
 * a street separately (`parking:left=no`, `parking:right=lane`, …), which is
 * far closer to the posted signs than any city-wide default, so these lines
 * override the "unsigned street" default wherever they exist.
 *
 * Both tagging schemes are read:
 *   current:  parking:<side>=lane|street_side|on_kerb|half_on_kerb|shoulder|no|separate
 *             parking:<side>:restriction=no_parking|no_stopping|loading_only|…
 *             parking:<side>:maxstay=2 h, parking:<side>:fee=yes
 *   legacy:   parking:lane:<side>=parallel|diagonal|perpendicular|no_parking|no_stopping|fire_lane|no
 *             parking:condition:<side>=free|ticket|no_parking|residents|…
 *             parking:condition:<side>:maxstay=1 h
 * `both` applies to left and right unless a side is tagged on its own.
 */

export type CurbStatus = 'free' | 'paid' | 'no' | 'unknown';

export interface CurbSide {
  status: CurbStatus;
  /** Posted limit as mapped, e.g. "2 h" */
  maxstay?: string;
}

export interface CurbSides {
  left: CurbSide;
  right: CurbSide;
}

const PARKING_YES = new Set([
  'lane', 'street_side', 'on_kerb', 'half_on_kerb', 'shoulder', 'yes',
  'parallel', 'diagonal', 'perpendicular', 'marked', 'on_street', 'inline',
]);
const PARKING_NO = new Set(['no', 'no_parking', 'no_stopping', 'fire_lane', 'none']);
const RESTRICTION_NO = new Set([
  'no_parking', 'no_stopping', 'no_standing', 'loading_only', 'charging_only', 'fire_lane',
]);
const CONDITION_NO = new Set(['no_parking', 'no_stopping', 'no_standing', 'loading', 'fire_lane']);
const CONDITION_PAID = new Set(['ticket', 'fee', 'paid', 'meter']);
/** Reserved for someone else: not a place a visitor can use */
const CONDITION_PRIVATE = new Set(['residents', 'customers', 'private', 'disabled', 'permit']);

function sideTag(tags: Record<string, string>, base: string, side: 'left' | 'right', suffix = ''): string | undefined {
  return tags[`${base}:${side}${suffix}`] ?? tags[`${base}:both${suffix}`];
}

export function parseCurbSide(tags: Record<string, string>, side: 'left' | 'right'): CurbSide {
  const current = sideTag(tags, 'parking', side);
  const legacy = sideTag(tags, 'parking:lane', side);
  const restriction = sideTag(tags, 'parking', side, ':restriction');
  const condition = sideTag(tags, 'parking:condition', side);
  const fee = sideTag(tags, 'parking', side, ':fee');
  const access = sideTag(tags, 'parking', side, ':access');
  const maxstay = sideTag(tags, 'parking', side, ':maxstay')
    ?? sideTag(tags, 'parking:condition', side, ':maxstay');

  const value = current ?? legacy;
  if (!value || value === 'separate') return { status: 'unknown' };
  if (PARKING_NO.has(value)) return { status: 'no' };
  if (!PARKING_YES.has(value)) return { status: 'unknown' };

  // Parking exists on this side; work out whether a visitor may use it for free
  if (restriction && RESTRICTION_NO.has(restriction)) return { status: 'no' };
  if (condition && CONDITION_NO.has(condition)) return { status: 'no' };
  if (access && ['private', 'no', 'customers'].includes(access)) return { status: 'no' };
  if (condition && CONDITION_PRIVATE.has(condition)) return { status: 'no' };
  if (fee === 'yes' || (condition && CONDITION_PAID.has(condition))) return { status: 'paid', maxstay };
  return maxstay ? { status: 'free', maxstay } : { status: 'free' };
}

export function parseCurbSides(tags: Record<string, string>): CurbSides {
  return { left: parseCurbSide(tags, 'left'), right: parseCurbSide(tags, 'right') };
}

export interface OsmWay {
  id: number;
  tags?: Record<string, string>;
  geometry?: { lat: number; lon: number }[];
}

/** Mapbox `line-offset` is positive to the right of the drawing direction. */
const SIDE_OFFSET: Record<'left' | 'right', number> = { left: -1, right: 1 };

/**
 * Map features for one OSM way: one line per side that has an answer, drawn on
 * that curb. Paid sides are left to the city's meter layer (Ottawa) because it
 * carries rates and hours; `unknown` sides draw nothing.
 */
export function curbFeatures(way: OsmWay, city: string): GeoJSON.Feature[] {
  if (!way.tags || !way.geometry || way.geometry.length < 2) return [];
  const coordinates = way.geometry.map(p => [Number(p.lon.toFixed(5)), Number(p.lat.toFixed(5))]);
  const road = way.tags.name ?? undefined;
  const sides = parseCurbSides(way.tags);
  const features: GeoJSON.Feature[] = [];
  for (const side of ['left', 'right'] as const) {
    const { status, maxstay } = sides[side];
    if (status !== 'free' && status !== 'no') continue;
    const properties: Record<string, string | number> = {
      kind: status === 'free' ? 'street' : 'noParking',
      basis: 'osm',
      curb: SIDE_OFFSET[side],
      city,
    };
    if (road) properties.road = road;
    if (maxstay) properties.maxstay = maxstay;
    features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates }, properties });
  }
  return features;
}

/** True when the way gives an answer for at least one side. */
export function hasCurbAnswer(way: OsmWay): boolean {
  if (!way.tags) return false;
  const sides = parseCurbSides(way.tags);
  return sides.left.status !== 'unknown' || sides.right.status !== 'unknown';
}
