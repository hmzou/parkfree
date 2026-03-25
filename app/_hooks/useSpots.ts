import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { ParkingSpot, Coordinate } from '../_types';
import { fetchFreeParkingSpots, haversineMeters } from '../_services/overpass';
import { subscribeToSpots, subscribeToUserSpots, upsertOsmSpot } from '../_services/firebase';

const REFRESH_THRESHOLD_METERS = 500;

interface UseSpotsResult {
  spots: ParkingSpot[];
  loading: boolean;
  error: string | null;
  refresh: (coord: Coordinate) => Promise<void>;
}

export function useSpots(): UseSpotsResult {
  const [osmSpots, setOsmSpots] = useState<ParkingSpot[]>([]);
  const [firestoreSpots, setFirestoreSpots] = useState<ParkingSpot[]>([]);
  const [userSpots, setUserSpots] = useState<ParkingSpot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastFetchCoord = useRef<Coordinate | null>(null);
  const isFetchingRef = useRef(false);
  const pendingCoordRef = useRef<Coordinate | null>(null);

  const spots = useMemo((): ParkingSpot[] => {
    const firestoreMap = new Map(firestoreSpots.map(s => [s.id, s]));
    const merged = osmSpots.map(s => firestoreMap.get(s.id) ?? s);

    const existingIds = new Set(merged.map(s => s.id));
    for (const us of userSpots) {
      if (!existingIds.has(us.id)) merged.push(us);
    }

    return merged;
  }, [osmSpots, firestoreSpots, userSpots]);

  // Subscribe to Firestore occupancy updates in real time
  useEffect(() => {
    const unsubSpots = subscribeToSpots(
      (updated) => setFirestoreSpots(updated),
      (err) => console.warn('Firestore spots error:', err),
    );
    const unsubUser = subscribeToUserSpots((updated) => setUserSpots(updated));

    return () => {
      unsubSpots();
      unsubUser();
    };
  }, []);

  const refresh = useCallback(async (coord: Coordinate) => {
    // Avoid overlapping Overpass requests (can look like “endless searching”).
    if (isFetchingRef.current) {
      pendingCoordRef.current = coord;
      return;
    }

    if (lastFetchCoord.current) {
      const dist = haversineMeters(
        lastFetchCoord.current.latitude,
        lastFetchCoord.current.longitude,
        coord.latitude,
        coord.longitude,
      );
      if (dist < REFRESH_THRESHOLD_METERS) return; // not far enough to re-fetch
    }

    isFetchingRef.current = true;
    pendingCoordRef.current = null;

    setLoading(true);
    setError(null);
    try {
      const fetched = await fetchFreeParkingSpots(coord.latitude, coord.longitude, 1000);
      lastFetchCoord.current = coord;
      setOsmSpots(fetched);

      // Sync to Firestore (best-effort, don't block UI).
      // Pass the full spot so upsertOsmSpot uses spot.id as the document key,
      // keeping Firestore IDs in sync with in-memory IDs for correct occupancy merging.
      Promise.all(
        fetched.map(spot => upsertOsmSpot(spot).catch(() => null)),
      ).catch(() => null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
      isFetchingRef.current = false;

      // If something else requested a refresh while we were fetching, do one more round.
      const next = pendingCoordRef.current;
      pendingCoordRef.current = null;
      if (next) void refresh(next);
    }
  }, []);

  return { spots, loading, error, refresh };
}
