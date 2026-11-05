import { ParkingSpot } from '../_types';

// ─── Pin color helpers ─────────────────────────────────────────────────────────

export function getPinColor(spot: ParkingSpot, reportCount: number): string {
  if (spot.occupied) return '#F44336';
  if (reportCount >= 2) return '#FF5722';
  if (reportCount === 1) return '#FFB300';
  if (spot.feeRequired) return '#9E9E9E';
  if (spot.seasonalBan) return '#FF5722';
  if (spot.timeRestrictions) return '#FFB300';
  return '#4CAF50';
}

// Convert spots array to a GeoJSON FeatureCollection for the map source
export function buildGeoJSON(
  spots: ParkingSpot[],
  selectedId: string | null,
  reportCounts: Record<string, number>,
): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return {
    type: 'FeatureCollection',
    features: spots.map(spot => ({
      type: 'Feature' as const,
      id: spot.id,
      geometry: {
        type: 'Point' as const,
        coordinates: [spot.lng, spot.lat],
      },
      properties: {
        id: spot.id,
        pinColor: getPinColor(spot, reportCounts[spot.id] ?? 0),
        selected: spot.id === selectedId ? 1 : 0,
      },
    })),
  };
}
