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

import { ParkFreeMapView, ParkFreeMapViewHandle } from '../_components/ParkFreeMapView';
import { SpotBottomSheet } from '../_components/BottomSheet';
import { TimerBar } from '../_components/TimerBar';
import { AddSpotModal } from '../_components/AddSpotModal';
import { LocationSearchBar } from '../_components/LocationSearchBar';
import { SearchResultCard } from '../_components/SearchResultCard';

import { useLocation } from '../_hooks/useLocation';
import { useSpots } from '../_hooks/useSpots';
import { useSessionContext } from '../_contexts/SessionContext';
import { useLocale } from '../_contexts/LocaleContext';
import { useTimer } from '../_hooks/useTimer';

import { ParkingSpot, Coordinate } from '../_types';
import { t } from '../_i18n';
import { nearestFreeSpots } from '../_services/overpass';
import { GeocodingResult, geocodeAddress } from '../_services/geocoding';
import {
  getBusinessParking,
  subscribeToLotOccupancy,
  BusinessParkingRecord,
} from '../_services/businessParking';
import { fetchFreeParkingSpots } from '../_services/overpass';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface SearchState {
  result: GeocodingResult;
  nearestSpot: ParkingSpot | null;
}

interface BusinessOccupancyState {
  record: BusinessParkingRecord;
  activeCount: number;
}

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  // Subscribe to locale so all t() calls re-evaluate on language switch
  useLocale();

  const { coordinate, permissionStatus, loading: locationLoading, requestPermission } = useLocation();
  const { spots, loading: spotsLoading, isCached, error: spotsError, reportCounts, refresh } = useSpots();
  const { session, startParking, stopParking, loading: sessionLoading } = useSessionContext();
  const { timer, startTimer, stopTimer } = useTimer();

  const mapRef = useRef<ParkFreeMapViewHandle>(null);

  const [selectedSpot, setSelectedSpot] = useState<ParkingSpot | null>(null);
  const [expandedSpotId, setExpandedSpotId] = useState<string | null>(null);
  const [addSpotVisible, setAddSpotVisible] = useState(false);
  const [addSpotCoord, setAddSpotCoord] = useState<Coordinate | null>(null);

  // "Search this area" pill
  const [searchCoord, setSearchCoord] = useState<Coordinate | null>(null);
  const [showSearchBtn, setShowSearchBtn] = useState(false);

  // ── Location search state ────────────────────────────────────────────────────
  const [searchState, setSearchState] = useState<SearchState | null>(null);
  const [searchMarker, setSearchMarker] = useState<Coordinate | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);

  // ── Business occupancy state ──────────────────────────────────────────────────
  const [businessOccupancy, setBusinessOccupancy] = useState<BusinessOccupancyState | null>(null);
  const lotUnsubRef = useRef<(() => void) | null>(null);

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

  // Cleanup lot occupancy subscription on unmount
  useEffect(() => {
    return () => {
      lotUnsubRef.current?.();
    };
  }, []);

  // ── Search result handler ────────────────────────────────────────────────────

  const handleSearchSelect = useCallback(
    async (result: GeocodingResult) => {
      setSearchLoading(true);
      setSearchState(null);
      setBusinessOccupancy(null);

      // Unsubscribe previous lot watcher
      lotUnsubRef.current?.();
      lotUnsubRef.current = null;

      try {
        const searchCoordinate: Coordinate = {
          latitude: result.latitude,
          longitude: result.longitude,
        };

        // Fly map to the searched location
        mapRef.current?.flyTo(result.latitude, result.longitude, 15);
        setSearchMarker(searchCoordinate);

        // Fetch fresh spots around the searched location (in parallel with business lookup)
        const [freshSpots] = await Promise.all([
          fetchFreeParkingSpots(result.latitude, result.longitude, 1500).catch(() => spots),
        ]);

        const spotsToSearch = freshSpots.length > 0 ? freshSpots : spots;

        // Find the nearest free spot to the searched location
        const nearest = nearestFreeSpots(spotsToSearch, result.latitude, result.longitude, 1);
        const nearestSpot = nearest[0] ?? null;

        setSearchState({ result, nearestSpot });

        // If the result is a business POI, look up associated parking
        if (result.isBusiness) {
          try {
            const businessRecord = await getBusinessParking(result.shortName);

            if (businessRecord) {
              // Subscribe to live occupancy for this lot
              const unsub = subscribeToLotOccupancy(businessRecord.spotId, (activeCount) => {
                setBusinessOccupancy({ record: businessRecord, activeCount });
              });
              lotUnsubRef.current = unsub;

              // Also select the linked spot on the map if present
              const linkedSpot = spotsToSearch.find(s => s.id === businessRecord.spotId);
              if (linkedSpot) {
                setSelectedSpot(linkedSpot);
                setExpandedSpotId(null);
              }
            }
          } catch {
            // Business parking lookup is non-fatal
          }
        }
      } catch {
        // Geocoding or spot fetch failed — show whatever spots we have locally
        const nearest = nearestFreeSpots(spots, result.latitude, result.longitude, 1);
        setSearchState({ result, nearestSpot: nearest[0] ?? null });
      } finally {
        setSearchLoading(false);
      }
    },
    [spots],
  );

  const handleDismissSearchResult = useCallback(() => {
    setSearchState(null);
    setSearchMarker(null);
    setBusinessOccupancy(null);
    lotUnsubRef.current?.();
    lotUnsubRef.current = null;
  }, []);

  // ── Spot interactions ────────────────────────────────────────────────────────

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

  const handleSelectNearestSpot = useCallback((spot: ParkingSpot) => {
    setSelectedSpot(spot);
    setExpandedSpotId(null);
    mapRef.current?.flyTo(spot.lat, spot.lng, 16);
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

  // Business occupancy for the selected spot's bottom sheet
  const spotBusinessOccupancy =
    businessOccupancy && selectedSpot?.id === businessOccupancy.record.spotId
      ? { activeCount: businessOccupancy.activeCount, capacity: businessOccupancy.record.capacity }
      : null;

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
        ref={mapRef}
        userCoordinate={coordinate}
        spots={spots}
        selectedSpotId={selectedSpot?.id ?? null}
        isCached={isCached}
        reportCounts={reportCounts}
        searchMarker={searchMarker}
        onSpotPress={handleSpotPress}
        onMapMoved={handleMapMoved}
        onLongPress={handleLongPress}
      />

      {/* ── Top overlay: app name + search bar ─────────────────────────────── */}
      <View style={[styles.topOverlay, { top: insets.top + 8 }]}>
        {/* App name row */}
        <View style={styles.appNameRow}>
          <Text style={styles.appName}>{t('appName')}</Text>
          {spotsLoading && (
            <ActivityIndicator size="small" color="#00C853" style={{ marginLeft: 8 }} />
          )}
          {searchLoading && (
            <ActivityIndicator size="small" color="#2196F3" style={{ marginLeft: 8 }} />
          )}
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

        {/* Search bar */}
        <LocationSearchBar onSelectResult={handleSearchSelect} />
      </View>

      {/* Offline / cached banner */}
      {isCached && !spotsLoading && (
        <View style={[styles.offlineBanner, { top: insets.top + 106 }]}>
          <Ionicons name="cloud-offline-outline" size={14} color="#FFB300" />
          <Text style={styles.offlineBannerText}>
            {t('errors.fetchFailed')} — showing cached spots
          </Text>
        </View>
      )}

      {/* Empty state */}
      {!spotsLoading && !spotsError && spots.length === 0 && !isCached && !searchState && (
        <View style={[styles.emptyBanner, { top: insets.top + 106 }]}>
          <Ionicons name="search-outline" size={14} color="#AAA" />
          <Text style={styles.emptyBannerText}>{t('map.noSpotsFound')}</Text>
        </View>
      )}

      {/* "Search this area" pill */}
      {showSearchBtn && !spotsLoading && (
        <TouchableOpacity
          style={[styles.searchPill, { top: insets.top + 112 }]}
          onPress={handleSearchThisArea}
          activeOpacity={0.88}
        >
          <Ionicons name="search" size={15} color="#111" />
          <Text style={styles.searchPillText}>{t('map.searchThisArea')}</Text>
        </TouchableOpacity>
      )}
      {showSearchBtn && spotsLoading && (
        <View style={[styles.searchPill, styles.searchPillLoading, { top: insets.top + 112 }]}>
          <ActivityIndicator size="small" color="#111" />
          <Text style={styles.searchPillText}>{t('map.searchThisArea')}</Text>
        </View>
      )}

      {/* Search result card */}
      {searchState && !searchLoading && (
        <View style={[styles.searchResultContainer, { top: insets.top + 114 }]}>
          <SearchResultCard
            searchedLat={searchState.result.latitude}
            searchedLng={searchState.result.longitude}
            searchedName={searchState.result.shortName}
            nearestSpot={searchState.nearestSpot}
            onDismiss={handleDismissSearchResult}
            onSelectSpot={handleSelectNearestSpot}
          />
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
        businessOccupancy={spotBusinessOccupancy}
        onSelectNearestSpot={handleSelectNearestSpot}
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
  // ── Top overlay (app name + search bar) ────────────────────────────────────
  topOverlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    gap: 8,
  },
  appNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(26,26,26,0.92)',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  appName: {
    color: '#00C853',
    fontWeight: '800',
    fontSize: 18,
    letterSpacing: 0.5,
    flex: 1,
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
  // ── Banners ─────────────────────────────────────────────────────────────────
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
  // ── Search this area pill ───────────────────────────────────────────────────
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
  // ── Search result card ──────────────────────────────────────────────────────
  searchResultContainer: {
    position: 'absolute',
    left: 16,
    right: 16,
  },
  // ── FAB ─────────────────────────────────────────────────────────────────────
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
