import React, { useRef, useCallback, useEffect, useMemo, useState, forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, View } from 'react-native';
import MapboxGL from '@rnmapbox/maps';
import type { MapState, ShapeSource as ShapeSourceType } from '@rnmapbox/maps';
import Constants from 'expo-constants';
import { ParkingSpot, Coordinate } from '../_types';
import type { CityLot } from '../_services/cityLots';
import { MapLegend } from './MapLegend';
import {
  buildOverlayGeoJSON,
  buildSpotsGeoJSON,
  LINE_OPACITY,
  LINE_WIDTH,
  LINE_SORT_KEY,
  LINE_OFFSET,
  OVERLAY_MIN_ZOOM,
  OverlayInfo,
} from './mapStyle';

// Expo Router evaluates every file under app/ on web too, where Metro resolves
// @rnmapbox/maps to an empty module.
MapboxGL?.setAccessToken?.(
  (Constants.expoConfig?.extra?.mapboxAccessToken as string) ?? '',
);

const ATTRIBUTION_POSITION = { bottom: 8, right: 8 };

// ─── ParkFreeMapView ──────────────────────────────────────────────────────────

export interface ParkFreeMapViewHandle {
  flyTo: (latitude: number, longitude: number, zoomLevel?: number) => void;
}

interface Props {
  /** Null until a real fix arrives (the native puck draws itself) */
  userCoordinate: Coordinate | null;
  userAccuracyMeters?: number | null;
  spots: ParkingSpot[];
  selectedSpotId: string | null;
  isCached: boolean;
  reportCounts: Record<string, number>;
  /** Optional marker coordinate for a searched location */
  searchMarker?: Coordinate | null;
  /** Where the user left the car, drawn until they say they moved it */
  parkedCar?: Coordinate | null;
  /** City of Ottawa parking layers */
  overlays: GeoJSON.FeatureCollection;
  cityLots: CityLot[];
  /** Show winter-ban alternate parking (only useful in winter) */
  showWinterParking: boolean;
  onSpotPress: (spot: ParkingSpot) => void;
  onOverlayPress: (info: OverlayInfo) => void;
  onMapMoved: (coord: Coordinate) => void;
  onLongPress: (coord: Coordinate) => void;
}

const DEFAULT_CENTER: Coordinate = { latitude: 45.4215, longitude: -75.6972 };

export const ParkFreeMapView = forwardRef<ParkFreeMapViewHandle, Props>(({
  userCoordinate,
  spots,
  selectedSpotId,
  isCached,
  reportCounts,
  searchMarker,
  parkedCar,
  overlays,
  cityLots,
  showWinterParking,
  onSpotPress,
  onOverlayPress,
  onMapMoved,
  onLongPress,
}, ref) => {
  const cameraRef = useRef<MapboxGL.Camera>(null);
  const [showOverlays, setShowOverlays] = useState(true);

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
  const skipInitialIdleRef = useRef(true);

  const cameraDefaultSettings = useMemo(
    () => ({
      centerCoordinate: [
        (userCoordinate ?? DEFAULT_CENTER).longitude,
        (userCoordinate ?? DEFAULT_CENTER).latitude,
      ] as [number, number],
      zoomLevel: 14,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const geoJSON = useMemo(
    () => buildSpotsGeoJSON(spots, selectedSpotId, reportCounts),
    [spots, selectedSpotId, reportCounts],
  );

  const overlayGeoJSON = useMemo(
    () => buildOverlayGeoJSON(overlays, cityLots, showWinterParking),
    [overlays, cityLots, showWinterParking],
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
        if (skipInitialIdleRef.current) {
          skipInitialIdleRef.current = false;
          return;
        }
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

  const handleOverlayPress = useCallback(
    (event: { features: GeoJSON.Feature[]; coordinates?: { latitude: number; longitude: number } }) => {
      const properties = event.features?.[0]?.properties;
      if (!properties?.kind) return;
      onOverlayPress({
        ...(properties as OverlayInfo),
        tapLat: event.coordinates?.latitude,
        tapLng: event.coordinates?.longitude,
      });
    },
    [onOverlayPress],
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
        {/* Native puck: accuracy ring and heading come from the OS */}
        <MapboxGL.UserLocation visible renderMode={MapboxGL.UserLocationRenderMode.Native} showsUserHeadingIndicator />

        {/* City parking rules, drawn under the spot pins */}
        {showOverlays && (
          <MapboxGL.ShapeSource
            id="overlays-source"
            shape={overlayGeoJSON}
            onPress={handleOverlayPress}
            // Street lines are thin; widen the touch target
            hitbox={{ width: 24, height: 24 }}
          >
            <MapboxGL.FillLayer
              id="overlay-fill"
              minZoomLevel={OVERLAY_MIN_ZOOM}
              filter={['==', ['geometry-type'], 'Polygon']}
              style={{ fillColor: ['get', 'color'], fillOpacity: 0.35 }}
            />
            <MapboxGL.LineLayer
              id="overlay-line"
              minZoomLevel={OVERLAY_MIN_ZOOM}
              filter={['==', ['geometry-type'], 'LineString']}
              style={{
                lineColor: ['get', 'color'],
                lineWidth: LINE_WIDTH,
                lineOpacity: LINE_OPACITY,
                lineCap: 'round',
                lineSortKey: LINE_SORT_KEY as any,
                lineOffset: LINE_OFFSET as any,
              }}
            />
            <MapboxGL.CircleLayer
              id="overlay-lot"
              filter={['==', ['get', 'kind'], 'cityLot']}
              style={{
                circleColor: ['get', 'color'],
                circleRadius: 11,
                circleStrokeColor: '#fff',
                circleStrokeWidth: 1.5,
              }}
            />
            <MapboxGL.SymbolLayer
              id="overlay-lot-label"
              filter={['==', ['get', 'kind'], 'cityLot']}
              style={{
                textField: ['get', 'label'],
                textSize: 11,
                textColor: '#fff',
                textOffset: [0, 1.6],
                textHaloColor: '#000',
                textHaloWidth: 1,
              }}
            />
          </MapboxGL.ShapeSource>
        )}

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
              circleStrokeColor: ['get', 'pinStroke'],
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
              circleStrokeColor: ['get', 'pinStroke'],
              circleStrokeWidth: 2,
              circleOpacity: pointOpacity,
              circleStrokeOpacity: pointOpacity,
            }}
          />
        </MapboxGL.ShapeSource>

        {/* Search location marker */}
        {parkedCar && (
          <MapboxGL.ShapeSource
            id="parked-car-source"
            shape={{
              type: 'FeatureCollection',
              features: [{
                type: 'Feature',
                id: 'parked-car',
                geometry: { type: 'Point', coordinates: [parkedCar.longitude, parkedCar.latitude] },
                properties: {},
              }],
            }}
          >
            <MapboxGL.CircleLayer
              id="parked-car-halo"
              style={{
                circleColor: 'rgba(255,109,0,0.25)',
                circleRadius: 22,
                circleStrokeColor: '#FF6D00',
                circleStrokeWidth: 2,
              }}
            />
            <MapboxGL.CircleLayer
              id="parked-car-dot"
              style={{
                circleColor: '#FF6D00',
                circleRadius: 8,
                circleStrokeColor: '#fff',
                circleStrokeWidth: 2,
              }}
            />
          </MapboxGL.ShapeSource>
        )}

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
      </MapboxGL.MapView>

      <MapLegend
        showOverlays={showOverlays}
        onToggleOverlays={setShowOverlays}
        showWinterParking={showWinterParking}
      />
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
