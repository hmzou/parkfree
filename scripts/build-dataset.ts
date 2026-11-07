/**
 * Builds assets/data/parkfree-data.json: every free (or possibly free) OSM
 * parking spot in Ottawa + Gatineau, plus City of Ottawa parking layers.
 * The app bundles this file so it works offline and does not depend on the
 * public Overpass servers, and fetches newer copies from GitHub.
 *
 *   npm run build:data
 *
 * If Overpass is down, the spots from the previous file are kept.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  BBox,
  buildRegionQuery,
  OverpassElement,
  parseOverpassElements,
  REGION_BBOX,
  runOverpassQuery,
} from '../app/_services/overpass';
import type { DatasetSpot, ParkFreeDataset, OverlayKind } from '../app/_services/dataset';
import { curbFeatures, hasCurbAnswer, OsmWay } from './curbs';

const OUT_FILE = join(__dirname, '..', 'assets', 'data', 'parkfree-data.json');
const ARCGIS = 'https://maps.ottawa.ca/arcgis/rest/services/Parking/MapServer';
const STREETS = 'https://maps.ottawa.ca/arcgis/rest/services/Streets/MapServer';
const PAGE_SIZE = 1000;
const OVERPASS_TIMEOUT_MS = 100_000;
// Public mirrors reject one big region query, so fetch it in tiles
const TILE_ROWS = 3;
const TILE_COLS = 6;
const TILE_ATTEMPTS = 4;
const RETRY_DELAY_MS = 20_000;
const BETWEEN_TILES_MS = 8_000;
const TILE_DIR = join(__dirname, '..', 'assets', 'data', 'osm-tiles');

interface LayerSpec {
  id: number;
  kind: OverlayKind;
  /** output property name -> ArcGIS field */
  fields: Record<string, string>;
  /** ArcGIS MapServer base URL; defaults to the Parking service */
  service?: string;
  where?: string;
  /** Simplify lines to this tolerance in degrees (~1e-5 ≈ 1 m) to keep the file small */
  maxAllowableOffset?: number;
  /** Constant properties added to every feature */
  extra?: Record<string, string | number>;
  /** Extra per-feature properties computed from the geometry and output properties */
  derive?: (geometry: GeoJSON.Geometry, properties: Record<string, string | number>) => Record<string, string | number>;
}

const CURB_NORMALS: Record<string, [number, number]> = { N: [0, 1], S: [0, -1], E: [1, 0], W: [-1, 0] };

/**
 * Mapbox `line-offset` shifts a line to the right of its drawing direction when
 * positive. Work out which sign puts a paid segment on its recorded curb (N/S/E/W)
 * so it is drawn beside the street like SpotAngels' curb lines, not on top of it.
 */
function curbOffsetSign(geometry: GeoJSON.Geometry, side: string | undefined): number {
  const normal = side ? CURB_NORMALS[side] : undefined;
  if (!normal) return 0;
  const line = geometry.type === 'LineString'
    ? geometry.coordinates
    : geometry.type === 'MultiLineString' ? geometry.coordinates[0] : null;
  if (!line || line.length < 2) return 0;
  const [x0, y0] = line[0];
  const [x1, y1] = line[line.length - 1];
  const dx = (x1 - x0) * Math.cos((y0 * Math.PI) / 180);
  const dy = y1 - y0;
  // Right-hand normal of the drawing direction
  const dot = dy * normal[0] + -dx * normal[1];
  return dot === 0 ? 0 : Math.sign(dot);
}

