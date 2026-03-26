import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ParkFreeMapView } from '../_components/ParkFreeMapView';
import { SpotBottomSheet } from '../_components/BottomSheet';
import { TimerBar } from '../_components/TimerBar';
import { AddSpotModal } from '../_components/AddSpotModal';

import { useLocation } from '../_hooks/useLocation';
import { useSpots } from '../_hooks/useSpots';
import { useSessionContext } from '../_contexts/SessionContext';
import { useLocale } from '../_contexts/LocaleContext';
import { useTimer } from '../_hooks/useTimer';

import { ParkingSpot, Coordinate } from '../_types';
import { t } from '../_i18n';

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  // Subscribe to locale so all t() calls re-evaluate on language switch
  useLocale();

  const { coordinate, permissionStatus, loading: locationLoading, requestPermission } = useLocation();
  const { spots, loading: spotsLoading, isCached, error: spotsError, reportCounts, refresh } = useSpots();
  const { session, startParking, stopParking, loading: sessionLoading } = useSessionContext();
  const { timer, startTimer, stopTimer } = useTimer();

  const [selectedSpot, setSelectedSpot] = useState<ParkingSpot | null>(null);
  const [expandedSpotId, setExpandedSpotId] = useState<string | null>(null);
  const [addSpotVisible, setAddSpotVisible] = useState(false);
  const [addSpotCoord, setAddSpotCoord] = useState<Coordinate | null>(null);

  // "Search this area" pill
  const [searchCoord, setSearchCoord] = useState<Coordinate | null>(null);
  const [showSearchBtn, setShowSearchBtn] = useState(false);

  // One-time initial fetch when GPS resolves
  const initialFetchRef = useRef(false);
  useEffect(() => {
    if (locationLoading || initialFetchRef.current) return;
    initialFetchRef.current = true;
    void refresh(coordinate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [locationLoading, refresh]);

  // Restore timer when session has a timerMinutes set
  useEffect(() => {
    if (!session?.timerMinutes || session.timerMinutes <= 0 || !session.startTime) return;
    startTimer(session.timerMinutes, session.warnMinutes ?? 10, session.startTime);
  }, [
    session?.id,
    session?.timerMinutes,
    session?.warnMinutes,
    session?.startTime?.getTime(),
    startTimer,
  ]);

  const handleSpotPress = useCallback((spot: ParkingSpot) => {
    setSelectedSpot(prev => {
      if (prev?.id === spot.id) {
        setExpandedSpotId(spot.id);
        return prev;
      }
      setExpandedSpotId(null);
      return spot;
    });
  }, []);

  const handleSheetClose = useCallback(() => {
    setSelectedSpot(null);
    setExpandedSpotId(null);
  }, []);

  const handleExpand = useCallback(() => {
    setExpandedSpotId(selectedSpot?.id ?? null);
  }, [selectedSpot?.id]);

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
          selectedSpot.type,
          selectedSpot.city,
        );
        if (timerMinutes && timerMinutes > 0) {
          startTimer(timerMinutes, warnMinutes);
        }
        setSelectedSpot(null);
        setExpandedSpotId(null);
      } catch {
        Alert.alert(t('errors.sessionFailed'), t('errors.retry'));
      }
    },
    [selectedSpot, startParking, startTimer],
  );

  const handleLeave = useCallback(async () => {
    try {
      // hitLimit = true if the countdown reached zero before the user tapped "Leave"
      const timerExpired = timer.active && timer.remainingSeconds === 0;
      await stopParking(timerExpired);
      stopTimer();
    } catch {
      Alert.alert(t('errors.sessionFailed'), t('errors.retry'));
    }
  }, [stopParking, stopTimer, timer]);

  // Map moved: store coord + show "Search" pill. Do NOT auto-search.
  const handleMapMoved = useCallback((coord: Coordinate) => {
    setSearchCoord(coord);
    setShowSearchBtn(true);
  }, []);

  const handleSearchThisArea = useCallback(async () => {
    if (!searchCoord) return;
    setShowSearchBtn(false);
    await refresh(searchCoord);
  }, [searchCoord, refresh]);

  const handleLongPress = useCallback((coord: Coordinate) => {
    setAddSpotCoord(coord);
    setAddSpotVisible(true);
  }, []);

  const handleOpenSettings = useCallback(() => {
    Linking.openSettings();
  }, []);

  // Build a human-readable spot label for the session bar
  const sessionSpotLabel = session
    ? `${
        session.spotType === 'garage'
          ? t('spot.garage')
          : session.spotType === 'lot'
          ? t('spot.lot')
          : t('spot.street')
      } · ${session.spotCity ?? 'Ottawa'}`
    : undefined;

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
  if (locationLoading) {
    return (
      <View style={styles.centerScreen}>
        <ActivityIndicator size="large" color="#00C853" />
        <Text style={styles.loadingText}>{t('map.searchingLocation')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {/* Map */}
      <ParkFreeMapView
        userCoordinate={coordinate}
        spots={spots}
        selectedSpotId={selectedSpot?.id ?? null}
        isCached={isCached}
        reportCounts={reportCounts}
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

      {/* Offline / cached banner — shown when Overpass failed and stale cache is displayed */}
      {isCached && !spotsLoading && (
        <View style={[styles.offlineBanner, { top: insets.top + 56 }]}>
          <Ionicons name="cloud-offline-outline" size={14} color="#FFB300" />
          <Text style={styles.offlineBannerText}>
            {t('errors.fetchFailed')} — showing cached spots
          </Text>
        </View>
      )}

      {/* Empty state — shown after loading when Overpass returned nothing */}
      {!spotsLoading && !spotsError && spots.length === 0 && !isCached && (
        <View style={[styles.emptyBanner, { top: insets.top + 56 }]}>
          <Ionicons name="search-outline" size={14} color="#AAA" />
          <Text style={styles.emptyBannerText}>{t('map.noSpotsFound')}</Text>
        </View>
      )}

      {/* "Search this area" pill */}
      {showSearchBtn && !spotsLoading && (
        <TouchableOpacity
          style={[styles.searchPill, { top: insets.top + 60 }]}
          onPress={handleSearchThisArea}
          activeOpacity={0.88}
        >
          <Ionicons name="search" size={15} color="#111" />
          <Text style={styles.searchPillText}>{t('map.searchThisArea')}</Text>
        </TouchableOpacity>
      )}
      {showSearchBtn && spotsLoading && (
        <View style={[styles.searchPill, styles.searchPillLoading, { top: insets.top + 60 }]}>
          <ActivityIndicator size="small" color="#111" />
          <Text style={styles.searchPillText}>{t('map.searchThisArea')}</Text>
        </View>
      )}

      {/* FAB — Add Spot (hidden during active session) */}
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
        <TimerBar
          timer={timer}
          sessionStartTime={session.startTime}
          spotLabel={sessionSpotLabel}
          onLeave={handleLeave}
          loading={sessionLoading}
        />
      )}

      {/* Spot detail bottom sheet */}
      <SpotBottomSheet
        spot={selectedSpot}
        allSpots={spots}
        userLat={coordinate.latitude}
        userLng={coordinate.longitude}
        expanded={expandedSpotId === selectedSpot?.id}
        onExpand={handleExpand}
        onParkHere={handleParkHere}
        onClose={handleSheetClose}
        sessionActive={!!session}
        reportCounts={reportCounts}
      />

      {/* Add spot modal */}
      <AddSpotModal
        visible={addSpotVisible}
        coordinate={addSpotCoord}
        onClose={() => setAddSpotVisible(false)}
        onSubmitted={() => setAddSpotVisible(false)}
      />
    </View>
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
  offlineBanner: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(255,179,0,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(255,179,0,0.3)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
  },
  offlineBannerText: {
    color: '#FFB300',
    fontSize: 12,
    fontWeight: '500',
  },
  emptyBanner: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(26,26,26,0.9)',
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 20,
  },
  emptyBannerText: {
    color: '#AAA',
    fontSize: 12,
  },
  searchPill: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 9,
    borderRadius: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.25,
    shadowRadius: 6,
    elevation: 6,
  },
  searchPillLoading: {
    opacity: 0.8,
  },
  searchPillText: {
    color: '#111',
    fontWeight: '700',
    fontSize: 14,
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
