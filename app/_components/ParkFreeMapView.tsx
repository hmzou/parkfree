import React, { useRef, useCallback, useEffect, useMemo, forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, View } from 'react-native';
import MapboxGL from '@rnmapbox/maps';
import type { MapState, ShapeSource as ShapeSourceType } from '@rnmapbox/maps';
import Constants from 'expo-constants';
import { ParkingSpot, Coordinate } from '../_types';
import { buildGeoJSON, CAR_MARKER_COLOR } from './spotGeoJSON';
import { MapLegend } from './MapLegend';

MapboxGL.setAccessToken(
  (Constants.expoConfig?.extra?.mapboxAccessToken as string) ?? '',
);

const ATTRIBUTION_POSITION = { bottom: 8, right: 8 };

// ─── ParkFreeMapView ──────────────────────────────────────────────────────────

export interface ParkFreeMapViewHandle {
  flyTo: (latitude: number, longitude: number, zoomLevel?: number) => void;
}

interface Props {
  userCoordinate: Coordinate;
  spots: ParkingSpot[];
  selectedSpotId: string | null;
  isCached: boolean;
  reportCounts: Record<string, number>;
  /** Optional marker coordinate for a searched location */
  searchMarker?: Coordinate | null;
  /** Where the user parked during an active session ("find my car") */
  carMarker?: Coordinate | null;
  onSpotPress: (spot: ParkingSpot) => void;
  onMapMoved: (coord: Coordinate) => void;
  onLongPress: (coord: Coordinate) => void;
}

