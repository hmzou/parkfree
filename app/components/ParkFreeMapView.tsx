import React, { useRef, useCallback, useEffect } from 'react';
import { StyleSheet, View } from 'react-native';
import MapboxGL from '@rnmapbox/maps';
import Constants from 'expo-constants';
import { ParkingSpot, Coordinate } from '../types';
import { SpotPin } from './SpotPin';

MapboxGL.setAccessToken(
  (Constants.expoConfig?.extra?.mapboxAccessToken as string) ?? '',
);

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
  const lastCenter = useRef<Coordinate>(userCoordinate);

  // Fly to user location on first mount
  useEffect(() => {
    cameraRef.current?.setCamera({
      centerCoordinate: [userCoordinate.longitude, userCoordinate.latitude],
      zoomLevel: 15,
      animationDuration: 1000,
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleRegionChange = useCallback(
    (feature: GeoJSON.Feature) => {
      if (!feature.geometry || feature.geometry.type !== 'Point') return;
      const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates;
      const newCoord: Coordinate = { latitude: lat, longitude: lng };
      lastCenter.current = newCoord;
      onMapMoved(newCoord);
    },
    [onMapMoved],
  );

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
        onRegionDidChange={handleRegionChange}
        onLongPress={handleLongPress}
        compassEnabled
        logoEnabled={false}
        attributionEnabled
        attributionPosition={{ bottom: 8, right: 8 }}
      >
        <MapboxGL.Camera
          ref={cameraRef}
          centerCoordinate={[userCoordinate.longitude, userCoordinate.latitude]}
          zoomLevel={15}
          animationMode="flyTo"
          animationDuration={600}
        />

        {/* User location dot */}
        <MapboxGL.UserLocation
          visible
          showsUserHeadingIndicator
          renderMode="native"
        />

        {/* Parking spot pins */}
        {spots.map(spot => (
          <MapboxGL.MarkerView
            key={spot.id}
            id={spot.id}
            coordinate={[spot.lng, spot.lat]}
            anchor={{ x: 0.5, y: 1 }}
          >
            <SpotPin
              spot={spot}
              selected={spot.id === selectedSpotId}
              onPress={() => onSpotPress(spot)}
            />
          </MapboxGL.MarkerView>
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
