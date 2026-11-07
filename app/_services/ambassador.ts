/**
 * Ambassadors photograph parking signs. The photo, the GPS position and the
 * compass heading tell us which street and which side of it the sign governs;
 * the rule they pick colours that stretch of curb on the map for everyone.
 */
import {
  addDoc,
  collection,
  doc,
  getCountFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import { prettyRoad } from './nearestStreet';

export type SignRule = 'free' | 'timeLimit' | 'paid' | 'permit' | 'noParking' | 'noStopping';
export type CurbSide = 'left' | 'right';

export const SIGN_RULES: SignRule[] = ['free', 'timeLimit', 'paid', 'permit', 'noParking', 'noStopping'];
/** Rules that need a number of hours */
export const RULES_WITH_HOURS: SignRule[] = ['timeLimit', 'paid'];

/** How far either way along the street one sign is taken to apply */
export const SIGN_REACH_METRES = 30;
/** A sign farther than this from every street can't be placed */
export const MAX_SNAP_METRES = 35;

interface Pt { lng: number; lat: number }

function lineParts(geometry: GeoJSON.Geometry | null | undefined): number[][][] {
  if (!geometry) return [];
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

/** Local flat projection in metres around `origin` (sub-metre accurate at street scale). */
function projector(origin: Pt) {
  const kx = 111_320 * Math.cos((origin.lat * Math.PI) / 180);
  const ky = 110_540;
  return {
    toXY: ([lng, lat]: number[]) => [(lng - origin.lng) * kx, (lat - origin.lat) * ky] as const,
    toLngLat: (x: number, y: number) => [origin.lng + x / kx, origin.lat + y / ky],
  };
}

export interface SnappedStreet {
  feature: GeoJSON.Feature;
  /** The line part the sign is on, in [lng, lat] */
  line: number[][];
  /** Segment index i: the sign projects between line[i] and line[i+1] */
  segment: number;
  /** 0..1 along that segment */
  t: number;
  distanceMeters: number;
  road: string | null;
}

/** The street line closest to `at`, within MAX_SNAP_METRES. Lots and points are ignored. */
export function snapToStreet(overlays: GeoJSON.FeatureCollection, at: Pt): SnappedStreet | null {
  const { toXY } = projector(at);
  const box = MAX_SNAP_METRES / 100_000;
  let best: SnappedStreet | null = null;
  for (const feature of overlays.features) {
    const kind = feature.properties?.kind;
    if (!kind || kind === 'cityLot' || kind === 'banAlternate') continue;
    for (const line of lineParts(feature.geometry)) {
      if (!line.some(([lng, lat]) => Math.abs(lat - at.lat) < box * 2 && Math.abs(lng - at.lng) < box * 3)) continue;
      for (let i = 0; i < line.length - 1; i++) {
        const [ax, ay] = toXY(line[i]);
        const [bx, by] = toXY(line[i + 1]);
        const dx = bx - ax, dy = by - ay;
        const len2 = dx * dx + dy * dy;
        const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
        const d = Math.hypot(ax + t * dx, ay + t * dy);
        if (d <= MAX_SNAP_METRES && (!best || d < best.distanceMeters)) {
          best = { feature, line, segment: i, t, distanceMeters: d, road: prettyRoad(feature.properties?.road) };
        }
      }
    }
  }
  return best;
}

/** Compass bearing (0 = north, clockwise) of the street at the snapped segment. */
export function streetBearing(snap: SnappedStreet): number {
  const a = snap.line[snap.segment];
  const b = snap.line[snap.segment + 1];
  const { toXY } = projector({ lng: a[0], lat: a[1] });
  const [bx, by] = toXY(b);
  return (Math.atan2(bx, by) * 180 / Math.PI + 360) % 360;
}

/** Which side of the line's drawing direction a point is on. */
export function sideOfLine(snap: SnappedStreet, at: Pt): CurbSide {
  const { toXY } = projector(at);
  const [ax, ay] = toXY(snap.line[snap.segment]);
  const [bx, by] = toXY(snap.line[snap.segment + 1]);
  // Cross product of (B − A) × (P − A), with P at the origin
  const cross = (bx - ax) * (0 - ay) - (by - ay) * (0 - ax);
  return cross > 0 ? 'left' : 'right';
}

function angleBetween(a: number, b: number): number {
  const d = Math.abs(((a - b) % 360 + 360) % 360);
  return d > 180 ? 360 - d : d;
}

export interface SideGuess {
  side: CurbSide;
  /** How the side was decided, shown to the ambassador so they can flip it */
  method: 'position' | 'heading';
}

/**
 * Which curb the sign is on. You usually photograph a sign on your own
 * sidewalk, so the side you're standing on wins — unless the phone points
 * across the street (within 50° of straight across), in which case the sign is
 * on the far curb.
 */
export function guessSignSide(snap: SnappedStreet, at: Pt, headingDeg: number | null): SideGuess {
  const mySide = sideOfLine(snap, at);
  if (headingDeg === null || !Number.isFinite(headingDeg) || snap.distanceMeters < 1) {
    return { side: mySide, method: 'position' };
  }
  const bearing = streetBearing(snap);
  // The far curb lies toward the opposite side's normal
  const farNormal = mySide === 'right' ? bearing - 90 : bearing + 90;
  if (angleBetween(headingDeg, farNormal) <= 50) {
    return { side: mySide === 'right' ? 'left' : 'right', method: 'heading' };
  }
  return { side: mySide, method: 'position' };
}

/**
 * The stretch of street a sign covers: SIGN_REACH_METRES either way from where
 * it projects onto the line, following the line's bends.
 */
export function signStretch(snap: SnappedStreet, reach = SIGN_REACH_METRES): number[][] {
  const { line, segment, t } = snap;
  const a = line[segment], b = line[segment + 1];
  const origin = { lng: a[0] + (b[0] - a[0]) * t, lat: a[1] + (b[1] - a[1]) * t };
  const { toXY, toLngLat } = projector(origin);
  const xy = line.map(p => toXY(p));

  const walk = (fromIdx: number, step: 1 | -1): number[][] => {
    const out: number[][] = [];
    let left = reach;
    let [px, py] = [0, 0];
    for (let i = fromIdx; i >= 0 && i < xy.length; i += step) {
      const [qx, qy] = xy[i];
      const seg = Math.hypot(qx - px, qy - py);
      if (seg >= left) {
        const f = seg === 0 ? 0 : left / seg;
        out.push(toLngLat(px + (qx - px) * f, py + (qy - py) * f));
        return out;
      }
      out.push(line[i]);
      left -= seg;
      [px, py] = [qx, qy];
    }
    return out;
  };

  const forward = walk(segment + 1, 1);
  const backward = walk(segment, -1).reverse();
  const centre = [origin.lng, origin.lat];
  const stretch = [...backward, centre, ...forward].map(([lng, lat]) => [Number(lng.toFixed(6)), Number(lat.toFixed(6))]);
  // Drop repeats (the sign can sit exactly on a vertex)
  return stretch.filter((p, i) => i === 0 || p[0] !== stretch[i - 1][0] || p[1] !== stretch[i - 1][1]);
}

/** The map colour a sign rule gives its curb. */
export function ruleToKind(rule: SignRule): string {
  switch (rule) {
    case 'free':
    case 'timeLimit': return 'street';
    case 'paid': return 'paid';
    case 'permit': return 'permit';
    default: return 'noParking';
  }
}

// ─── Firestore ────────────────────────────────────────────────────────────────

export interface SignReportInput {
  userId: string;
  lat: number;
  lng: number;
  accuracyMeters: number | null;
  headingDeg: number | null;
  side: CurbSide;
  sideMethod: SideGuess['method'] | 'manual';
  road: string | null;
  city: string;
  rule: SignRule;
  hours: number | null;
  /** Free text from the sign, e.g. "Mon–Fri 7–9 h" */
  note: string;
  stretch: number[][];
  /** Base64 JPEG, already shrunk */
  photo: string;
}

export interface SignReport {
  id: string;
  userId: string;
  lat: number;
  lng: number;
  side: CurbSide;
  road: string | null;
  city: string;
  rule: SignRule;
  hours: number | null;
  note: string;
  stretch: number[][];
  createdAt: Date | null;
}

/** Firestore can't nest arrays, so the stretch is stored as {lng, lat} maps. */
function packStretch(stretch: number[][]): Array<{ lng: number; lat: number }> {
  return stretch.map(([lng, lat]) => ({ lng, lat }));
}

/**
 * Saves the photo (owner-only) and the map report (public) together. The
 * report links to the photo by id, so reviewers can check the sign.
 */
export async function submitSignReport(input: SignReportInput): Promise<string> {
  const photoRef = doc(collection(db, 'signPhotos'));
  await setDoc(photoRef, {
    userId: input.userId,
    image: input.photo,
    createdAt: serverTimestamp(),
  });
  const ref = await addDoc(collection(db, 'signReports'), {
    userId: input.userId,
    lat: input.lat,
    lng: input.lng,
    accuracyMeters: input.accuracyMeters,
    headingDeg: input.headingDeg,
    side: input.side,
    sideMethod: input.sideMethod,
    road: input.road,
    city: input.city,
    rule: input.rule,
    hours: input.hours,
    note: input.note.slice(0, 120),
    stretch: packStretch(input.stretch),
    photoId: photoRef.id,
    createdAt: serverTimestamp(),
  });
  return ref.id;
}

function reportFromDoc(id: string, data: Record<string, unknown>): SignReport | null {
  const stretch = Array.isArray(data.stretch)
    ? (data.stretch as Array<{ lng: number; lat: number }>)
      .filter(p => typeof p?.lng === 'number' && typeof p?.lat === 'number')
      .map(p => [p.lng, p.lat])
    : [];
  if (stretch.length < 2) return null;
  return {
    id,
    userId: String(data.userId ?? ''),
    lat: Number(data.lat),
    lng: Number(data.lng),
    side: data.side === 'left' ? 'left' : 'right',
    road: typeof data.road === 'string' ? data.road : null,
    city: typeof data.city === 'string' ? data.city : 'Ottawa',
    rule: (SIGN_RULES as string[]).includes(String(data.rule)) ? data.rule as SignRule : 'free',
    hours: typeof data.hours === 'number' ? data.hours : null,
    note: typeof data.note === 'string' ? data.note : '',
    stretch,
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : null,
  };
}

const REPORT_LIMIT = 1000;

/** The most recent sign reports, newest first. */
export function subscribeToSignReports(onUpdate: (reports: SignReport[]) => void): () => void {
  return onSnapshot(
    query(collection(db, 'signReports'), orderBy('createdAt', 'desc'), limit(REPORT_LIMIT)),
    snap => onUpdate(snap.docs.map(d => reportFromDoc(d.id, d.data())).filter((r): r is SignReport => r !== null)),
    err => { console.warn('Sign reports unavailable:', err); onUpdate([]); },
  );
}

export async function countMySignReports(userId: string): Promise<number> {
  const snap = await getCountFromServer(query(collection(db, 'signReports'), where('userId', '==', userId)));
  return snap.data().count;
}

/** Ambassador level from the number of signs photographed. */
export function ambassadorLevel(count: number): { level: 0 | 1 | 2 | 3; next: number | null } {
  if (count >= 50) return { level: 3, next: null };
  if (count >= 15) return { level: 2, next: 50 };
  if (count >= 1) return { level: 1, next: 15 };
  return { level: 0, next: 1 };
}

/**
 * Sign reports as map lines. For each curb only the newest report counts, so a
 * later photo of a changed sign replaces the old answer.
 */
export function signReportFeatures(reports: SignReport[]): GeoJSON.Feature[] {
  const seen = new Set<string>();
  const features: GeoJSON.Feature[] = [];
  const sorted = [...reports].sort((a, b) => (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0));
  for (const r of sorted) {
    // ~10 m cell + side: two photos of the same sign collapse into one line
    const key = `${r.lat.toFixed(4)}:${r.lng.toFixed(4)}:${r.side}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const kind = ruleToKind(r.rule);
    const properties: Record<string, string | number> = {
      kind,
      basis: 'ambassador',
      curb: r.side === 'right' ? 1 : -1,
      city: r.city,
      rule: r.rule,
      reportId: r.id,
    };
    if (r.road) properties.road = r.road;
    if (r.hours && r.rule === 'timeLimit') properties.maxstay = `${r.hours} h`;
    if (r.hours && r.rule === 'paid') properties.maxStayHours = r.hours;
    if (r.note) properties.signNote = r.note;
    if (r.createdAt) properties.reportedAt = r.createdAt.toISOString();
    features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: r.stretch }, properties });
  }
  return features;
}