const LAYERS: LayerSpec[] = [
  {
    id: 2,
    kind: 'paid',
    // IN_USE 'b' = meter out of service
    where: "IN_USE='a'",
    fields: {
      road: 'ROAD',
      from: 'FROM1',
      to: 'TO1',
      maxStayHours: 'MAX_STAY',
      side: 'SIDE',
      daysInEffect: 'DAYS_IN_EFFECT',
      hourlyRate: 'HOURLY_RATE',
    },
    derive: (geometry, properties) => ({
      curb: curbOffsetSign(geometry, properties.side as string | undefined),
    }),
  },
  { id: 14, kind: 'permit', fields: { area: 'AREA_NAME', areaFr: 'AREA_NAME_FR', areaNumber: 'AREA_NUMBER' } },
  { id: 1, kind: 'free15', fields: {} },
  // Road centrelines. By-law 2017-301 lets anyone park on a public street that has
  // no signs (3 h on weekdays 7–19, 6 h weekends), so local roads are drawn as
  // free by default. Collectors and arterials often carry no-parking or rush-hour
  // signs, so they are only coloured where OpenStreetMap records their curbs.
  // Freeways, ramps and transit-only roads never allow it.
  {
    id: 3,
    kind: 'street',
    service: STREETS,
    where: "SUBCLASS='LOCAL' AND OWNERSHIP='PUBLIC' AND CURRENT_STATUS='OPERATIONAL'",
    fields: { road: 'ROAD_NAME_FULL' },
    maxAllowableOffset: 0.00003,
    extra: { basis: 'default', city: 'Ottawa' },
  },
  // Collectors and arterials: the default rule may be overridden by signs, so
  // they are drawn grey ("check the signs") until OSM curbs, city meters or an
  // ambassador's sign photo tell us the answer.
  {
    id: 3,
    kind: 'unknown',
    service: STREETS,
    where: "SUBCLASS IN ('ARTERIAL','MAJCOLLECTOR','COLLECTOR','ROUNDABOUT') AND OWNERSHIP='PUBLIC' AND CURRENT_STATUS='OPERATIONAL'",
    fields: { road: 'ROAD_NAME_FULL' },
    maxAllowableOffset: 0.00003,
    extra: { basis: 'none', city: 'Ottawa' },
  },
  {
    id: 3,
    kind: 'noParking',
    service: STREETS,
    where: "SUBCLASS IN ('FREEWAY','HIGHWAY','RAMP','TRANSITWAY','BUSONLY','PARKWAY') AND CURRENT_STATUS='OPERATIONAL'",
    fields: { road: 'ROAD_NAME_FULL' },
    maxAllowableOffset: 0.00003,
    extra: { city: 'Ottawa' },
  },
  {
    id: 6,
    kind: 'banAlternate',
    fields: {
      name: 'PARK_FACILITY_NAME',
      nameFr: 'PARK_FACILITY_NAME_FR',
      address: 'ADDRESS',
      addressFr: 'ADDRESS_FR',
      spaces: 'PARKING_SPOTS',
    },
  },
];

async function fetchJson(url: string): Promise<any> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.json();
}

async function fetchLayer(layer: LayerSpec): Promise<GeoJSON.Feature[]> {
  const outFields = Object.values(layer.fields).join(',') || 'OBJECTID';
  const features: GeoJSON.Feature[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const params = new URLSearchParams({
      where: layer.where ?? '1=1',
      outFields,
      outSR: '4326',
      geometryPrecision: '5',
      orderByFields: 'OBJECTID',
      resultOffset: String(offset),
      resultRecordCount: String(PAGE_SIZE),
      f: 'geojson',
    });
    if (layer.maxAllowableOffset) params.set('maxAllowableOffset', String(layer.maxAllowableOffset));
    const page = await fetchJson(`${layer.service ?? ARCGIS}/${layer.id}/query?${params}`);
    const pageFeatures: GeoJSON.Feature[] = page.features ?? [];
    for (const feature of pageFeatures) {
      if (!feature.geometry) continue;
      const properties: Record<string, string | number> = { kind: layer.kind, ...layer.extra };
      for (const [name, field] of Object.entries(layer.fields)) {
        const value = feature.properties?.[field];
        if (value !== null && value !== undefined && value !== '') properties[name] = value;
      }
      if (layer.derive) Object.assign(properties, layer.derive(feature.geometry, properties));
      features.push({ type: 'Feature', geometry: feature.geometry, properties });
    }
    if (pageFeatures.length < PAGE_SIZE) break;
  }
  return features;
}

