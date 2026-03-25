import { useState, useEffect, useRef, useCallback } from 'react';
import { ParkingSpot, Coordinate } from '../types';
import { fetchFreeParkingSpots, haversineMeters } from '../services/overpass';
import { subscribeToSpots, subscribeToUserSpots, upsertOsmSpot } from '../services/firebase';

const REFRESH_THRESHOLD_METERS = 500;

interface UseSpotsResult {
  spots: ParkingSpot[];
  loading: boolean;
  error: string | null;
  refresh: (coord: Coordinate) => Promise<void>;
}

export function useSpots(initialCoord: Coordinate): UseSpotsResult {
  const [osmSpots, setOsmSpots] = useState<ParkingSpot[]>([]);
  const [firestoreSpots, setFirestoreSpots] = useState<ParkingSpot[]>([]);
  const [userSpots, setUserSpots] = useState<ParkingSpot[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lastFetchCoord = useRef<Coordinate | null>(null);

  // Merge all spot sources: Firestore overrides OSM (for occupancy), user spots appended
  const mergeSpots = useCallback((): ParkingSpot[] => {
    const firestoreMap = new Map(firestoreSpots.map(s => [s.id, s]));
    const merged = osmSpots.map(s => firestoreMap.get(s.id) ?? s);

    // Add user spots that don't duplicate existing
    const existingIds = new Set(merged.map(s => s.id));
    for (const us of userSpots) {
      if (!existingIds.has(us.id)) merged.push(us);
    }

    return merged;
  }, [osmSpots, firestoreSpots, userSpots]);

  const [spots, setSpots] = useState<ParkingSpot[]>([]);

  useEffect(() => {
    setSpots(mergeSpots());
  }, [mergeSpots]);

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
    if (lastFetchCoord.current) {
      const dist = haversineMeters(
        lastFetchCoord.current.latitude,
        lastFetchCoord.current.longitude,
        coord.latitude,
        coord.longitude,
      );
      if (dist < REFRESH_THRESHOLD_METERS) return; // not far enough to re-fetch
    }

    setLoading(true);
    setError(null);
    try {
      const fetched = await fetchFreeParkingSpots(coord.latitude, coord.longitude, 1000);
      lastFetchCoord.current = coord;
      setOsmSpots(fetched);

      // Sync to Firestore (best-effort, don't block UI)
      Promise.all(
        fetched.map(spot =>
          upsertOsmSpot({
            source: spot.source,
            lat: spot.lat,
            lng: spot.lng,
            type: spot.type,
            feeRequired: spot.feeRequired,
            timeRestrictions: spot.timeRestrictions,
            seasonalBan: spot.seasonalBan,
            occupied: spot.occupied,
            occupiedSince: spot.occupiedSince,
            occupiedBy: spot.occupiedBy,
            city: spot.city,
            verified: true,
          }).catch(() => null),
        ),
      ).catch(() => null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    refresh(initialCoord);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { spots, loading, error, refresh };
}
