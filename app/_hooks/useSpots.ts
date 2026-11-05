import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ParkingSpot, Coordinate } from '../_types';
import { fetchFreeParkingSpots, haversineMeters } from '../_services/overpass';
import { subscribeToSpots, subscribeToUserSpots, subscribeToRecentReports } from '../_services/firebase';
import { isOccupiedNow } from '../_services/occupancy';
import { evaluateSpot, RuleContext, RuleVerdict } from '../_services/parkingRules';
import {
  datasetToSpots,
  getBundledDataset,
  loadDataset,
  ParkFreeDataset,
  refreshDataset,
} from '../_services/dataset';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AsyncStorage = (() => {
  try {
    return require('@react-native-async-storage/async-storage').default;
  } catch {
    return null;
  }
})();

const REFRESH_THRESHOLD_METERS = 500;
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
// Also drives rule countdowns, so keep it at a minute
const RECHECK_MS = 60 * 1000;

// Bump when parseOverpassElements changes so spots parsed by older code are ignored
const CACHE_VERSION = 3;

function cacheKey(coord: Coordinate): string {
  return `spots_v${CACHE_VERSION}_${Math.round(coord.latitude * 100)}_${Math.round(coord.longitude * 100)}`;
}

interface CacheEntry {
  spots: ParkingSpot[];
  timestamp: number;
}

async function readCache(
  coord: Coordinate,
  allowStale = false,
): Promise<ParkingSpot[] | null> {
  if (!AsyncStorage) return null;
  try {
    const raw = await AsyncStorage.getItem(cacheKey(coord));
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    const stale = Date.now() - entry.timestamp > CACHE_TTL_MS;
    if (stale && !allowStale) return null;
    return entry.spots.map((s: ParkingSpot) => ({
      ...s,
      occupiedSince: s.occupiedSince ? new Date(s.occupiedSince) : null,
    }));
  } catch {
    return null;
  }
}

async function writeCache(coord: Coordinate, spots: ParkingSpot[]): Promise<void> {
  if (!AsyncStorage) return;
  try {
    const entry: CacheEntry = { spots, timestamp: Date.now() };
    await AsyncStorage.setItem(cacheKey(coord), JSON.stringify(entry));
  } catch {
    // non-fatal
  }
}

interface RefreshOptions {
  /** Skip the 500 m movement gate. Used by Search this area and address search. */
  force?: boolean;
  radiusMeters?: number;
}

interface UseSpotsResult {
  spots: ParkingSpot[];
  /** City of Ottawa parking layers from the dataset */
  overlays: GeoJSON.FeatureCollection;
  /** The bundled dataset already holds every spot in the region, no area search needed */
  coversRegion: boolean;
  loading: boolean;
  isCached: boolean;
  error: string | null;
  reportCounts: Record<string, number>;
  now: Date;
  refresh: (coord: Coordinate, options?: RefreshOptions) => Promise<ParkingSpot[] | null>;
}