function regionTiles(): BBox[] {
  const { south, west, north, east } = REGION_BBOX;
  const latStep = (north - south) / TILE_ROWS;
  const lngStep = (east - west) / TILE_COLS;
  const tiles: BBox[] = [];
  for (let r = 0; r < TILE_ROWS; r++) {
    for (let c = 0; c < TILE_COLS; c++) {
      tiles.push({
        south: south + r * latStep,
        west: west + c * lngStep,
        north: south + (r + 1) * latStep,
        east: west + (c + 1) * lngStep,
      });
    }
  }
  return tiles;
}

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

function tilePath(index: number): string {
  return join(TILE_DIR, `tile-${String(index).padStart(2, '0')}.json`);
}

function readTile(index: number): OverpassElement[] | null {
  const path = tilePath(index);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Finished tiles are kept on disk so a rate-limited run can resume.
 * A tile that still fails is skipped; spots from the tiles we do have are
 * published, which is better than shipping an empty map.
 */
async function fetchRegionElements(): Promise<OverpassElement[]> {
  mkdirSync(TILE_DIR, { recursive: true });
  const elements: OverpassElement[] = [];
  const tiles = regionTiles();
  let missed = 0;
  for (const [index, tile] of tiles.entries()) {
    const cached = readTile(index);
    if (cached) {
      elements.push(...cached);
      console.log(`OSM tile ${index + 1}/${tiles.length}: cached ${cached.length} elements`);
      continue;
    }
    if (index > 0) await sleep(BETWEEN_TILES_MS);
    for (let attempt = 1; ; attempt++) {
      try {
        const tileElements = await runOverpassQuery(buildRegionQuery(tile), OVERPASS_TIMEOUT_MS);
        writeFileSync(tilePath(index), JSON.stringify(tileElements));
        elements.push(...tileElements);
        console.log(`OSM tile ${index + 1}/${tiles.length}: ${tileElements.length} elements`);
        break;
      } catch (err) {
        if (attempt >= TILE_ATTEMPTS) {
          missed += 1;
          console.warn(`OSM tile ${index + 1} skipped: ${(err as Error).message}`);
          break;
        }
        console.warn(`OSM tile ${index + 1} attempt ${attempt} failed: ${(err as Error).message}`);
        await sleep(RETRY_DELAY_MS * attempt);
      }
    }
  }
  if (missed > 0) console.warn(`OSM: ${missed} tile(s) missing`);
  return elements;
}

function compactSpot(spot: ReturnType<typeof parseOverpassElements>[number]): DatasetSpot {
  const out: DatasetSpot = {
    id: spot.id,
    lat: Number(spot.lat.toFixed(6)),
    lng: Number(spot.lng.toFixed(6)),
    type: spot.type,
    city: spot.city,
  };
  if (spot.feeUnknown) out.feeUnknown = true;
  if (spot.timeRestrictions) out.timeRestrictions = spot.timeRestrictions;
  if (spot.seasonalBan) out.seasonalBan = true;
  return out;
}

function metresBetween(a: number[], b: number[]): number {
  const dx = (a[0] - b[0]) * 111_320 * Math.cos((a[1] * Math.PI) / 180);
  const dy = (a[1] - b[1]) * 110_540;
  return Math.hypot(dx, dy);
}

const PAID_NEARBY_METRES = 20;
const SAMPLE_EVERY_METRES = 10;
/** Share of a street's length that must have meters for it to stop being green */
const PAID_SHARE_TO_DROP = 0.5;

function pointToSegmentMetres(p: number[], a: number[], b: number[]): number {
  // Local flat projection around p, good enough at street scale
  const kx = 111_320 * Math.cos((p[1] * Math.PI) / 180);
  const ky = 110_540;
  const ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * ky;
  const bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2));
  return Math.hypot(ax + t * dx, ay + t * dy);
}

