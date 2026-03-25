import { useState, useEffect, useCallback, useRef } from 'react';
import * as Location from 'expo-location';
import { Coordinate } from '../_types';

// Ottawa city hall as default fallback
const OTTAWA_DEFAULT: Coordinate = { latitude: 45.4215, longitude: -75.6972 };

/** Android emulators / BlueStacks often never return a GPS fix — avoid hanging forever */
const CURRENT_POSITION_TIMEOUT_MS = 12_000;

type PermissionStatus = 'undetermined' | 'granted' | 'denied';

interface UseLocationResult {
  coordinate: Coordinate;
  permissionStatus: PermissionStatus;
  loading: boolean;
  requestPermission: () => Promise<void>;
}

function delayReject(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error('location-timeout')), ms);
  });
}

async function resolveCoordinate(): Promise<Coordinate> {
  try {
    const loc = await Promise.race([
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Low,
      }),
      delayReject(CURRENT_POSITION_TIMEOUT_MS),
    ]);
    return {
      latitude: loc.coords.latitude,
      longitude: loc.coords.longitude,
    };
  } catch {
    const last = await Location.getLastKnownPositionAsync();
    if (last) {
      return {
        latitude: last.coords.latitude,
        longitude: last.coords.longitude,
      };
    }
    return OTTAWA_DEFAULT;
  }
}

export function useLocation(): UseLocationResult {
  const [coordinate, setCoordinate] = useState<Coordinate>(OTTAWA_DEFAULT);
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>('undetermined');
  const [loading, setLoading] = useState(true);
  const watcherRef = useRef<Location.LocationSubscription | null>(null);

  const startWatching = useCallback(() => {
    Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        // Fewer updates reduce how often we re-query Overpass while user location is jittery
        distanceInterval: 250,
      },
      loc => {
        setCoordinate({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
      },
    )
      .then(sub => {
        watcherRef.current = sub;
      })
      .catch(() => {
        /* optional */
      });
  }, []);

  const requestPermission = useCallback(async () => {
    setLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        setPermissionStatus('granted');
        const coord = await resolveCoordinate();
        setCoordinate(coord);
        startWatching();
      } else {
        setPermissionStatus('denied');
      }
    } catch {
      setPermissionStatus('denied');
    } finally {
      setLoading(false);
    }
  }, [startWatching]);

  useEffect(() => {
    (async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status === 'granted') {
        setPermissionStatus('granted');
        const coord = await resolveCoordinate();
        setCoordinate(coord);
        startWatching();
      } else if (status === 'denied') {
        setPermissionStatus('denied');
      } else {
        await requestPermission();
        return;
      }
      setLoading(false);
    })();

    return () => {
      watcherRef.current?.remove();
      watcherRef.current = null;
    };
  }, [requestPermission, startWatching]);

  return { coordinate, permissionStatus, loading, requestPermission };
}
