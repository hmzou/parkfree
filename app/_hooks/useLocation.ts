import { useState, useEffect, useCallback, useRef } from 'react';
import * as Location from 'expo-location';
import { Coordinate } from '../_types';

// Ottawa city hall as default fallback
const OTTAWA_DEFAULT: Coordinate = { latitude: 45.4215, longitude: -75.6972 };

/** Android emulators / BlueStacks often never return a GPS fix — avoid hanging forever */
const CURRENT_POSITION_TIMEOUT_MS = 12_000;
/** On web this wraps navigator.geolocation too, which can also never answer */
const LAST_KNOWN_TIMEOUT_MS = 3_000;
/**
 * Android can leave the permission request unanswered behind its own "Location
 * Accuracy" dialog; never let that keep the app on the loading screen.
 */
const PERMISSION_TIMEOUT_MS = 15_000;

type PermissionStatus = 'undetermined' | 'granted' | 'denied';

interface UseLocationResult {
  coordinate: Coordinate;
  permissionStatus: PermissionStatus;
  /** Only the first launch: the map is hidden until the first answer */
  loading: boolean;
  /** A retry from the map is running; the map stays on screen */
  locating: boolean;
  /**
   * True only once a real position has arrived. Until then `coordinate` is the
   * downtown Ottawa fallback and must not be drawn as "you are here" — a
   * permission can be granted while the OS still refuses (e.g. macOS Location
   * Services off for the browser), which used to put the user at City Hall.
   */
  hasFix: boolean;
  /** Horizontal accuracy of the last fix in metres, for the accuracy circle */
  accuracyMeters: number | null;
  requestPermission: () => Promise<void>;
}

interface Fix {
  coordinate: Coordinate;
  accuracy: number | null;
}

/** expo-location's web remove() throws ("removeSubscription is not a function") */
function stopWatcher(sub: Location.LocationSubscription | null): void {
  try {
    sub?.remove();
  } catch {
    // Nothing to clean up; the browser watch dies with the page
  }
}

function delayReject(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => reject(new Error('location-timeout')), ms);
  });
}

async function resolveCoordinate(): Promise<Fix | null> {
  try {
    const loc = await Promise.race([
      // A quick coarse fix gets the map up; the high-accuracy watcher below
      // replaces it within seconds.
      Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      }),
      delayReject(CURRENT_POSITION_TIMEOUT_MS),
    ]);
    return {
      coordinate: { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
      accuracy: loc.coords.accuracy ?? null,
    };
  } catch {
    try {
      const last = await Promise.race([
        Location.getLastKnownPositionAsync(),
        delayReject(LAST_KNOWN_TIMEOUT_MS),
      ]);
      if (last) {
        return {
          coordinate: { latitude: last.coords.latitude, longitude: last.coords.longitude },
          accuracy: last.coords.accuracy ?? null,
        };
      }
    } catch {
      // fall through to the default
    }
    return null;
  }
}

export function useLocation(): UseLocationResult {
  const [coordinate, setCoordinate] = useState<Coordinate>(OTTAWA_DEFAULT);
  const [permissionStatus, setPermissionStatus] = useState<PermissionStatus>('undetermined');
  const [loading, setLoading] = useState(true);
  const [locating, setLocating] = useState(false);
  const [hasFix, setHasFix] = useState(false);
  const [accuracyMeters, setAccuracyMeters] = useState<number | null>(null);

  const applyFix = useCallback((fix: Fix | null) => {
    if (!fix) return;
    setCoordinate(fix.coordinate);
    setAccuracyMeters(fix.accuracy);
    setHasFix(true);
  }, []);
  const watcherRef = useRef<Location.LocationSubscription | null>(null);

  const startWatching = useCallback(() => {
    // A retry must not stack a second watcher on top of the first
    stopWatcher(watcherRef.current);
    watcherRef.current = null;
    Location.watchPositionAsync(
      {
        // GPS-level accuracy: a Wi-Fi/cell fix can be a few blocks off, which
        // matters when the question is which side of the street you're on.
        // Spot reloads have their own 500 m threshold, so frequent updates are cheap.
        accuracy: Location.Accuracy.High,
        distanceInterval: 10,
      },
      loc => {
        applyFix({
          coordinate: { latitude: loc.coords.latitude, longitude: loc.coords.longitude },
          accuracy: loc.coords.accuracy ?? null,
        });
      },
    )
      .then(sub => {
        watcherRef.current = sub;
      })
      .catch(() => {
        /* optional */
      });
  }, [applyFix]);

  const askAndLocate = useCallback(async () => {
    try {
      const { status } = await Promise.race([
        Location.requestForegroundPermissionsAsync(),
        delayReject(PERMISSION_TIMEOUT_MS),
      ]);
      if (status === 'granted') {
        setPermissionStatus('granted');
        applyFix(await resolveCoordinate());
        startWatching();
      } else {
        setPermissionStatus('denied');
      }
    } catch (err) {
      // A timeout means Android never answered: keep what we knew, don't claim "denied"
      if ((err as Error)?.message !== 'location-timeout') setPermissionStatus('denied');
    }
  }, [startWatching, applyFix]);

  /** Retry from the map ("find me", "Retry"): never hides the map behind the loading screen. */
  const requestPermission = useCallback(async () => {
    setLocating(true);
    try {
      await askAndLocate();
    } finally {
      setLocating(false);
    }
  }, [askAndLocate]);

  useEffect(() => {
    (async () => {
      const { status } = await Promise.race([
        Location.getForegroundPermissionsAsync(),
        delayReject(PERMISSION_TIMEOUT_MS),
      ]);
      if (status === 'granted') {
        setPermissionStatus('granted');
        applyFix(await resolveCoordinate());
        startWatching();
      } else if (status === 'denied') {
        setPermissionStatus('denied');
      } else {
        await askAndLocate();
      }
      setLoading(false);
    })().catch(() => setLoading(false));

    return () => {
      stopWatcher(watcherRef.current);
      watcherRef.current = null;
    };
  }, [askAndLocate, startWatching, applyFix]);

  return { coordinate, permissionStatus, loading, locating, hasFix, accuracyMeters, requestPermission };
}