function samplePoints(line: number[][]): number[][] {
  const out: number[][] = [];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i];
    const steps = Math.max(1, Math.ceil(metresBetween(a, b) / SAMPLE_EVERY_METRES));
    for (let k = 0; k < steps; k++) {
      const t = k / steps;
      out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    }
  }
  if (line.length) out.push(line[line.length - 1]);
  return out;
}

function lineParts(geometry: GeoJSON.Geometry): number[][][] {
  if (geometry.type === 'LineString') return [geometry.coordinates];
  if (geometry.type === 'MultiLineString') return geometry.coordinates;
  return [];
}

const GRID_DEG = 0.001; // ~110 m cells
const GREEN_KINDS = new Set(['street', 'permit']);

function cellKey(p: number[]): string {
  return `${Math.floor(p[0] / GRID_DEG)}:${Math.floor(p[1] / GRID_DEG)}`;
}

/** Grid index of line segments for fast "is this point near any of them?" checks. */
function segmentIndex(features: GeoJSON.Feature[]): (p: number[], metres: number) => boolean {
  const grid = new Map<string, [number[], number[]][]>();
  for (const f of features) {
    if (!f.geometry) continue;
    for (const line of lineParts(f.geometry)) {
      for (let i = 1; i < line.length; i++) {
        const seg: [number[], number[]] = [line[i - 1], line[i]];
        for (const key of new Set([cellKey(seg[0]), cellKey(seg[1])])) {
          const list = grid.get(key) ?? [];
          list.push(seg);
          grid.set(key, list);
        }
      }
    }
  }
  return (p, metres) => {
    const cx = Math.floor(p[0] / GRID_DEG), cy = Math.floor(p[1] / GRID_DEG);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const [a, b] of grid.get(`${cx + dx}:${cy + dy}`) ?? []) {
          if (pointToSegmentMetres(p, a, b) < metres) return true;
        }
      }
    }
    return false;
  };
}

/**
 * Drop each `target` feature when at least `share` of its length lies within
 * `metres` of a `source` feature. Matching is by geometry only, since the
 * layers name roads differently (or not at all).
 */
function dropCovered(
  features: GeoJSON.Feature[],
  isTarget: (f: GeoJSON.Feature) => boolean,
  isSource: (f: GeoJSON.Feature) => boolean,
  metres: number,
  share: number,
): GeoJSON.Feature[] {
  const near = segmentIndex(features.filter(isSource));
  return features.filter(f => {
    if (!isTarget(f) || !f.geometry) return true;
    const samples = lineParts(f.geometry).flatMap(samplePoints);
    if (samples.length === 0) return true;
    return samples.filter(p => near(p, metres)).length / samples.length < share;
  });
}

/** A block with meters on its curbs must not also show a green line. */
function dropFreeWherePaid(features: GeoJSON.Feature[]): GeoJSON.Feature[] {
  return dropCovered(
    features,
    f => GREEN_KINDS.has(f.properties?.kind),
    f => f.properties?.kind === 'paid',
    PAID_NEARBY_METRES,
    PAID_SHARE_TO_DROP,
  );
}

/** Where OSM records a street's curbs, its side lines replace the centreline guess. */
const OSM_MATCH_METRES = 12;
/** A grey "unknown" road is hidden wherever any coloured line already answers it. */
function dropUnknownWhereAnswered(features: GeoJSON.Feature[]): GeoJSON.Feature[] {
  return dropCovered(
    features,
    f => f.properties?.kind === 'unknown',
    f => ['street', 'paid', 'noParking', 'permit', 'free15'].includes(f.properties?.kind),
    OSM_MATCH_METRES,
    0.5,
  );
}

function dropDefaultWhereMapped(features: GeoJSON.Feature[]): GeoJSON.Feature[] {
  return dropCovered(
    features,
    f => f.properties?.basis === 'default',
    f => f.properties?.basis === 'osm',
    OSM_MATCH_METRES,
    0.5,
  );
}

// ─── OpenStreetMap curb sides ────────────────────────────────────────────────

const CURB_KEYS = '^parking:(both|left|right|lane:both|lane:left|lane:right)$';

