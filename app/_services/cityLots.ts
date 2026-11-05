/**
 * City of Ottawa municipal lots and garages with live free-space counts, from
 * the City's open traffic data (https://traffic.ottawa.ca/en/opendata). These
 * are paid, so they are shown apart from free spots as a fallback.
 */
const CITY_LOTS_URL = 'https://traffic.ottawa.ca/map/service/parking';
const CITY_LOTS_TTL_MS = 5 * 60 * 1000;

export interface CityLot {
  id: number;
  lat: number;
  lng: number;
  address: string;
  addressFr: string;
  capacity: number;
  /** Null when the lot has no live counter */
  freeSpaces: number | null;
}

interface RawLot {
  id: number;
  latitude: number;
  longitude: number;
  address?: string;
  address_fr?: string;
  capacity?: number;
  freeSpaces?: number | string;
}

let cached: { lots: CityLot[]; fetchedAt: number } | null = null;

export function parseCityLots(json: unknown): CityLot[] {
  const raw = (json as { parking_lots?: RawLot[] } | null)?.parking_lots ?? [];
  return raw
    .filter(lot => Number.isFinite(lot.latitude) && Number.isFinite(lot.longitude))
    .map(lot => ({
      id: lot.id,
      lat: lot.latitude,
      lng: lot.longitude,
      address: lot.address ?? '',
      addressFr: lot.address_fr ?? lot.address ?? '',
      capacity: lot.capacity ?? 0,
      freeSpaces: typeof lot.freeSpaces === 'number' ? lot.freeSpaces : null,
    }));
}

export async function fetchCityLots(): Promise<CityLot[]> {
  if (cached && Date.now() - cached.fetchedAt < CITY_LOTS_TTL_MS) return cached.lots;
  const response = await fetch(CITY_LOTS_URL);
  if (!response.ok) throw new Error(`City lots error: ${response.status}`);
  const lots = parseCityLots(await response.json());
  cached = { lots, fetchedAt: Date.now() };
  return lots;
}
