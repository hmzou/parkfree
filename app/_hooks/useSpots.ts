import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ParkingSpot, Coordinate } from '../_types';
import { fetchFreeParkingSpots, haversineMeters } from '../_services/overpass';
import { subscribeToSpots, subscribeToUserSpots, subscribeToRecentReports } from '../_services/firebase';

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

function cacheKey(coord: Coordinate): string {
  return `spots_${Math.round(coord.latitude * 100)}_${Math.round(coord.longitude * 100)}`;
}

interface CacheEntry {
  spots: ParkingSpot[];
  timestamp: number;
}

async function readCache(coord: Coordinate): Promise<ParkingSpot[] | null> {
  if (!AsyncStorage) return null;
  try {
    const raw = await AsyncStorage.getItem(cacheKey(coord));
    if (!raw) return null;
    const entry: CacheEntry = JSON.parse(raw);
    if (Date.now() - entry.timestamp > CACHE_TTL_MS) return null;
    // Rehydrate Date fields
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

interface UseSpotsResult {
  spots: ParkingSpot[];
  loading: boolean;
  isCached: boolean;
  error: string | null;
  reportCounts: Record<string, number>;
  /**
   * Fetch spots around `coord`. Skipped when within REFRESH_THRESHOLD_METERS of the
   * last fetch unless `force` is set. Resolves to the fetched spots, or null if
   * the fetch was skipped, queued or failed.
   */
  refresh: (coord: Coordinate, opts?: { force?: boolean }) => Promise<ParkingSpot[] | null>;
}

export function useSpots(): UseSpotsResult {
  const [osmSpots, setOsmSpots] = useState<ParkingSpot[]>([]);
  // Occupied spots from Firestore — overlaid on OSM / user spots by ID
  const [firestoreSpots, setFirestoreSpots] = useState<ParkingSpot[]>([]);
  const [userSpots, setUserSpots] = useState<ParkingSpot[]>([]);
  const [reportCounts, setReportCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [isCached, setIsCached] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastFetchCoord = useRef<Coordinate | null>(null);
  const isFetchingRef = useRef(false);
  const pendingCoordRef = useRef<Coordinate | null>(null);
  const hasSpotsRef = useRef(false);
  hasSpotsRef.current = osmSpots.length > 0;

  const spots = useMemo((): ParkingSpot[] => {
    const occupancy = new Map(firestoreSpots.map(s => [s.id, s]));
    const withOccupancy = (s: ParkingSpot): ParkingSpot => {
      const o = occupancy.get(s.id);
      return o
        ? { ...s, occupied: o.occupied, occupiedSince: o.occupiedSince, occupiedBy: o.occupiedBy }
        : s;
    };

    const merged = osmSpots.map(withOccupancy);
    const existingIds = new Set(merged.map(s => s.id));
    for (const us of userSpots) {
      if (!existingIds.has(us.id)) merged.push(withOccupancy(us));
    }

    return merged;
  }, [osmSpots, firestoreSpots, userSpots]);

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
    opts?: { force?: boolean },
  ): Promise<ParkingSpot[] | null> => {
    // Avoid overlapping Overpass requests
    if (isFetchingRef.current) {
      pendingCoordRef.current = coord;
      return null;
    }

    if (lastFetchCoord.current && !opts?.force) {
      const dist = haversineMeters(
        lastFetchCoord.current.latitude,
        lastFetchCoord.current.longitude,
        coord.latitude,
        coord.longitude,
      );
      if (dist < REFRESH_THRESHOLD_METERS) return null;
    }

    // Load cache while fresh data loads
    const cached = await readCache(coord);
    if (cached && cached.length > 0 && !hasSpotsRef.current) {
      setOsmSpots(cached);
      setIsCached(true);
    }

    isFetchingRef.current = true;
    pendingCoordRef.current = null;

    setLoading(true);
    setError(null);
    try {
      const fetched = await fetchFreeParkingSpots(coord.latitude, coord.longitude, 1000);
      lastFetchCoord.current = coord;
      setOsmSpots(fetched);
      setIsCached(false);

      // Persist to cache
      void writeCache(coord, fetched);
      return fetched;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      // Keep showing cached spots (if any) rather than hiding the offline banner
      return null;
    } finally {
      setLoading(false);
      isFetchingRef.current = false;

      const next = pendingCoordRef.current;
      pendingCoordRef.current = null;
      if (next) void refresh(next);
    }
  }, []);

  return { spots, loading, isCached, error, reportCounts, refresh };
}