const CITY_CELL_DEG = 0.004; // ~400 m

/**
 * Which city a point is in, voted by the city-published roads around it: every
 * Ottawa or Gatineau centreline casts a vote for its ~400 m cell. Mapped curbs
 * take the majority of their cell and its neighbours.
 */
function cityLocator(features: GeoJSON.Feature[]): (lng: number, lat: number) => string | null {
  const votes = new Map<string, { Ottawa: number; Gatineau: number }>();
  for (const f of features) {
    const city = f.properties?.city;
    if ((city !== 'Ottawa' && city !== 'Gatineau') || f.properties?.basis === 'osm' || !f.geometry) continue;
    for (const line of lineParts(f.geometry)) {
      for (const [lng, lat] of line) {
        const key = `${Math.floor(lng / CITY_CELL_DEG)}:${Math.floor(lat / CITY_CELL_DEG)}`;
        const v = votes.get(key) ?? { Ottawa: 0, Gatineau: 0 };
        v[city as 'Ottawa' | 'Gatineau'] += 1;
        votes.set(key, v);
      }
    }
  }
  return (lng, lat) => {
    const cx = Math.floor(lng / CITY_CELL_DEG), cy = Math.floor(lat / CITY_CELL_DEG);
    let ottawa = 0, gatineau = 0;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const v = votes.get(`${cx + dx}:${cy + dy}`);
        // The point's own cell counts double so river-edge cells lean the right way
        const w = dx === 0 && dy === 0 ? 2 : 1;
        if (v) { ottawa += v.Ottawa * w; gatineau += v.Gatineau * w; }
      }
    }
    if (ottawa === 0 && gatineau === 0) return null;
    return gatineau > ottawa ? 'Gatineau' : 'Ottawa';
  };
}

async function fetchCurbFeatures(locate: (lng: number, lat: number) => string | null): Promise<GeoJSON.Feature[]> {
  const { south, west, north, east } = REGION_BBOX;
  const query = `[out:json][timeout:180];way(${south},${west},${north},${east})[highway][~"${CURB_KEYS}"~"."];out tags geom;`;
  const elements = (await runOverpassQuery(query, OVERPASS_TIMEOUT_MS)) as unknown as OsmWay[];
  const features: GeoJSON.Feature[] = [];
  for (const way of elements) {
    if (!hasCurbAnswer(way) || !way.geometry?.length) continue;
    const mid = way.geometry[Math.floor(way.geometry.length / 2)];
    const city = locate(mid.lon, mid.lat);
    // Outside both cities' road networks (Chelsea, Cantley, …): rules unknown
    if (!city) continue;
    for (const f of curbFeatures(way, city)) {
      const g = f.geometry as GeoJSON.LineString;
      g.coordinates = compactLine(g.coordinates);
      features.push(f);
    }
  }
  return features;
}

// ─── Gatineau road network (Ville de Gatineau open data) ─────────────────────

const GATINEAU_ROADS =
  'https://www.donneesquebec.ca/recherche/dataset/35695cd5-531e-45c9-9f2c-6cb82ffcedbf/resource/fbbb839a-3b66-47cc-baab-cd4021b09205/download/voie_publique.json';

/**
 * Downtown Hull (Île de Hull, Vieux-Hull) has meters and time-limited zones that
 * Gatineau does not publish, so its local streets are left uncoloured rather
 * than guessed. [west, south, east, north]
 */
const HULL_PAID_CORE: [number, number, number, number] = [-75.7400, 45.4180, -75.7080, 45.4420];

function insideBox(line: number[][], [w, s, e, n]: [number, number, number, number]): boolean {
  return line.some(([lng, lat]) => lng >= w && lng <= e && lat >= s && lat <= n);
}

const SIMPLIFY_METRES = 3;

