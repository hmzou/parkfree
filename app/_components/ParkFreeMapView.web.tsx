/**
 * Web implementation of ParkFreeMapView using Mapbox GL JS.
 * @rnmapbox/maps is native-only; Metro picks this file for web builds.
 * Same props and handle as the native component, so the map screen is shared.
 */
import React, { useRef, useEffect, useMemo, forwardRef, useImperativeHandle } from 'react';
import { StyleSheet, View } from 'react-native';
import mapboxgl from 'mapbox-gl';
import 'mapbox-gl/dist/mapbox-gl.css';
import Constants from 'expo-constants';
import { ParkingSpot, Coordinate } from '../_types';
import { buildGeoJSON } from './spotGeoJSON';
import { MapLegend } from './MapLegend';

mapboxgl.accessToken = (Constants.expoConfig?.extra?.mapboxAccessToken as string) ?? '';

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
  onSpotPress: (spot: ParkingSpot) => void;
  onMapMoved: (coord: Coordinate) => void;
  onLongPress: (coord: Coordinate) => void;
}

function pointCollection(coord: Coordinate | null | undefined): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: coord
      ? [{
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [coord.longitude, coord.latitude] },
          properties: {},
        }]
      : [],
  };
}

export const ParkFreeMapView = forwardRef<ParkFreeMapViewHandle, Props>(({
  userCoordinate,
  spots,
  selectedSpotId,
  isCached,
  reportCounts,
  searchMarker,
  onSpotPress,
  onMapMoved,
  onLongPress,
}, ref) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const loadedRef = useRef(false);

  // Map event handlers are bound once; read the latest props through refs.
  const latest = useRef({ spots, onSpotPress, onMapMoved, onLongPress });
  latest.current = { spots, onSpotPress, onMapMoved, onLongPress };

  useImperativeHandle(ref, () => ({
    flyTo: (latitude: number, longitude: number, zoomLevel = 15) => {
      mapRef.current?.flyTo({ center: [longitude, latitude], zoom: zoomLevel, duration: 800 });
    },
  }));

  const geoJSON = useMemo(
    () => buildGeoJSON(spots, selectedSpotId, reportCounts),
    [spots, selectedSpotId, reportCounts],
  );

  // Point opacity: 0.5 for cached, 1.0 for fresh
  const pointOpacity = isCached ? 0.5 : 1.0;

  // Keep current data in refs so the load handler can seed sources with it.
  const dataRef = useRef({ geoJSON, userCoordinate, searchMarker });
  dataRef.current = { geoJSON, userCoordinate, searchMarker };

  useEffect(() => {
    if (!containerRef.current) return;

    const map = new mapboxgl.Map({
      container: containerRef.current,
      style: 'mapbox://styles/mapbox/dark-v11',
      center: [userCoordinate.longitude, userCoordinate.latitude],
      zoom: 14,
      attributionControl: true,
    });
    mapRef.current = map;
    map.addControl(new mapboxgl.NavigationControl({ showZoom: true, showCompass: true }), 'top-right');

    let moveDebounce: ReturnType<typeof setTimeout> | null = null;

    map.on('load', () => {
      const { geoJSON: initial, userCoordinate: user, searchMarker: search } = dataRef.current;

      map.addSource('spots-source', {
        type: 'geojson',
        data: initial,
        cluster: true,
        clusterMaxZoom: 15,
        clusterRadius: 40,
      });

      map.addLayer({
        id: 'cluster-circle',
        type: 'circle',
        source: 'spots-source',
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': ['interpolate', ['linear'], ['get', 'point_count'], 1, '#4CAF50', 6, '#FFB300', 16, '#FF5722'],
          'circle-radius': ['interpolate', ['linear'], ['get', 'point_count'], 1, 18, 20, 28],
          'circle-stroke-color': '#fff',
          'circle-stroke-width': 2,
        },
      });
      map.addLayer({
        id: 'cluster-count',
        type: 'symbol',
        source: 'spots-source',
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-size': 13,
          'text-allow-overlap': true,
        },
        paint: { 'text-color': '#fff' },
      });
      map.addLayer({
        id: 'unclustered-point',
        type: 'circle',
        source: 'spots-source',
        filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['get', 'pinColor'],
          'circle-radius': ['case', ['==', ['get', 'selected'], 1], 14, 9],
          'circle-stroke-color': '#fff',
          'circle-stroke-width': ['case', ['==', ['get', 'selected'], 1], 3, 2],
        },
      });

      // User location dot
      map.addSource('user-source', { type: 'geojson', data: pointCollection(user) });
      map.addLayer({
        id: 'user-halo',
        type: 'circle',
        source: 'user-source',
        paint: { 'circle-color': 'rgba(0,200,83,0.2)', 'circle-radius': 16 },
      });
      map.addLayer({
        id: 'user-dot',
        type: 'circle',
        source: 'user-source',
        paint: { 'circle-color': '#00C853', 'circle-radius': 7, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
      });

      // Search location marker
      map.addSource('search-marker-source', { type: 'geojson', data: pointCollection(search) });
      map.addLayer({
        id: 'search-marker-halo',
        type: 'circle',
        source: 'search-marker-source',
        paint: {
          'circle-color': 'rgba(33,150,243,0.2)',
          'circle-radius': 22,
          'circle-stroke-color': 'rgba(33,150,243,0.6)',
          'circle-stroke-width': 2,
        },
      });
      map.addLayer({
        id: 'search-marker-dot',
        type: 'circle',
        source: 'search-marker-source',
        paint: { 'circle-color': '#2196F3', 'circle-radius': 8, 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 },
      });

      loadedRef.current = true;
    });

    // Cluster tap → zoom in
    map.on('click', 'cluster-circle', e => {
      const feature = e.features?.[0];
      if (!feature) return;
      const center = (feature.geometry as GeoJSON.Point).coordinates as [number, number];
      const source = map.getSource('spots-source') as mapboxgl.GeoJSONSource;
      source.getClusterExpansionZoom(feature.properties?.cluster_id, (err, zoom) => {
        map.easeTo({ center, zoom: err || zoom == null ? 16 : zoom + 1, duration: 400 });
      });
    });

    // Individual point tap
    map.on('click', 'unclustered-point', e => {
      const spotId = e.features?.[0]?.properties?.id as string | undefined;
      const spot = latest.current.spots.find(s => s.id === spotId);
      if (spot) latest.current.onSpotPress(spot);
    });

    for (const layer of ['cluster-circle', 'unclustered-point']) {
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    }

    // Right-click (or long-press on touch) stands in for native long-press
    map.on('contextmenu', e => {
      latest.current.onLongPress({ latitude: e.lngLat.lat, longitude: e.lngLat.lng });
    });

    map.on('moveend', () => {
      const c = map.getCenter();
      if (moveDebounce) clearTimeout(moveDebounce);
      moveDebounce = setTimeout(() => {
        latest.current.onMapMoved({ latitude: c.lat, longitude: c.lng });
      }, 450);
    });

    return () => {
      if (moveDebounce) clearTimeout(moveDebounce);
      loadedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    (map.getSource('spots-source') as mapboxgl.GeoJSONSource | undefined)?.setData(geoJSON);
  }, [geoJSON]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    (map.getSource('user-source') as mapboxgl.GeoJSONSource | undefined)?.setData(pointCollection(userCoordinate));
  }, [userCoordinate]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    (map.getSource('search-marker-source') as mapboxgl.GeoJSONSource | undefined)?.setData(pointCollection(searchMarker));
  }, [searchMarker]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current) return;
    for (const layer of ['cluster-circle', 'unclustered-point']) {
      map.setPaintProperty(layer, 'circle-opacity', pointOpacity);
      map.setPaintProperty(layer, 'circle-stroke-opacity', pointOpacity);
    }
  }, [pointOpacity]);

  return (
    <View style={styles.container}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      {/* Pin color legend */}
      <MapLegend />
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
