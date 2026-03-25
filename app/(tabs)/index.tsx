import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  Alert,
  Platform,
  Linking,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ParkFreeMapView } from '../components/ParkFreeMapView';
import { SpotBottomSheet } from '../components/BottomSheet';
import { TimerBar } from '../components/TimerBar';
import { AddSpotModal } from '../components/AddSpotModal';

import { useLocation } from '../hooks/useLocation';
import { useSpots } from '../hooks/useSpots';
import { useSession } from '../hooks/useSession';
import { useTimer } from '../hooks/useTimer';

import { ParkingSpot, Coordinate } from '../types';
import { t } from '../i18n';

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  const { coordinate, permissionStatus, loading: locationLoading, requestPermission } = useLocation();
  const { spots, loading: spotsLoading, error: spotsError, refresh } = useSpots(coordinate);
  const { userId, session, startParking, stopParking, loading: sessionLoading } = useSession();
  const { timer, startTimer, stopTimer } = useTimer();

  const [selectedSpot, setSelectedSpot] = useState<ParkingSpot | null>(null);
  const [addSpotVisible, setAddSpotVisible] = useState(false);
  const [addSpotCoord, setAddSpotCoord] = useState<Coordinate | null>(null);

  // Restore timer when session has a timerMinutes set
  useEffect(() => {
    if (session?.timerMinutes && session.timerMinutes > 0 && session.startTime) {
      startTimer(session.timerMinutes, session.warnMinutes ?? 10, session.startTime);
    }
  }, [session, startTimer]);

  const handleSpotPress = useCallback((spot: ParkingSpot) => {
    setSelectedSpot(spot);
  }, []);

  const handleSheetClose = useCallback(() => {
    setSelectedSpot(null);
  }, []);

  const handleParkHere = useCallback(
    async (timerMinutes?: number, warnMinutes = 10) => {
      if (!selectedSpot) return;
      try {
        await startParking(
          selectedSpot.id,
          selectedSpot.lat,
          selectedSpot.lng,
          timerMinutes,
          warnMinutes,
        );
        if (timerMinutes && timerMinutes > 0) {
          startTimer(timerMinutes, warnMinutes);
        }
        setSelectedSpot(null);
      } catch {
        Alert.alert(t('errors.sessionFailed'), t('errors.retry'));
      }
    },
    [selectedSpot, startParking, startTimer],
  );

  const handleLeave = useCallback(async () => {
    try {
      await stopParking();
      stopTimer();
    } catch {
      Alert.alert(t('errors.sessionFailed'), t('errors.retry'));
    }
  }, [stopParking, stopTimer]);

  const handleMapMoved = useCallback(
    (coord: Coordinate) => {
      refresh(coord);
    },
    [refresh],
  );

  const handleLongPress = useCallback((coord: Coordinate) => {
    setAddSpotCoord(coord);
    setAddSpotVisible(true);
  }, []);

  const handleOpenSettings = useCallback(() => {
    Linking.openSettings();
  }, []);

  // ── Location denied screen ──────────────────────────────────────────────────
  if (permissionStatus === 'denied') {
    return (
      <View style={styles.centerScreen}>
        <Ionicons name="location-outline" size={56} color="#00C853" />
        <Text style={styles.permTitle}>{t('map.locationDenied')}</Text>
        <Text style={styles.permMsg}>{t('map.locationDeniedMessage')}</Text>
        <TouchableOpacity style={styles.settingsBtn} onPress={handleOpenSettings}>
          <Text style={styles.settingsBtnText}>{t('map.openSettings')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // ── Loading screen ──────────────────────────────────────────────────────────
  if (locationLoading && permissionStatus === 'undetermined') {
    return (
      <View style={styles.centerScreen}>
        <ActivityIndicator size="large" color="#00C853" />
        <Text style={styles.loadingText}>{t('map.searchingLocation')}</Text>
      </View>
    );
  }

  return (
    <GestureHandlerRootView style={styles.root}>
      <View style={styles.root}>
        {/* Map */}
        <ParkFreeMapView
          userCoordinate={coordinate}
          spots={spots}
          selectedSpotId={selectedSpot?.id ?? null}
          onSpotPress={handleSpotPress}
          onMapMoved={handleMapMoved}
          onLongPress={handleLongPress}
        />

        {/* Top status bar */}
        <View style={[styles.topBar, { top: insets.top + 12 }]}>
          <View style={styles.topBarLeft}>
            <Text style={styles.appName}>{t('appName')}</Text>
            {spotsLoading && (
              <ActivityIndicator size="small" color="#00C853" style={{ marginLeft: 8 }} />
            )}
          </View>
          {spotsError && (
            <TouchableOpacity
              style={styles.errorChip}
              onPress={() => refresh(coordinate)}
            >
              <Ionicons name="refresh" size={14} color="#F44336" />
              <Text style={styles.errorChipText}>{t('errors.retry')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* FAB — Add Spot */}
        {!session && (
          <TouchableOpacity
            style={[styles.fab, { bottom: insets.bottom + 20 }]}
            onPress={() => {
              setAddSpotCoord(coordinate);
              setAddSpotVisible(true);
            }}
            activeOpacity={0.85}
          >
            <Ionicons name="add" size={28} color="#fff" />
          </TouchableOpacity>
        )}

        {/* Active session timer bar */}
        {session && (
          <View style={{ paddingBottom: insets.bottom }}>
            <TimerBar
              timer={timer}
              sessionStartTime={session.startTime}
              onLeave={handleLeave}
              loading={sessionLoading}
            />
          </View>
        )}

        {/* Spot detail bottom sheet */}
        <SpotBottomSheet
          spot={selectedSpot}
          allSpots={spots}
          userLat={coordinate.latitude}
          userLng={coordinate.longitude}
          onParkHere={handleParkHere}
          onClose={handleSheetClose}
          sessionActive={!!session}
        />

        {/* Add spot modal */}
        <AddSpotModal
          visible={addSpotVisible}
          coordinate={addSpotCoord}
          onClose={() => setAddSpotVisible(false)}
          onSubmitted={() => setAddSpotVisible(false)}
        />
      </View>
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  centerScreen: {
    flex: 1,
    backgroundColor: '#0A0A0A',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    gap: 16,
  },
  permTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    textAlign: 'center',
  },
  permMsg: {
    fontSize: 15,
    color: '#AAA',
    textAlign: 'center',
    lineHeight: 22,
  },
  settingsBtn: {
    backgroundColor: '#00C853',
    borderRadius: 14,
    paddingHorizontal: 28,
    paddingVertical: 14,
    marginTop: 8,
  },
  settingsBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  loadingText: {
    color: '#AAA',
    fontSize: 15,
    marginTop: 12,
  },
  topBar: {
    position: 'absolute',
    left: 16,
    right: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: 'rgba(26,26,26,0.92)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  topBarLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  appName: {
    color: '#00C853',
    fontWeight: '800',
    fontSize: 18,
    letterSpacing: 0.5,
  },
  errorChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(244,67,54,0.12)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  errorChipText: {
    color: '#F44336',
    fontSize: 12,
    fontWeight: '600',
  },
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#00C853',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#00C853',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
});