/** Douglas–Peucker: drop points that sit within `tolerance` metres of the simplified line. */
function simplify(line: number[][], tolerance = SIMPLIFY_METRES): number[][] {
  if (line.length <= 2) return line;
  let maxD = 0, index = 0;
  for (let i = 1; i < line.length - 1; i++) {
    const d = pointToSegmentMetres(line[i], line[0], line[line.length - 1]);
    if (d > maxD) { maxD = d; index = i; }
  }
  if (maxD <= tolerance) return [line[0], line[line.length - 1]];
  const left = simplify(line.slice(0, index + 1), tolerance);
  return [...left.slice(0, -1), ...simplify(line.slice(index), tolerance)];
}

/** Round to ~1 m, drop repeated points and simplify to keep the bundled file small. */
export function compactLine(line: number[][]): number[][] {
  const out: number[][] = [];
  for (const [lng, lat] of line) {
    const p = [Number(lng.toFixed(5)), Number(lat.toFixed(5))];
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  return simplify(out);
}

/**
 * Règlement 300-2006 sets no time limit on unsigned Gatineau streets (art. 52
 * only applies where a sign is posted), so local streets are free by default;
 * the Dec 1 – Apr 1 overnight ban is applied by the app. Collectors and
 * arterials are left to OSM, highways and ramps are never allowed.
 */
async function fetchGatineauStreets(): Promise<GeoJSON.Feature[]> {
  const data = await fetchJson(GATINEAU_ROADS);
  const features: GeoJSON.Feature[] = [];
  for (const f of data.features ?? []) {
    const p = f.properties ?? {};
    if (!f.geometry) continue;
    const highway = p.HIERARCHI === 'Autoroute' || p.TYPE === 'Bretelle';
    const local = p.HIERARCHI === 'Rue locale'
      && ['Standard', 'Cul-de-sac carré', 'Cul-de-sac circulaire', 'Jointure'].includes(p.TYPE);
    const lines = lineParts(f.geometry).map(compactLine).filter(l => l.length >= 2);
    if (lines.length === 0) continue;
    // Collectors, arterials and downtown Hull: drawn grey until someone checks the signs
    const unknown = !highway && (!local || lines.some(l => insideBox(l, HULL_PAID_CORE)));
    const geometry: GeoJSON.Geometry = lines.length === 1
      ? { type: 'LineString', coordinates: lines[0] }
      : { type: 'MultiLineString', coordinates: lines };
    const properties: Record<string, string | number> = highway
      ? { kind: 'noParking', city: 'Gatineau' }
      : unknown
        ? { kind: 'unknown', basis: 'none', city: 'Gatineau' }
        : { kind: 'street', basis: 'default', city: 'Gatineau' };
    if (p.NOM_TOPO) properties.road = p.NOM_TOPO;
    features.push({ type: 'Feature', geometry, properties });
  }
  return features;
}

/** Simplify every line (Ottawa's service returns more points than a phone needs). */
function compactFeature(f: GeoJSON.Feature): GeoJSON.Feature {
  if (!f.geometry || (f.geometry.type !== 'LineString' && f.geometry.type !== 'MultiLineString')) return f;
  const lines = lineParts(f.geometry).map(compactLine).filter(l => l.length >= 2);
  if (lines.length === 0) return f;
  const properties = { ...f.properties };
  if (properties.basis === 'none') delete properties.basis;
  return {
    type: 'Feature',
    geometry: lines.length === 1
      ? { type: 'LineString', coordinates: lines[0] }
      : { type: 'MultiLineString', coordinates: lines },
    properties,
  };
}

/**
 * Blocks of one street with identical properties become one MultiLineString:
 * the road name and rule are stored once instead of per block, which roughly
 * halves the file. Tapping any block still shows the same card.
 */
function mergeSameStreet(features: GeoJSON.Feature[]): GeoJSON.Feature[] {
  const groups = new Map<string, { properties: GeoJSON.GeoJsonProperties; lines: number[][][] }>();
  const out: GeoJSON.Feature[] = [];
  for (const f of features) {
    const g = f.geometry;
    if (!g || (g.type !== 'LineString' && g.type !== 'MultiLineString') || !f.properties?.road) {
      out.push(f);
      continue;
    }
    const key = JSON.stringify(Object.entries(f.properties).sort(([a], [b]) => a.localeCompare(b)));
    const group = groups.get(key) ?? { properties: f.properties, lines: [] };
    group.lines.push(...lineParts(g));
    groups.set(key, group);
  }
  for (const { properties, lines } of groups.values()) {
    out.push({
      type: 'Feature',
      geometry: lines.length === 1
        ? { type: 'LineString', coordinates: lines[0] }
        : { type: 'MultiLineString', coordinates: lines },
      properties,
    });
  }
  return out;
}

function readPrevious(): ParkFreeDataset | null {
  if (!existsSync(OUT_FILE)) return null;
  try {
    return JSON.parse(readFileSync(OUT_FILE, 'utf8'));
  } catch {
    return null;
  }
}

async function main() {
  const previous = readPrevious();
  const now = new Date().toISOString();

  let spots: DatasetSpot[] = previous?.spots ?? [];
  let spotsGeneratedAt = previous?.spotsGeneratedAt ?? null;
  try {
    if (process.env.SKIP_OSM) throw new Error('SKIP_OSM set');
    const elements = await fetchRegionElements();
    spots = parseOverpassElements(elements).map(compactSpot);
    spotsGeneratedAt = now;
    console.log(`OSM: ${spots.length} spots`);
  } catch (err) {
    console.warn(`OSM fetch failed, keeping ${spots.length} previous spots:`, (err as Error).message);
  }

  const overlays: GeoJSON.Feature[] = [];
  for (const layer of LAYERS) {
    try {
      const features = await fetchLayer(layer);
      overlays.push(...features);
      console.log(`Ottawa ${layer.kind}: ${features.length} features`);
    } catch (err) {
      const kept = previous?.overlays.features.filter(f => f.properties?.kind === layer.kind) ?? [];
      overlays.push(...kept);
      console.warn(`Ottawa ${layer.kind} failed, keeping ${kept.length}:`, (err as Error).message);
    }
  }

  for (const [label, fetcher, keep] of [
    ['Gatineau streets', fetchGatineauStreets, (f: GeoJSON.Feature) => f.properties?.city === 'Gatineau' && f.properties?.basis !== 'osm'],
    ['OSM curbs', () => fetchCurbFeatures(cityLocator(overlays)), (f: GeoJSON.Feature) => f.properties?.basis === 'osm'],
  ] as const) {
    try {
      const features = await fetcher();
      overlays.push(...features);
      console.log(`${label}: ${features.length} features`);
    } catch (err) {
      const kept = previous?.overlays.features.filter(keep) ?? [];
      overlays.push(...kept);
      console.warn(`${label} failed, keeping ${kept.length}:`, (err as Error).message);
    }
  }

  let cleaned = dropDefaultWhereMapped(overlays);
  console.log(`Replaced ${overlays.length - cleaned.length} default streets with mapped curbs`);
  const beforePaid = cleaned.length;
  cleaned = dropFreeWherePaid(cleaned);
  console.log(`Removed ${beforePaid - cleaned.length} green segments that have paid curbs`);
  const beforeUnknown = cleaned.length;
  cleaned = dropUnknownWhereAnswered(cleaned);
  console.log(`Hid ${beforeUnknown - cleaned.length} grey roads that already have an answer`);
  console.log(`Grey "check the signs" roads: ${cleaned.filter(f => f.properties?.kind === 'unknown').length}`);
  overlays.length = 0;
  overlays.push(...mergeSameStreet(cleaned.map(compactFeature)));

  const dataset: ParkFreeDataset = {
    version: 1,
    generatedAt: now,
    spotsGeneratedAt,
    spots,
    overlays: { type: 'FeatureCollection', features: overlays },
  };

  mkdirSync(dirname(OUT_FILE), { recursive: true });
  const json = JSON.stringify(dataset);
  writeFileSync(OUT_FILE, json);
  console.log(`Wrote ${OUT_FILE} (${(json.length / 1024).toFixed(0)} KB)`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