export const ParkFreeMapView = forwardRef<ParkFreeMapViewHandle, Props>(({
  userCoordinate,
  spots,
  selectedSpotId,
  isCached,
  reportCounts,
  searchMarker,
  carMarker,
  onSpotPress,
  onMapMoved,
  onLongPress,
}, ref) => {
  const cameraRef = useRef<MapboxGL.Camera>(null);

  useImperativeHandle(ref, () => ({
    flyTo: (latitude: number, longitude: number, zoomLevel = 15) => {
      cameraRef.current?.setCamera({
        centerCoordinate: [longitude, latitude],
        zoomLevel,
        animationDuration: 800,
      });
    },
  }));
  const sourceRef = useRef<ShapeSourceType>(null);
  const regionDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cameraDefaultSettings = useMemo(
    () => ({
      centerCoordinate: [userCoordinate.longitude, userCoordinate.latitude] as [number, number],
      zoomLevel: 14,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const geoJSON = useMemo(
    () => buildGeoJSON(spots, selectedSpotId, reportCounts),
    [spots, selectedSpotId, reportCounts],
  );

  // Point opacity: 0.5 for cached, 1.0 for fresh
  const pointOpacity = isCached ? 0.5 : 1.0;

  const handleMapIdle = useCallback(
    (state: MapState) => {
      const center = state?.properties?.center;
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

  // Handle taps on clusters or individual points
  const handleSourcePress = useCallback(
    async (event: { features: GeoJSON.Feature[] }) => {
      const feature = event.features?.[0];
      if (!feature?.properties) return;

      // Cluster tap → zoom in
      if (feature.properties.cluster) {
        const geometry = feature.geometry as GeoJSON.Point;
        try {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const zoom = await (sourceRef.current as any)?.getClusterExpansionZoom(feature);
          cameraRef.current?.setCamera({
            centerCoordinate: geometry.coordinates as [number, number],
            zoomLevel: (zoom ?? 16) + 1,
            animationDuration: 400,
          });
        } catch {
          cameraRef.current?.setCamera({
            centerCoordinate: geometry.coordinates as [number, number],
            zoomLevel: 16,
            animationDuration: 400,
          });
        }
        return;
      }

      // Individual point tap
      const spotId = feature.properties.id as string;
      const spot = spots.find(s => s.id === spotId);
      if (spot) onSpotPress(spot);
    },
    [spots, onSpotPress],
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

        {/* Clustered parking spot pins */}
        <MapboxGL.ShapeSource
          ref={sourceRef}
          id="spots-source"
          shape={geoJSON}
          cluster
          clusterMaxZoomLevel={15}
          clusterRadius={40}
          onPress={handleSourcePress}
        >
          {/* Cluster background circles */}
          <MapboxGL.CircleLayer
            id="cluster-circle"
            filter={['has', 'point_count']}
            style={{
              circleColor: [
                'interpolate', ['linear'], ['get', 'point_count'],
                1, '#4CAF50',
                6, '#FFB300',
                16, '#FF5722',
              ],
              circleRadius: [
                'interpolate', ['linear'], ['get', 'point_count'],
                1, 18,
                20, 28,
              ],
              circleStrokeColor: '#fff',
              circleStrokeWidth: 2,
              circleOpacity: pointOpacity,
              circleStrokeOpacity: pointOpacity,
            }}
          />
          {/* Cluster count label */}
          <MapboxGL.SymbolLayer
            id="cluster-count"
            filter={['has', 'point_count']}
            style={{
              textField: '{point_count_abbreviated}',
              textSize: 13,
              textColor: '#fff',
              textFont: ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
              textAllowOverlap: true,
            }}
          />
          {/* Selected unclustered point (larger) */}
          <MapboxGL.CircleLayer
            id="unclustered-selected"
            filter={['all', ['!', ['has', 'point_count']], ['==', ['get', 'selected'], 1]]}
            style={{
              circleColor: ['get', 'pinColor'],
              circleRadius: 14,
              circleStrokeColor: '#fff',
              circleStrokeWidth: 3,
              circleOpacity: pointOpacity,
              circleStrokeOpacity: pointOpacity,
            }}
          />
          {/* Regular unclustered points */}
          <MapboxGL.CircleLayer
            id="unclustered-point"
            filter={['all', ['!', ['has', 'point_count']], ['!=', ['get', 'selected'], 1]]}
            style={{
              circleColor: ['get', 'pinColor'],
              circleRadius: 9,
              circleStrokeColor: '#fff',
              circleStrokeWidth: 2,
              circleOpacity: pointOpacity,
              circleStrokeOpacity: pointOpacity,
            }}
          />
        </MapboxGL.ShapeSource>

        {/* Search location marker */}
        {searchMarker && (
          <MapboxGL.ShapeSource
            id="search-marker-source"
            shape={{
              type: 'FeatureCollection',
              features: [
                {
                  type: 'Feature',
                  id: 'search-marker',
                  geometry: {
                    type: 'Point',
                    coordinates: [searchMarker.longitude, searchMarker.latitude],
                  },
                  properties: {},
                },
              ],
            }}
          >
            <MapboxGL.CircleLayer
              id="search-marker-halo"
              style={{
                circleColor: 'rgba(33,150,243,0.2)',
                circleRadius: 22,
                circleStrokeColor: 'rgba(33,150,243,0.6)',
                circleStrokeWidth: 2,
              }}
            />
            <MapboxGL.CircleLayer
              id="search-marker-dot"
              style={{
                circleColor: '#2196F3',
                circleRadius: 8,
                circleStrokeColor: '#fff',
                circleStrokeWidth: 2,
              }}
            />
          </MapboxGL.ShapeSource>
        )}
        {/* Parked car marker */}
        {carMarker && (
          <MapboxGL.ShapeSource
            id="car-marker-source"
            shape={{
              type: 'Feature',
              geometry: { type: 'Point', coordinates: [carMarker.longitude, carMarker.latitude] },
              properties: {},
            }}
          >
            <MapboxGL.CircleLayer
              id="car-marker-dot"
              style={{
                circleColor: CAR_MARKER_COLOR,
                circleRadius: 12,
                circleStrokeColor: '#fff',
                circleStrokeWidth: 2,
              }}
            />
            <MapboxGL.SymbolLayer
              id="car-marker-label"
              style={{
                textField: 'P',
                textSize: 13,
                textColor: '#fff',
                textFont: ['DIN Offc Pro Medium', 'Arial Unicode MS Bold'],
                textAllowOverlap: true,
              }}
            />
          </MapboxGL.ShapeSource>
        )}
      </MapboxGL.MapView>

      {/* Pin color legend */}
      <MapLegend />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  map: {
    flex: 1,
  },
});