export function useSpots(ruleContext: RuleContext = {}): UseSpotsResult {
  const [dataset, setDataset] = useState<ParkFreeDataset>(getBundledDataset);
  const [osmSpots, setOsmSpots] = useState<ParkingSpot[]>([]);
  const [firestoreSpots, setFirestoreSpots] = useState<ParkingSpot[]>([]);
  const [userSpots, setUserSpots] = useState<ParkingSpot[]>([]);
  const [reportCounts, setReportCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [isCached, setIsCached] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastFetchCoord = useRef<Coordinate | null>(null);
  const isFetchingRef = useRef(false);
  const pendingCoordRef = useRef<{ coord: Coordinate; radius: number } | null>(null);
  const flightRef = useRef<Promise<ParkingSpot[] | null> | null>(null);
  const osmSpotsRef = useRef<ParkingSpot[]>([]);

  const datasetSpots = useMemo(() => datasetToSpots(dataset), [dataset]);
  const datasetSpotsRef = useRef(datasetSpots);
  datasetSpotsRef.current = datasetSpots;
  const coversRegion = datasetSpots.length > 0;

  useEffect(() => {
    let cancelled = false;
    loadDataset()
      .then((loaded) => {
        if (!cancelled) setDataset(loaded);
        return refreshDataset(loaded);
      })
      .then((newer) => {
        if (newer && !cancelled) setDataset(newer);
      })
      .catch(err => console.warn('Dataset update failed:', err));
    return () => { cancelled = true; };
  }, []);

  // Firestore does not push an update when a hold expires, and rule
  // countdowns move with the clock, so re-check periodically.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), RECHECK_MS);
    return () => clearInterval(id);
  }, []);

  const ottawaBanLikely = ruleContext.ottawaBanLikely ?? false;

  const spots = useMemo((): ParkingSpot[] => {
    const firestoreMap = new Map(firestoreSpots.map(s => [s.id, s]));
    // Many spots share the same inputs, so evaluate each combination once per tick
    const verdicts = new Map<string, RuleVerdict>();
    const ruleFor = (spot: ParkingSpot): RuleVerdict => {
      const key = `${spot.type}|${spot.city}|${spot.timeRestrictions}|${spot.feeUnknown}|${spot.seasonalBan}`;
      let verdict = verdicts.get(key);
      if (!verdict) {
        verdict = evaluateSpot(spot, now, { ottawaBanLikely });
        verdicts.set(key, verdict);
      }
      return verdict;
    };

    const withLiveState = (spot: ParkingSpot): ParkingSpot => {
      const remote = firestoreMap.get(spot.id);
      const rule = ruleFor(spot);
      if (!remote || !isOccupiedNow(remote, now)) {
        return { ...spot, rule, occupied: false, occupiedSince: null, occupiedBy: null, occupiedUntil: null };
      }
      return {
        ...spot,
        rule,
        occupied: true,
        occupiedSince: remote.occupiedSince,
        occupiedBy: remote.occupiedBy,
        occupiedUntil: remote.occupiedUntil ?? null,
      };
    };

    const base = coversRegion ? datasetSpots : osmSpots;
    const merged = base.map(withLiveState);
    const existingIds = new Set(merged.map(s => s.id));
    for (const userSpot of userSpots) {
      if (!existingIds.has(userSpot.id)) merged.push(withLiveState(userSpot));
    }

    return merged;
  }, [coversRegion, datasetSpots, osmSpots, firestoreSpots, userSpots, now, ottawaBanLikely]);

  // Subscribe to Firestore occupancy updates + user spots + reports in real time
  useEffect(() => {
    const unsubSpots = subscribeToSpots(
      (updated) => setFirestoreSpots(updated),
      (err) => console.warn('Firestore spots error:', err),
    );
    const unsubUser = subscribeToUserSpots((updated) => setUserSpots(updated));
    const unsubReports = subscribeToRecentReports((counts) => setReportCounts(counts));

    return () => {
      unsubSpots();
      unsubUser();
      unsubReports();
    };
  }, []);

  const refresh = useCallback(async (
    coord: Coordinate,
    options?: RefreshOptions,
  ): Promise<ParkingSpot[] | null> => {
    // The dataset already covers the whole region; Overpass is only the
    // fallback for a build that shipped without spots.
    if (datasetSpotsRef.current.length > 0) {
      lastFetchCoord.current = coord;
      return datasetSpotsRef.current;
    }

    if (!options?.force && lastFetchCoord.current) {
      const dist = haversineMeters(
        lastFetchCoord.current.latitude,
        lastFetchCoord.current.longitude,
        coord.latitude,
        coord.longitude,
      );
      if (dist < REFRESH_THRESHOLD_METERS) return osmSpotsRef.current;
    }

    const radius = options?.radiusMeters ?? 1000;
    pendingCoordRef.current = { coord, radius };
    if (flightRef.current) {
      return flightRef.current.then(() => osmSpotsRef.current);
    }

    let result: ParkingSpot[] | null = null;

    const job = (async (): Promise<ParkingSpot[] | null> => {

    while (pendingCoordRef.current) {
      const next = pendingCoordRef.current;
      pendingCoordRef.current = null;
      isFetchingRef.current = true;
      setLoading(true);
      setError(null);

      if (osmSpotsRef.current.length === 0) {
        const cached = await readCache(next.coord);
        if (cached && cached.length > 0) {
          osmSpotsRef.current = cached;
          setOsmSpots(cached);
          setIsCached(true);
        }
      }

      try {
        const fetched = await fetchFreeParkingSpots(
          next.coord.latitude,
          next.coord.longitude,
          next.radius,
        );
        lastFetchCoord.current = next.coord;
        osmSpotsRef.current = fetched;
        setOsmSpots(fetched);
        setIsCached(false);
        result = fetched;

        void writeCache(next.coord, fetched);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error');
        const stale = await readCache(next.coord, true);
        if (stale && stale.length > 0) {
          osmSpotsRef.current = stale;
          setOsmSpots(stale);
          setIsCached(true);
          result = stale;
        } else {
          setIsCached(osmSpotsRef.current.length > 0);
          result = null;
        }
      } finally {
        setLoading(false);
        isFetchingRef.current = false;
      }
    }

    return result;
    })();

    flightRef.current = job;
    try {
      return await job;
    } finally {
      if (flightRef.current === job) flightRef.current = null;
    }
  }, []);

  return {
    spots,
    overlays: dataset.overlays,
    coversRegion,
    loading,
    isCached,
    error,
    reportCounts,
    now,
    refresh,
  };
}
