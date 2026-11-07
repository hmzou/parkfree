import React, {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react';
import { StyleSheet, View, Text } from 'react-native';
import Constants from 'expo-constants';
import { ParkingSpot, Coordinate } from '../_types';
import type { CityLot } from '../_services/cityLots';
import { MapLegend } from './MapLegend';
import type { TakenSpot } from '../_hooks/useSpots';
import {
  buildOverlayGeoJSON,
  buildSpotsGeoJSON,
  buildTakenGeoJSON,
  MAP_COLORS,
  LINE_OPACITY,
  LINE_WIDTH,
  LINE_SORT_KEY,
  LINE_OFFSET,
  OVERLAY_MIN_ZOOM,
  OverlayInfo,
} from './mapStyle';

const MAPBOX_JS = 'https://api.mapbox.com/mapbox-gl-js/v3.11.0/mapbox-gl.js';
const MAPBOX_CSS = 'https://api.mapbox.com/mapbox-gl-js/v3.11.0/mapbox-gl.css';

const OVERLAY_LAYERS = ['overlay-fill', 'overlay-line', 'overlay-lot', 'overlay-lot-label'];
const TAP_TOLERANCE_PX = 10;

export interface ParkFreeMapViewHandle {
  flyTo: (latitude: number, longitude: number, zoomLevel?: number) => void;
}

interface Props {
  /** Null until a real fix arrives: never draw the fallback as "you are here" */
  userCoordinate: Coordinate | null;
  /** Fix accuracy in metres, drawn as a circle around the dot */
  userAccuracyMeters?: number | null;
  spots: ParkingSpot[];
  selectedSpotId: string | null;
  isCached: boolean;
  reportCounts: Record<string, number>;
  searchMarker?: Coordinate | null;
  parkedCar?: Coordinate | null;
  overlays: GeoJSON.FeatureCollection;
  cityLots: CityLot[];
  showWinterParking: boolean;
  /** Street spots someone is parked in, drawn orange */
  takenSpots: TakenSpot[];
  showTaken: boolean;
  onSpotPress: (spot: ParkingSpot) => void;
  onOverlayPress: (info: OverlayInfo) => void;
  onMapMoved: (coord: Coordinate) => void;
  onLongPress: (coord: Coordinate) => void;
}

const DEFAULT_CENTER: Coordinate = { latitude: 45.4215, longitude: -75.6972 };

/** Mapbox GL metres-per-pixel at zoom 0 on the equator (512 px tiles) */
const METRES_PER_PX_Z0 = 78271.517;

function userGeoJSON(coord: Coordinate | null, accuracy: number | null) {
  const cos = coord ? Math.cos((coord.latitude * Math.PI) / 180) : 1;
  const acc = accuracy && accuracy > 0 ? accuracy : 0;
  return {
    type: 'FeatureCollection' as const,
    features: coord
      ? [{
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [coord.longitude, coord.latitude] },
          properties: {
            r0: acc / (METRES_PER_PX_Z0 * cos),
            r22: acc / ((METRES_PER_PX_Z0 / 2 ** 22) * cos),
          },
        }]
      : [],
  };
}

function pointCollection(coord: Coordinate | null) {
  return {
    type: 'FeatureCollection' as const,
    features: coord
      ? [{
          type: 'Feature' as const,
          geometry: { type: 'Point' as const, coordinates: [coord.longitude, coord.latitude] },
          properties: {},
        }]
      : [],
  };
}

let mapboxPromise: Promise<any> | null = null;

function loadMapbox(): Promise<any> {
  if (mapboxPromise) return mapboxPromise;
  mapboxPromise = new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('Mapbox GL needs a browser'));
      return;
    }
    const win = window as Window & { mapboxgl?: any };
    if (win.mapboxgl) {
      resolve(win.mapboxgl);
      return;
    }
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = MAPBOX_CSS;
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = MAPBOX_JS;
    script.async = true;
    script.onload = () => resolve(win.mapboxgl);
    script.onerror = () => reject(new Error('Mapbox GL failed to load'));
    document.head.appendChild(script);
  });
  return mapboxPromise;
}

