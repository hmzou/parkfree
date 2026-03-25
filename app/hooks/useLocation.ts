import { useState, useEffect, useCallback } from 'react';
import * as Location from 'expo-location';
import { Coordinate } from '../types';

// Ottawa city hall as default fallback
const OTTAWA_DEFAULT: Coordinate = { latitude: 45.4215, longitude: -75.6972 };

type PermissionStatus = 'undetermined' | 'granted' | 'denied';

interface UseLocationResult {
  coordinate: Coordinate;
  permissionStatus: PermissionStatus;
  loading: boolean;
  requestPermission: () => Promise<void>;
}

export function useLocation(): UseLocationResult {
  const [coordinate, setCoordinate] = useState<Coordinate>(OTTAWA_DEFAULT);
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>('undetermined');
  const [loading, setLoading] = useState(true);

  const requestPermission = useCallback(async () => {
    setLoading(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status === 'granted') {
        setPermissionStatus('granted');
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setCoordinate({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });
      } else {
        setPermissionStatus('denied');
      }
    } catch {
      setPermissionStatus('denied');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let watcher: Location.LocationSubscription | null = null;

    (async () => {
      const { status } = await Location.getForegroundPermissionsAsync();
      if (status === 'granted') {
        setPermissionStatus('granted');
        const loc = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        setCoordinate({
          latitude: loc.coords.latitude,
          longitude: loc.coords.longitude,
        });

        // Continue watching position for map refresh triggers
        watcher = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.Balanced,
            distanceInterval: 100, // update every 100m
          },
          (loc) => {
            setCoordinate({
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
            });
          },
        );
      } else if (status === 'denied') {
        setPermissionStatus('denied');
      } else {
        await requestPermission();
      }
      setLoading(false);
    })();

    return () => {
      watcher?.remove();
    };
  }, [requestPermission]);

  return { coordinate, permissionStatus, loading, requestPermission };
}
