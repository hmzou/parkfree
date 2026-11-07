import { ParkingSpot } from '../_types';
import type { CityLot } from '../_services/cityLots';
import { getLocale } from '../_i18n';

/** Shared by the native and web map views so both draw the same thing. */
export const MAP_COLORS = {
  free: '#4CAF50',
  limited: '#FFB300',
  unclear: '#90A4AE',
  unclearFill: '#263238',
  banned: '#FF5722',
  occupied: '#F44336',
  fee: '#9E9E9E',
  paid: '#42A5F5',
  permit: '#FDD835',
  free15: '#26C6DA',
  banAlternate: '#AB47BC',
  cityLot: '#1E88E5',
  // Street lines: one colour per answer to "can I park here?"
  streetFree: '#00E676',
  /** Legend swatch for the faint default-rule green (same hue at the line's opacity on the dark map) */
  streetFreeDefault: '#0E6B3B',
  streetNo: '#FF1744',
  streetPaid: '#2979FF',
} as const;

export const OVERLAY_MIN_ZOOM = 13;

export const LINE_WIDTH = [
  'interpolate', ['linear'], ['zoom'],
  13, 1.5,
  15, 3,
  18, 6,
] as const;
/**
 * Lines checked against the signs (OpenStreetMap curbs, city meter data) are
 * drawn solid; streets coloured only by the city's default rule are fainter,
 * so a glance shows which answers are certain.
 */
export const LINE_OPACITY = ['case', ['==', ['get', 'basis'], 'default'], 0.45, 0.95] as const;
/** Paid segments sit on their recorded curb (`curb` = ±1), beside the street centreline */
const CURB = ['coalesce', ['get', 'curb'], 0];
export const LINE_OFFSET = [
  'interpolate', ['linear'], ['zoom'],
  13, ['*', CURB, 1.5],
  15, ['*', CURB, 4],
  18, ['*', CURB, 10],
] as const;
/** Paid draws over free (a downtown street can be both), no-parking over everything */
export const LINE_SORT_KEY = ['get', 'sortKey'] as const;

interface PinStyle {
  fill: string;
  stroke: string;
}

/**
 * Pins use the same three answers as the street lines: green you can park
 * (time limits are shown on the card), red you can't, blue you pay. A hollow
 * green ring means the data can't confirm it — check the signs.
 */
export function getPinStyle(spot: ParkingSpot, reportCount: number): PinStyle {
  const solid = (fill: string): PinStyle => ({ fill, stroke: '#fff' });
  if (spot.occupied) return solid(MAP_COLORS.streetNo);
  if (spot.rule?.level === 'banned') return solid(MAP_COLORS.streetNo);
  if (reportCount >= 2) return solid(MAP_COLORS.streetNo);
  if (spot.feeRequired) return solid(MAP_COLORS.streetPaid);
  if (!spot.rule && spot.seasonalBan) return solid(MAP_COLORS.streetNo);
  if (spot.rule?.level === 'unclear') return { fill: MAP_COLORS.unclearFill, stroke: MAP_COLORS.streetFree };
  return solid(MAP_COLORS.streetFree);
}

export function buildSpotsGeoJSON(
  spots: ParkingSpot[],
  selectedId: string | null,
  reportCounts: Record<string, number>,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: spots.map(spot => {
      const style = getPinStyle(spot, reportCounts[spot.id] ?? 0);
      return {
        type: 'Feature' as const,
        id: spot.id,
        geometry: { type: 'Point' as const, coordinates: [spot.lng, spot.lat] },
        properties: {
          id: spot.id,
          pinColor: style.fill,
          pinStroke: style.stroke,
          selected: spot.id === selectedId ? 1 : 0,
        },
      };
    }),
  };
}

// Visitors may park on permit roads within the posted limit, and 15-minute
// spots are free, so both read as green alongside unsigned streets.
const OVERLAY_COLORS: Record<string, string> = {
  street: MAP_COLORS.streetFree,
  permit: MAP_COLORS.streetFree,
  free15: MAP_COLORS.streetFree,
  paid: MAP_COLORS.streetPaid,
  noParking: MAP_COLORS.streetNo,
  banAlternate: MAP_COLORS.banAlternate,
  cityLot: MAP_COLORS.cityLot,
};

const OVERLAY_SORT: Record<string, number> = { street: 0, permit: 1, free15: 2, paid: 3, noParking: 4 };

/** City layers plus live city lots, each feature tagged with its colour. */
export function buildOverlayGeoJSON(
  overlays: GeoJSON.FeatureCollection,
  cityLots: CityLot[],
  showWinterParking: boolean,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  overlays.features.forEach((feature, index) => {
    const kind = feature.properties?.kind as string | undefined;
    if (!kind || (kind === 'banAlternate' && !showWinterParking)) return;
    features.push({
      ...feature,
      id: `overlay_${index}`,
      properties: {
        ...feature.properties,
        color: OVERLAY_COLORS[kind] ?? '#fff',
        sortKey: OVERLAY_SORT[kind] ?? 0,
      },
    });
  });
  const fr = getLocale() === 'fr';
  for (const lot of cityLots) {
    features.push({
      type: 'Feature',
      id: `citylot_${lot.id}`,
      geometry: { type: 'Point', coordinates: [lot.lng, lot.lat] },
      properties: {
        kind: 'cityLot',
        color: MAP_COLORS.cityLot,
        label: lot.freeSpaces === null ? 'P' : `P ${lot.freeSpaces}`,
        address: fr ? lot.addressFr : lot.address,
        capacity: lot.capacity,
        freeSpaces: lot.freeSpaces ?? -1,
      },
    });
  }
  return { type: 'FeatureCollection', features };
}

export type OverlayInfo = Record<string, string | number | null | undefined> & { kind: string };

export interface LegendItem {
  color: string;
  key: string;
  shape: 'dot' | 'ring' | 'line';
}

export function legendItems(showOverlays: boolean, showWinterParking: boolean): LegendItem[] {
  // Lines and pins share the same three colours, so one row covers both
  const items: LegendItem[] = [
    { color: MAP_COLORS.streetFree, key: 'map.legendStreetFree', shape: 'line' },
    { color: MAP_COLORS.streetFreeDefault, key: 'map.legendStreetDefault', shape: 'line' },
    { color: MAP_COLORS.streetNo, key: 'map.legendStreetNo', shape: 'line' },
    { color: MAP_COLORS.streetPaid, key: 'map.legendStreetPaid', shape: 'line' },
    { color: MAP_COLORS.streetFree, key: 'map.legendUnclear', shape: 'ring' },
  ];
  if (showOverlays) {
    items.push({ color: MAP_COLORS.cityLot, key: 'map.legendCityLot', shape: 'dot' });
    if (showWinterParking) {
      items.push({ color: MAP_COLORS.banAlternate, key: 'map.legendBanAlternate', shape: 'dot' });
    }
  }
  return items;
}