export const ParkFreeMapView = forwardRef<ParkFreeMapViewHandle, Props>(({
  userCoordinate,
  userAccuracyMeters = null,
  spots,
  selectedSpotId,
  isCached,
  reportCounts,
  searchMarker,
  parkedCar,
  overlays,
  cityLots,
  showWinterParking,
  takenSpots,
  showTaken,
  onSpotPress,
  onOverlayPress,
  onMapMoved,
  onLongPress,
}, ref) => {
  const containerRef = useRef<View>(null);
  const mapRef = useRef<any>(null);
  const spotsRef = useRef(spots);
  const skipMoveRef = useRef(true);
  const pressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [showOverlays, setShowOverlays] = useState(true);

  spotsRef.current = spots;
  const takenRef = useRef(takenSpots);
  takenRef.current = takenSpots;

  const onSpotPressRef = useRef(onSpotPress);
  const onOverlayPressRef = useRef(onOverlayPress);
  const onMapMovedRef = useRef(onMapMoved);
  const onLongPressRef = useRef(onLongPress);
  onSpotPressRef.current = onSpotPress;
  onOverlayPressRef.current = onOverlayPress;
  // The map is created once; layers read the latest user position from refs
  const userCoordinateRef = useRef(userCoordinate);
  userCoordinateRef.current = userCoordinate;
  const userAccuracyRef = useRef(userAccuracyMeters);
  userAccuracyRef.current = userAccuracyMeters;
  onMapMovedRef.current = onMapMoved;
  onLongPressRef.current = onLongPress;

  useImperativeHandle(ref, () => ({
    flyTo: (latitude: number, longitude: number, zoomLevel = 15) => {
      skipMoveRef.current = true;
      mapRef.current?.flyTo({
        center: [longitude, latitude],
        zoom: zoomLevel,
        essential: true,
      });
    },
  }));

  useEffect(() => {
    let cancelled = false;
    const token = (Constants.expoConfig?.extra?.mapboxAccessToken as string) ?? '';
    const node = containerRef.current as unknown as HTMLElement | null;
    if (!node) return;

    if (!token) {
      setMapError('Mapbox token missing');
      return;
    }

    // mapbox-gl.css sets `.mapboxgl-map { position: relative }`, which beats
    // react-native-web's class-based absolute fill and collapses the map to 0px.
    Object.assign(node.style, { position: 'absolute', top: '0', right: '0', bottom: '0', left: '0' });
    const resizeObserver = new ResizeObserver(() => mapRef.current?.resize());
    resizeObserver.observe(node);

    loadMapbox()
      .then((mapboxgl) => {
        if (cancelled || mapRef.current) return;
        mapboxgl.accessToken = token;
        const map = new mapboxgl.Map({
          container: node,
          style: 'mapbox://styles/mapbox/dark-v11',
          center: [
            (userCoordinate ?? DEFAULT_CENTER).longitude,
            (userCoordinate ?? DEFAULT_CENTER).latitude,
          ],
          zoom: 14,
          attributionControl: true,
        });
        // No zoom buttons: pinch / scroll zoom, and the app's own find-me and
        // add buttons own the bottom-right corner.
        mapRef.current = map;
        // Dev-only handle for poking at the map from the browser console
        if (__DEV__) (window as any).__TEMP_MAP__ = map;
        map.once('load', () => map.resize());

        map.on('load', () => {
          // City layers first so spot pins draw on top
          map.addSource('overlays', {
            type: 'geojson',
            data: { type: 'FeatureCollection', features: [] },
          });
          map.addLayer({
            id: 'overlay-fill',
            type: 'fill',
            source: 'overlays',
            minzoom: OVERLAY_MIN_ZOOM,
            filter: ['==', ['geometry-type'], 'Polygon'],
            paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.35 },
          });
          map.addLayer({
            id: 'overlay-line',
            type: 'line',
            source: 'overlays',
            minzoom: OVERLAY_MIN_ZOOM,
            filter: ['in', ['geometry-type'], ['literal', ['LineString', 'MultiLineString']]],
            layout: { 'line-cap': 'round', 'line-sort-key': LINE_SORT_KEY as any },
            paint: {
              'line-color': ['get', 'color'],
              'line-width': LINE_WIDTH,
              'line-opacity': LINE_OPACITY,
              'line-offset': LINE_OFFSET as any,
            },
          });
          map.addLayer({
            id: 'overlay-lot',
            type: 'circle',
            source: 'overlays',
            filter: ['==', ['get', 'kind'], 'cityLot'],
            paint: {
              'circle-color': ['get', 'color'],
              'circle-radius': 11,
              'circle-stroke-width': 1.5,
              'circle-stroke-color': '#fff',
            },
          });
          map.addLayer({
            id: 'overlay-lot-label',
            type: 'symbol',
            source: 'overlays',
            filter: ['==', ['get', 'kind'], 'cityLot'],
            layout: { 'text-field': ['get', 'label'], 'text-size': 11, 'text-offset': [0, 1.6] },
            paint: { 'text-color': '#fff', 'text-halo-color': '#000', 'text-halo-width': 1 },
          });

          map.addSource('spots', {
            type: 'geojson',
            data: buildSpotsGeoJSON(spotsRef.current, null, {}),
            cluster: true,
            clusterMaxZoom: 15,
            clusterRadius: 40,
          });
          map.addLayer({
            id: 'clusters',
            type: 'circle',
            source: 'spots',
            filter: ['has', 'point_count'],
            paint: {
              'circle-color': ['interpolate', ['linear'], ['get', 'point_count'], 1, '#4CAF50', 6, '#FFB300', 16, '#FF5722'],
              'circle-radius': ['interpolate', ['linear'], ['get', 'point_count'], 1, 18, 20, 28],
              'circle-stroke-width': 2,
              'circle-stroke-color': '#fff',
              'circle-opacity': 1,
            },
          });
          map.addLayer({
            id: 'cluster-count',
            type: 'symbol',
            source: 'spots',
            filter: ['has', 'point_count'],
            layout: {
              'text-field': ['get', 'point_count_abbreviated'],
              'text-size': 13,
            },
            paint: { 'text-color': '#fff' },
          });
          map.addLayer({
            id: 'unclustered',
            type: 'circle',
            source: 'spots',
            filter: ['!', ['has', 'point_count']],
            paint: {
              'circle-color': ['get', 'pinColor'],
              'circle-radius': ['case', ['==', ['get', 'selected'], 1], 14, 9],
              'circle-stroke-width': ['case', ['==', ['get', 'selected'], 1], 3, 2],
              'circle-stroke-color': ['get', 'pinStroke'],
              'circle-opacity': 1,
            },
          });
          // Taken: someone is parked on this street spot right now
          map.addSource('taken', { type: 'geojson', data: buildTakenGeoJSON([]) });
          map.addLayer({
            id: 'taken-dot',
            type: 'circle',
            source: 'taken',
            minzoom: OVERLAY_MIN_ZOOM,
            paint: {
              'circle-color': MAP_COLORS.taken,
              'circle-radius': ['interpolate', ['linear'], ['zoom'], 13, 4, 17, 8],
              'circle-stroke-width': 2,
              'circle-stroke-color': '#fff',
            },
          });
          map.on('click', 'taken-dot', (event: any) => {
            const id = event.features?.[0]?.properties?.id as string | undefined;
            const spot = takenRef.current.find(item => item.id === id);
            if (!spot) return;
            event.originalEvent?.stopPropagation?.();
            onOverlayPressRef.current({
              kind: 'taken',
              until: spot.until ? spot.until.toISOString() : null,
              tapLat: spot.lat,
              tapLng: spot.lng,
            } as OverlayInfo);
          });

          map.addSource('user', {
            type: 'geojson',
            data: userGeoJSON(userCoordinateRef.current, userAccuracyRef.current),
          });
          // Accuracy circle: radius in metres converted to pixels at every zoom
          map.addLayer({
            id: 'user-accuracy',
            type: 'circle',
            source: 'user',
            paint: {
              'circle-color': 'rgba(33,150,243,0.12)',
              'circle-stroke-color': 'rgba(33,150,243,0.4)',
              'circle-stroke-width': 1,
              'circle-radius': [
                'interpolate', ['exponential', 2], ['zoom'],
                0, ['get', 'r0'],
                22, ['get', 'r22'],
              ],
              'circle-pitch-alignment': 'map',
            },
          });
          map.addLayer({
            id: 'user-dot',
            type: 'circle',
            source: 'user',
            paint: {
              'circle-color': '#2196F3',
              'circle-radius': 8,
              'circle-stroke-width': 2,
              'circle-stroke-color': '#fff',
            },
          });
          map.addSource('car', { type: 'geojson', data: pointCollection(null) });
          map.addLayer({
            id: 'car-halo',
            type: 'circle',
            source: 'car',
            paint: {
              'circle-color': 'rgba(255,109,0,0.25)',
              'circle-radius': 22,
              'circle-stroke-width': 2,
              'circle-stroke-color': '#FF6D00',
            },
          });
          map.addLayer({
            id: 'car-dot',
            type: 'circle',
            source: 'car',
            paint: {
              'circle-color': '#FF6D00',
              'circle-radius': 8,
              'circle-stroke-width': 2,
              'circle-stroke-color': '#fff',
            },
          });
          map.addSource('search', { type: 'geojson', data: pointCollection(null) });
          map.addLayer({
            id: 'search-dot',
            type: 'circle',
            source: 'search',
            paint: {
              'circle-color': '#2196F3',
              'circle-radius': 8,
              'circle-stroke-width': 2,
              'circle-stroke-color': '#fff',
            },
          });

          map.on('click', 'clusters', (event: any) => {
            const feature = event.features?.[0];
            const source = map.getSource('spots');
            const clusterId = feature?.properties?.cluster_id;
            if (!source?.getClusterExpansionZoom || clusterId == null) return;
            source.getClusterExpansionZoom(clusterId, (err: Error | null, zoom: number) => {
              if (err) return;
              skipMoveRef.current = true;
              map.easeTo({ center: feature.geometry.coordinates, zoom: zoom + 1 });
            });
          });

          map.on('click', 'unclustered', (event: any) => {
            const spotId = event.features?.[0]?.properties?.id as string | undefined;
            const spot = spotsRef.current.find(item => item.id === spotId);
            if (spot) onSpotPressRef.current(spot);
          });

          // Pins sit on top of city layers, so a pin tap must not also open the layer card
          map.on('click', (event: any) => {
            // Street lines are a few pixels wide; accept taps within TAP_TOLERANCE_PX
            const { x, y } = event.point;
            const box: [[number, number], [number, number]] = [
              [x - TAP_TOLERANCE_PX, y - TAP_TOLERANCE_PX],
              [x + TAP_TOLERANCE_PX, y + TAP_TOLERANCE_PX],
            ];
            const hits = map.queryRenderedFeatures(box, {
              layers: ['taken-dot', 'unclustered', 'clusters', ...OVERLAY_LAYERS].filter(id => map.getLayer(id)),
            });
            const top = hits[0];
            if (!top || !OVERLAY_LAYERS.includes(top.layer.id)) return;
            if (top.properties?.kind) {
              onOverlayPressRef.current({
                ...top.properties,
                tapLat: event.lngLat.lat,
                tapLng: event.lngLat.lng,
              } as OverlayInfo);
            }
          });

          const pointerLayers = ['taken-dot', 'clusters', 'unclustered', 'overlay-line', 'overlay-fill', 'overlay-lot'];
          for (const layerId of pointerLayers) {
            map.on('mouseenter', layerId, () => { map.getCanvas().style.cursor = 'pointer'; });
            map.on('mouseleave', layerId, () => { map.getCanvas().style.cursor = ''; });
          }
          setMapLoaded(true);
        });

        map.on('moveend', () => {
          if (skipMoveRef.current) {
            skipMoveRef.current = false;
            return;
          }
          const center = map.getCenter();
          onMapMovedRef.current({ latitude: center.lat, longitude: center.lng });
        });

        map.on('contextmenu', (event: any) => {
          event.originalEvent?.preventDefault?.();
          onLongPressRef.current({ latitude: event.lngLat.lat, longitude: event.lngLat.lng });
        });

        map.on('mousedown', (event: any) => {
          if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
          const lngLat = event.lngLat;
          pressTimerRef.current = setTimeout(() => {
            onLongPressRef.current({ latitude: lngLat.lat, longitude: lngLat.lng });
          }, 650);
        });
        map.on('mouseup', () => {
          if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
        });
        map.on('movestart', () => {
          if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
        });
      })
      .catch((err: Error) => {
        if (!cancelled) setMapError(err.message);
      });

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      if (pressTimerRef.current) clearTimeout(pressTimerRef.current);
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // Map is created once. Later prop updates go through the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const pushSpots = useCallback(() => {
    const source = mapRef.current?.getSource('spots');
    source?.setData(buildSpotsGeoJSON(spots, selectedSpotId, reportCounts));
    const opacity = isCached ? 0.5 : 1;
    if (mapRef.current?.getLayer('unclustered')) {
      mapRef.current.setPaintProperty('unclustered', 'circle-opacity', opacity);
      mapRef.current.setPaintProperty('clusters', 'circle-opacity', opacity);
    }
  }, [spots, selectedSpotId, reportCounts, isCached]);

  useEffect(() => {
    pushSpots();
  }, [pushSpots, mapLoaded]);

  useEffect(() => {
    if (!mapLoaded) return;
    mapRef.current?.getSource('overlays')?.setData(
      buildOverlayGeoJSON(overlays, cityLots, showWinterParking),
    );
  }, [mapLoaded, overlays, cityLots, showWinterParking]);

  useEffect(() => {
    if (!mapLoaded) return;
    const visibility = showOverlays ? 'visible' : 'none';
    for (const layerId of OVERLAY_LAYERS) {
      mapRef.current?.setLayoutProperty(layerId, 'visibility', visibility);
    }
  }, [mapLoaded, showOverlays]);

  useEffect(() => {
    if (!mapLoaded) return;
    mapRef.current?.getSource('taken')?.setData(buildTakenGeoJSON(takenSpots));
    mapRef.current?.setLayoutProperty('taken-dot', 'visibility', showTaken ? 'visible' : 'none');
  }, [mapLoaded, takenSpots, showTaken]);

  useEffect(() => {
    mapRef.current?.getSource('user')?.setData(userGeoJSON(userCoordinate, userAccuracyMeters));
  }, [mapLoaded, userCoordinate, userAccuracyMeters]);

  useEffect(() => {
    mapRef.current?.getSource('search')?.setData(pointCollection(searchMarker ?? null));
  }, [searchMarker]);

  useEffect(() => {
    mapRef.current?.getSource('car')?.setData(pointCollection(parkedCar ?? null));
  }, [parkedCar, mapLoaded]);

  return (
    <View style={styles.container}>
      <View ref={containerRef} style={styles.map} />
      {mapError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>{mapError}</Text>
        </View>
      )}
      <MapLegend
        showOverlays={showOverlays}
        onToggleOverlays={setShowOverlays}
        showWinterParking={showWinterParking}
      />
    </View>
  );
});

const styles = StyleSheet.create({
  container: { flex: 1 },
  map: { ...StyleSheet.absoluteFillObject },
  errorBanner: {
    position: 'absolute',
    top: 120,
    alignSelf: 'center',
    backgroundColor: '#1A1A1A',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
  },
  errorText: { color: '#F44336', fontSize: 13 },
});
