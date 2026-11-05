import Constants from 'expo-constants';
import { City, ParkingSpot, SpotType } from '../_types';

/**
 * Pre-built spot + city-layer data (scripts/build-dataset.ts). The copy bundled
 * in the app works offline; a newer copy is fetched from the repo at most
 * twice a day, so OSM edits reach users without an app release.
 */

/** `street`: unsigned public street, free by default; `noParking`: freeways, ramps, transit roads */
export type OverlayKind = 'paid' | 'permit' | 'free15' | 'banAlternate' | 'street' | 'noParking';

export interface DatasetSpot {
  id: string;
  lat: number;
  lng: number;
  type: SpotType;
  city: City;
  feeUnknown?: boolean;
  timeRestrictions?: string;
  seasonalBan?: boolean;
}

export interface ParkFreeDataset {
  version: number;
  generatedAt: string;
  /** When the OSM spots were last fetched; null if never */
  spotsGeneratedAt: string | null;
  spots: DatasetSpot[];
  overlays: GeoJSON.FeatureCollection;
}

const DATASET_VERSION = 1;
const DEFAULT_DATASET_URL =
  'https://raw.githubusercontent.com/hmzou/parkfree/master/assets/data/parkfree-data.json';
const REMOTE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000;
const STORAGE_KEY = `dataset_v${DATASET_VERSION}`;
const CHECKED_AT_KEY = `dataset_v${DATASET_VERSION}_checked_at`;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AsyncStorage = (() => {
  try {
    return require('@react-native-async-storage/async-storage').default;
  } catch {
    return null;
  }
})();

// eslint-disable-next-line @typescript-eslint/no-require-imports
const bundled: ParkFreeDataset = require('../../assets/data/parkfree-data.json');

function datasetUrl(): string {
  return (Constants.expoConfig?.extra?.datasetUrl as string | undefined) || DEFAULT_DATASET_URL;
}

function isValid(data: unknown): data is ParkFreeDataset {
  const d = data as ParkFreeDataset | null;
  return !!d && d.version === DATASET_VERSION && Array.isArray(d.spots)
    && d.overlays?.type === 'FeatureCollection';
}

function isNewer(a: ParkFreeDataset, b: ParkFreeDataset): boolean {
  return Date.parse(a.generatedAt) > Date.parse(b.generatedAt);
}

export function getBundledDataset(): ParkFreeDataset {
  return bundled;
}

async function readStored(): Promise<ParkFreeDataset | null> {
  if (!AsyncStorage) return null;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Newest of the bundled copy and the last downloaded copy. */
export async function loadDataset(): Promise<ParkFreeDataset> {
  const stored = await readStored();
  return stored && isNewer(stored, bundled) ? stored : bundled;
}

/**
 * Download the hosted copy if it has not been checked recently. Resolves to
 * the new dataset when it is newer than `current`, otherwise null.
 */
export async function refreshDataset(current: ParkFreeDataset): Promise<ParkFreeDataset | null> {
  if (AsyncStorage) {
    const checkedAt = Number(await AsyncStorage.getItem(CHECKED_AT_KEY).catch(() => null));
    if (Number.isFinite(checkedAt) && Date.now() - checkedAt < REMOTE_CHECK_INTERVAL_MS) return null;
  }
  const response = await fetch(datasetUrl());
  if (!response.ok) throw new Error(`Dataset download failed: ${response.status}`);
  const remote = await response.json();
  await AsyncStorage?.setItem(CHECKED_AT_KEY, String(Date.now())).catch(() => null);
  if (!isValid(remote) || !isNewer(remote, current)) return null;
  await AsyncStorage?.setItem(STORAGE_KEY, JSON.stringify(remote)).catch(() => null);
  return remote;
}

export function datasetToSpots(dataset: ParkFreeDataset): ParkingSpot[] {
  return dataset.spots.map(s => ({
    id: s.id,
    source: 'osm',
    lat: s.lat,
    lng: s.lng,
    type: s.type,
    feeRequired: false,
    feeUnknown: s.feeUnknown ?? false,
    timeRestrictions: s.timeRestrictions ?? null,
    seasonalBan: s.seasonalBan ?? false,
    occupied: false,
    occupiedSince: null,
    occupiedBy: null,
    city: s.city,
    verified: true,
  }));
}
