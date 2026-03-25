import React, { useRef, useCallback, useEffect, useMemo, memo } from 'react';
import { StyleSheet, View } from 'react-native';
import MapboxGL from '@rnmapbox/maps';
import type { MapState } from '@rnmapbox/maps';
import Constants from 'expo-constants';
import { ParkingSpot, Coordinate } from '../_types';
import { SpotPin } from './SpotPin';

MapboxGL.setAccessToken(
  (Constants.expoConfig?.extra?.mapboxAccessToken as string) ?? '',
);

// Stable constants — defined outside components to avoid new object refs on every render
const ANCHOR = { x: 0.5, y: 1 };
const ATTRIBUTION_POSITION = { bottom: 8, right: 8 };

// ─── SpotMarker ───────────────────────────────────────────────────────────────
// Memoized per-spot marker. Prevents all pins from re-rendering when only one
// spot changes (e.g. a different pin is selected, or the parent re-renders for
// an unrelated reason). Also stabilises the `coordinate` array and `onPress`
// callback so Mapbox does not see spurious prop changes.
const SpotMarker = memo<{
  spot: ParkingSpot;
  selected: boolean;
  onPress: (spot: ParkingSpot) => void;
}>(({ spot, selected, onPress }) => {
  const coordinate = useMemo(
    (): [number, number] => [spot.lng, spot.lat],
    [spot.lng, spot.lat],
  );
  const handlePress = useCallback(() => onPress(spot), [onPress, spot]);

  return (
    <MapboxGL.MarkerView id={spot.id} coordinate={coordinate} anchor={ANCHOR}>
      <SpotPin spot={spot} selected={selected} onPress={handlePress} />
    </MapboxGL.MarkerView>
  );
});

// ─── ParkFreeMapView ──────────────────────────────────────────────────────────

interface Props {
  userCoordinate: Coordinate;
  spots: ParkingSpot[];
  selectedSpotId: string | null;
  onSpotPress: (spot: ParkingSpot) => void;
  onMapMoved: (coord: Coordinate) => void;
  onLongPress: (coord: Coordinate) => void;
}

export const ParkFreeMapView: React.FC<Props> = ({
  userCoordinate,
  spots,
  selectedSpotId,
  onSpotPress,
  onMapMoved,
  onLongPress,
}) => {
  const cameraRef = useRef<MapboxGL.Camera>(null);
  const regionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // `defaultSettings` is read once when Camera mounts — no setCamera timing issues.
  // The parent (MapScreen) keeps showing a loading screen until locationLoading=false,
  // so by the time this component mounts, userCoordinate is already the real GPS fix
  // (or the Ottawa fallback if GPS timed out). Either way, we center on the right place
  // at zoom 14 (neighbourhood level) and let the user pan/zoom freely after that.
  const cameraDefaultSettings = useMemo(
    () => ({
      centerCoordinate: [userCoordinate.longitude, userCoordinate.latitude] as [number, number],
      zoomLevel: 14,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [], // Only evaluated once at mount — intentional
  );

  // `onMapIdle` fires after the map settles (no intermediate events during pan/zoom)
  // and provides a `MapState` with the camera center in `properties.center`.
  const handleMapIdle = useCallback(
    (state: MapState) => {
      const center = state?.properties?.center;
      // GeoJSON.Position is typically [lng, lat]
      if (!Array.isArray(center) || center.length < 2) return;
      const lng = center[0];
      const lat = center[1];
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;

      const newCoord: Coordinate = { latitude: lat, longitude: lng };
      if (regionDebounceRef.current) clearTimeout(regionDebounceRef.current);
      regionDebounceRef.current = setTimeout(() => {
        onMapMoved(newCoord);
      }, 450);
    },
    [onMapMoved],
  );

  useEffect(() => {
    return () => {
      if (regionDebounceRef.current) clearTimeout(regionDebounceRef.current);
    };
  }, []);

  const handleLongPress = useCallback(
    (feature: GeoJSON.Feature) => {
      if (!feature.geometry || feature.geometry.type !== 'Point') return;
      const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates;
      onLongPress({ latitude: lat, longitude: lng });
    },
    [onLongPress],
  );

  return (
    <View style={styles.container}>
      <MapboxGL.MapView
        style={styles.map}
        styleURL={MapboxGL.StyleURL.Dark}
        onMapIdle={handleMapIdle}
        onLongPress={handleLongPress}
        compassEnabled
        logoEnabled={false}
        attributionEnabled
        attributionPosition={ATTRIBUTION_POSITION}
      >
        <MapboxGL.Camera ref={cameraRef} defaultSettings={cameraDefaultSettings} />

        {/* User location dot */}
        <MapboxGL.UserLocation visible />

        {/* Parking spot pins — each wrapped in its own memo component */}
        {spots.map(spot => (
          <SpotMarker
            key={spot.id}
            spot={spot}
            selected={spot.id === selectedSpotId}
            onPress={onSpotPress}
          />
        ))}
      </MapboxGL.MapView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
});
