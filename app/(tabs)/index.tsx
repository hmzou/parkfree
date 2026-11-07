import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  Linking,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ParkFreeMapView, ParkFreeMapViewHandle } from '../_components/ParkFreeMapView';
import { SpotBottomSheet } from '../_components/BottomSheet';
import { TimerBar } from '../_components/TimerBar';
import { AddSpotModal } from '../_components/AddSpotModal';
import { LocationSearchBar } from '../_components/LocationSearchBar';
import { LanguageToggle } from '../_components/LanguagePicker';
import { SearchResultCard } from '../_components/SearchResultCard';
import { StayFinder } from '../_components/StayFinder';
import { OverlayInfoCard, streetUntilText } from '../_components/OverlayInfoCard';
import { buildSpotRecord, buildStreetRecord } from '../_services/parkingRecord';
import { WinterBanner } from '../_components/WinterBanner';
import { DirectionsModal } from '../_components/DirectionsModal';
import { MAP_COLORS, type OverlayInfo } from '../_components/mapStyle';
import { router } from 'expo-router';

import { useLocation } from '../_hooks/useLocation';
import { useSpots } from '../_hooks/useSpots';
import { useWinter } from '../_hooks/useWinter';
import { useSessionContext } from '../_contexts/SessionContext';
import { useLocale } from '../_contexts/LocaleContext';
import { useTimer } from '../_hooks/useTimer';
import { useParkedCar } from '../_hooks/useParkedCar';

import { ParkingSpot, Coordinate } from '../_types';
import { t } from '../_i18n';
import { detectCity, haversineMeters, nearestFreeSpots } from '../_services/overpass';
import { nearestFreeStreet, NearestStreet, prettyRoad } from '../_services/nearestStreet';
import { formatWhen } from '../_i18n/time';
import { GeocodingResult } from '../_services/geocoding';
import { CityLot, fetchCityLots } from '../_services/cityLots';
import { parkedCarCoordinate } from '../_services/parkedCar';
import {
  getBusinessParking,
  subscribeToLotOccupancy,
  BusinessParkingRecord,
} from '../_services/businessParking';

// ─── Types ─────────────────────────────────────────────────────────────────────

interface SearchState {
  result: GeocodingResult;
  nearestSpot: ParkingSpot | null;
}

interface BusinessOccupancyState {
  record: BusinessParkingRecord;
  activeCount: number;
}

const CITY_LOTS_REFRESH_MS = 5 * 60 * 1000;

export default function MapScreen() {
  const insets = useSafeAreaInsets();
  // Subscribe to locale so all t() calls re-evaluate on language switch
  useLocale();

  const {
    coordinate,
    permissionStatus,
    loading: locationLoading,
    locating,
    hasFix,
    accuracyMeters,
    requestPermission,
  } = useLocation();

  // Jump to the user once, when their first real position arrives (it can come
  // after the map has already opened on the downtown fallback)
  const centeredOnFixRef = useRef(false);
  useEffect(() => {
    if (!hasFix || centeredOnFixRef.current) return;
    centeredOnFixRef.current = true;
    mapRef.current?.flyTo(coordinate.latitude, coordinate.longitude, 16);
  }, [hasFix, coordinate.latitude, coordinate.longitude]);

  const handleLocateMe = useCallback(() => {
    if (hasFix) mapRef.current?.flyTo(coordinate.latitude, coordinate.longitude, 16);
    else void requestPermission();
  }, [hasFix, coordinate.latitude, coordinate.longitude, requestPermission]);
  const winter = useWinter();
  const {
    spots,
    overlays,
    takenSpots,
    coversRegion,
    loading: spotsLoading,
    isCached,
    error: spotsError,
    reportCounts,
    now,
    dataAsOf,
    refresh,
  } = useSpots({ ottawaBanLikely: !!winter.heavySnow });
  const { session, startParking, stopParking, loading: sessionLoading } = useSessionContext();
  const { timer, startTimer, stopTimer } = useTimer();
  const { car, remember, forget } = useParkedCar();

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

  const [cityLots, setCityLots] = useState<CityLot[]>([]);
  const [overlayInfo, setOverlayInfo] = useState<OverlayInfo | null>(null);
  const [stayFinderVisible, setStayFinderVisible] = useState(false);
  const [confirmedOnly, setConfirmedOnly] = useState(false);
  const [freeNow, setFreeNow] = useState(false);
  const [showTaken, setShowTaken] = useState(true);
  const [carDirections, setCarDirections] = useState(false);

  const visibleSpots = useMemo(
    () => spots.filter(s => {
      if (confirmedOnly && s.feeUnknown) return false;
      // "Free right now" hides spots that are taken, banned, or not confirmed free
      if (freeNow && (s.occupied || !s.rule || s.rule.level === 'banned' || s.rule.level === 'unclear')) return false;
      return true;
    }),
    [spots, confirmedOnly, freeNow],
  );
  const parkedCoord = parkedCarCoordinate(car);

  // An active session is the car location, including after the app restarts
  // (keeps the saved label, e.g. the street name, when it is the same spot)
  useEffect(() => {
    if (!session || car?.spotId === session.spotId) return;
    void remember({
      lat: session.lat,
      lng: session.lng,
      label: `${t(`spot.${session.spotType ?? 'street'}`)} · ${session.spotCity ?? ''}`,
      spotId: session.spotId,
    });
  }, [session, car?.spotId, remember]);
  // Where the user is looking: the last map centre, or their location
  const viewCenter = searchCoord ?? coordinate;

  // The everyday answer: closest free street to you (or to the place searched).
  // Rounded so small GPS jitter doesn't redo the scan.
  const glanceFrom = searchCoord ?? (hasFix ? coordinate : null);
  const glanceKey = glanceFrom
    ? `${glanceFrom.latitude.toFixed(4)},${glanceFrom.longitude.toFixed(4)}`
    : null;
  const searchNearestStreet = useMemo(
    () => (searchState
      ? nearestFreeStreet(overlays, { latitude: searchState.result.latitude, longitude: searchState.result.longitude })
      : null),
    [searchState, overlays],
  );

  const nearestStreet = useMemo(
    () => (glanceFrom ? nearestFreeStreet(overlays, glanceFrom) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [glanceKey, overlays],
  );

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetchCityLots()
        .then(lots => { if (!cancelled) setCityLots(lots); })
        .catch(err => console.warn('City lots unavailable:', err));
    };
    load();
    const id = setInterval(load, CITY_LOTS_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

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

        const freshSpots = await refresh(searchCoordinate, { force: true, radiusMeters: 1500 });
        // The region dataset is already merged with rules and occupancy in `spots`
        const spotsToSearch = coversRegion ? spots : (freshSpots ?? spots);

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
    [spots, refresh, coversRegion],
  );

  const handleDismissSearchResult = useCallback(() => {
    setSearchState(null);
    setSearchMarker(null);
    setBusinessOccupancy(null);
    lotUnsubRef.current?.();
    lotUnsubRef.current = null;
  }, []);

  // ── Spot interactions ────────────────────────────────────────────────────────

  const handleOverlayPress = useCallback((info: OverlayInfo) => {
    setSearchState(null);
    setOverlayInfo(info);
  }, []);

  const handleStaySelect = useCallback((spot: ParkingSpot) => {
    setStayFinderVisible(false);
    setSelectedSpot(spot);
    setExpandedSpotId(spot.id);
    mapRef.current?.flyTo(spot.lat, spot.lng, 16);
  }, []);

  const handleSpotPress = useCallback((spot: ParkingSpot) => {
    setOverlayInfo(null);
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
      const spotLabel = `${t(`spot.${selectedSpot.type}`)} · ${selectedSpot.city}`;
      await remember({
        lat: selectedSpot.lat,
        lng: selectedSpot.lng,
        label: spotLabel,
        spotId: selectedSpot.id,
      });
      const rule = selectedSpot.rule;
      const verdict = rule?.level === 'banned' && rule.allowedFrom
        ? t('overlay.bannedUntil', { time: formatWhen(rule.allowedFrom) })
        : rule?.leaveBy
          ? t('overlay.untilTime', { time: formatWhen(rule.leaveBy) })
          : selectedSpot.feeRequired ? t('map.legendStreetPaid') : t('overlay.noTimeLimit');
      const record = buildSpotRecord(selectedSpot, verdict, { accuracyMeters: null, dataAsOf });
      try {
        await startParking(
          selectedSpot.id,
          selectedSpot.lat,
          selectedSpot.lng,
          timerMinutes,
          warnMinutes,
          selectedSpot.type,
          selectedSpot.city,
          record,
        );
        if (timerMinutes && timerMinutes > 0) {
          startTimer(timerMinutes, warnMinutes);
        }
        setSelectedSpot(null);
        setExpandedSpotId(null);
      } catch {
        Alert.alert(t('errors.sessionFailed'), t('errors.carSavedAnyway'));
      }
    },
    [selectedSpot, startParking, startTimer, remember, dataAsOf],
  );

  /**
   * "I parked here" on a street line. The car is where the phone is when it has
   * a fix near the tapped street, otherwise where the user tapped.
   */
  const handleParkOnStreet = useCallback(async (info: OverlayInfo, timerMinutes: number) => {
    const tapLat = Number(info.tapLat);
    const tapLng = Number(info.tapLng);
    if (!Number.isFinite(tapLat) || !Number.isFinite(tapLng)) return;
    const nearTap = hasFix
      && haversineMeters(coordinate.latitude, coordinate.longitude, tapLat, tapLng) < 200;
    const lat = nearTap ? coordinate.latitude : tapLat;
    const lng = nearTap ? coordinate.longitude : tapLng;
    const city = detectCity(lat, lng) === 'Gatineau' ? 'Gatineau' : 'Ottawa';
    const road = prettyRoad(info.road) ?? t('spot.street');
    const spotId = `street_${lat.toFixed(5)}_${lng.toFixed(5)}`;
    await remember({ lat, lng, label: `${road} · ${city}`, spotId });
    setOverlayInfo(null);
    const verdict = info.kind === 'paid'
      ? t('record.verdictPaid', { hours: String(info.maxStayHours ?? '?') })
      : streetUntilText(info);
    const record = buildStreetRecord({ ...info, city: info.city ?? city }, verdict, {
      positionSource: nearTap ? 'gps' : 'map',
      accuracyMeters: nearTap ? accuracyMeters ?? null : null,
      dataAsOf,
    });
    try {
      // 0 = no time limit here (e.g. Gatineau outside the winter ban): no reminder
      await startParking(spotId, lat, lng, timerMinutes > 0 ? timerMinutes : undefined, 10, 'street', city, record);
      if (timerMinutes > 0) startTimer(timerMinutes, 10);
    } catch {
      Alert.alert(t('errors.sessionFailed'), t('errors.carSavedAnyway'));
    }
  }, [hasFix, coordinate.latitude, coordinate.longitude, accuracyMeters, dataAsOf, remember, startParking, startTimer]);

  /** Fly to a street and open its card, as if the user had tapped the line. */
  const handleSelectStreet = useCallback((street: NearestStreet) => {
    mapRef.current?.flyTo(street.lat, street.lng, 17);
    setSearchState(null);
    setOverlayInfo({
      ...(street.properties as OverlayInfo),
      kind: street.kind,
      tapLat: street.lat,
      tapLng: street.lng,
    });
  }, []);

  const handleToggleRememberCar = useCallback(async () => {
    if (!selectedSpot) return;
    if (car?.spotId === selectedSpot.id) {
      await forget();
      Alert.alert(t('car.forgotten'));
      return;
    }
    await remember({
      lat: selectedSpot.lat,
      lng: selectedSpot.lng,
      label: `${t(`spot.${selectedSpot.type}`)} · ${selectedSpot.city}`,
      spotId: selectedSpot.id,
    });
    Alert.alert(t('car.saved'), t('car.savedHint'));
  }, [selectedSpot, car?.spotId, remember, forget]);

  const handleFindCar = useCallback(() => {
    if (!car) return;
    mapRef.current?.flyTo(car.lat, car.lng, 16);
    setCarDirections(true);
  }, [car]);

  const handleLeave = useCallback(async () => {
    try {
      // hitLimit = true if the countdown reached zero before the user tapped "Leave"
      const timerExpired = timer.active && timer.remainingSeconds === 0;
      await stopParking(timerExpired);
      await forget();
      stopTimer();
    } catch {
      Alert.alert(t('errors.sessionFailed'), t('errors.retry'));
    }
  }, [stopParking, stopTimer, timer, forget]);

  // Map moved: store coord + show "Search" pill. Do NOT auto-search.
  const handleMapMoved = useCallback((coord: Coordinate) => {
    setSearchCoord(coord);
    setShowSearchBtn(true);
  }, []);

  const handleSearchThisArea = useCallback(async () => {
    if (!searchCoord) return;
    setShowSearchBtn(false);
    await refresh(searchCoord, { force: true });
  }, [searchCoord, refresh]);

  const handleLongPress = useCallback((coord: Coordinate) => {
    setAddSpotCoord(coord);
    setAddSpotVisible(true);
  }, []);

  // Web can re-prompt; native apps must send the user to Settings once denied.
  const handleEnableLocation = useCallback(() => {
    if (Platform.OS === 'web') void requestPermission();
    else void Linking.openSettings();
  }, [requestPermission]);

  // Build a human-readable spot label for the session bar
  // The car's saved label names the street ("Glebe Ave · Ottawa") when parked on one
  const sessionSpotLabel = session && car?.spotId === session.spotId
    ? car.label
    : session
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
        userCoordinate={hasFix ? coordinate : null}
        userAccuracyMeters={accuracyMeters}
        spots={visibleSpots}
        selectedSpotId={selectedSpot?.id ?? null}
        isCached={isCached}
        reportCounts={reportCounts}
        searchMarker={searchMarker}
        parkedCar={parkedCoord}
        overlays={overlays}
        cityLots={cityLots}
        showWinterParking={winter.ottawaSeason}
        takenSpots={takenSpots}
        showTaken={showTaken && !freeNow}
        onSpotPress={handleSpotPress}
        onOverlayPress={handleOverlayPress}
        onMapMoved={handleMapMoved}
        onLongPress={handleLongPress}
      />

      {/* ── Top overlay: app name, search, filters and cards, stacked ─────── */}
      <View style={[styles.topOverlay, { top: insets.top + 8 }]} pointerEvents="box-none">
        {/* Search bar */}
        <View style={styles.searchRow} pointerEvents="box-none">
          <View style={styles.searchFlex}>
            <LocationSearchBar onSelectResult={handleSearchSelect} />
          </View>
          <LanguageToggle />
        </View>

        {/* Quick actions */}
        <View style={styles.chipRow} pointerEvents="box-none">
          {(spotsLoading || searchLoading) && (
            <View style={styles.chip}>
              <ActivityIndicator size="small" color={searchLoading ? '#2196F3' : '#00C853'} />
            </View>
          )}
          {spotsError && (
            <TouchableOpacity
              style={styles.errorChip}
              onPress={() => { void refresh(coordinate, { force: true }); }}
            >
              <Ionicons name="refresh" size={14} color="#F44336" />
              <Text style={styles.errorChipText}>{t('errors.retry')}</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.chip}
            onPress={() => setStayFinderVisible(true)}
            activeOpacity={0.85}
          >
            <Ionicons name="hourglass-outline" size={14} color="#00C853" />
            <Text style={styles.chipText}>{t('map.stayFor')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.chip, freeNow && styles.chipActive]}
            onPress={() => setFreeNow(v => !v)}
            activeOpacity={0.85}
          >
            <Ionicons
              name={freeNow ? 'checkmark-circle' : 'leaf-outline'}
              size={14}
              color={freeNow ? '#111' : '#00C853'}
            />
            <Text style={[styles.chipText, freeNow && styles.chipTextActive]}>
              {t('map.freeNow')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.chip, confirmedOnly && styles.chipActive]}
            onPress={() => setConfirmedOnly(v => !v)}
            activeOpacity={0.85}
          >
            <Ionicons
              name={confirmedOnly ? 'checkmark-circle' : 'checkmark-circle-outline'}
              size={14}
              color={confirmedOnly ? '#111' : '#00C853'}
            />
            <Text style={[styles.chipText, confirmedOnly && styles.chipTextActive]}>
              {t('map.confirmedOnly')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.chip, showTaken && styles.chipTakenActive]}
            onPress={() => setShowTaken(v => !v)}
            activeOpacity={0.85}
            accessibilityState={{ selected: showTaken }}
          >
            <View style={[styles.takenDot, !showTaken && { opacity: 0.35 }]} />
            <Text style={styles.chipText}>
              {takenSpots.length > 0 ? t('map.takenCount', { count: takenSpots.length }) : t('map.taken')}
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.chip}
            onPress={() => router.push('/ambassador')}
            activeOpacity={0.85}
          >
            <Ionicons name="camera-outline" size={14} color="#00C853" />
            <Text style={styles.chipText}>{t('map.photoSign')}</Text>
          </TouchableOpacity>
          {car && !session && (
            <TouchableOpacity style={styles.chip} onPress={handleFindCar} activeOpacity={0.85}>
              <Ionicons name="car-sport-outline" size={14} color="#FF6D00" />
              <Text style={styles.chipText}>{t('map.findCar')}</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Permission granted but no position: the OS or browser is still
            blocking location. Say so instead of pretending you're downtown. */}
        {permissionStatus === 'granted' && !hasFix && !locationLoading && (
          <TouchableOpacity style={styles.offlineBanner} onPress={handleLocateMe} disabled={locating} activeOpacity={0.85}>
            <Ionicons name="warning-outline" size={14} color="#FFB300" />
            <Text style={[styles.offlineBannerText, { flex: 1 }]} numberOfLines={2}>
              {t(Platform.OS === 'web' ? 'map.noFixWeb' : 'map.noFix')}
            </Text>
            <Text style={styles.locationEnableText}>{t('errors.retry')}</Text>
          </TouchableOpacity>
        )}

        {/* Without location the map still works, centred on downtown Ottawa */}
        {permissionStatus === 'denied' && (
          <TouchableOpacity style={styles.offlineBanner} onPress={handleEnableLocation} activeOpacity={0.85}>
            <Ionicons name="location-outline" size={14} color="#00C853" />
            <Text style={[styles.offlineBannerText, { flex: 1 }]} numberOfLines={1}>{t('map.locationOff')}</Text>
            <Text style={styles.locationEnableText}>{t('map.enableLocation')}</Text>
          </TouchableOpacity>
        )}

        <WinterBanner
          status={winter}
          nearGatineau={detectCity(viewCenter.latitude, viewCenter.longitude) === 'Gatineau'}
          now={now}
        />

        {/* Offline / cached banner */}
        {isCached && !spotsLoading && (
          <View style={styles.offlineBanner}>
            <Ionicons name="cloud-offline-outline" size={14} color="#FFB300" />
            <Text style={styles.offlineBannerText}>
              {t('errors.fetchFailed')} — {t('errors.showingCached')}
            </Text>
          </View>
        )}

        {/* Empty state */}
        {!spotsLoading && !spotsError && spots.length === 0 && !isCached && !searchState && (
          <View style={styles.emptyBanner}>
            <Ionicons name="search-outline" size={14} color="#AAA" />
            <Text style={styles.emptyBannerText}>{t('map.noSpotsFound')}</Text>
          </View>
        )}

        {/* "Search this area" pill — only needed without the region dataset */}
        {!coversRegion && showSearchBtn && !spotsLoading && (
          <TouchableOpacity
            style={styles.searchPill}
            onPress={handleSearchThisArea}
            activeOpacity={0.88}
          >
            <Ionicons name="search" size={15} color="#111" />
            <Text style={styles.searchPillText}>{t('map.searchThisArea')}</Text>
          </TouchableOpacity>
        )}
        {!coversRegion && showSearchBtn && spotsLoading && (
          <View style={[styles.searchPill, styles.searchPillLoading]}>
            <ActivityIndicator size="small" color="#111" />
            <Text style={styles.searchPillText}>{t('map.searchThisArea')}</Text>
          </View>
        )}

        {/* Search result card */}
        {searchState && !searchLoading && (
          <SearchResultCard
            searchedLat={searchState.result.latitude}
            searchedLng={searchState.result.longitude}
            searchedName={searchState.result.shortName}
            nearestSpot={searchState.nearestSpot}
            nearestStreet={searchNearestStreet}
            onDismiss={handleDismissSearchResult}
            onSelectSpot={handleSelectNearestSpot}
            onSelectStreet={handleSelectStreet}
          />
        )}

        {/* Tapped city layer */}
        {overlayInfo && !searchState && (
          <OverlayInfoCard
            info={overlayInfo}
            onDismiss={() => setOverlayInfo(null)}
            onParkHere={session ? undefined : (minutes) => { void handleParkOnStreet(overlayInfo, minutes); }}
            onPhotoSign={() => {
              const lat = Number(overlayInfo.tapLat);
              const lng = Number(overlayInfo.tapLng);
              setOverlayInfo(null);
              router.push(Number.isFinite(lat) && Number.isFinite(lng)
                ? { pathname: '/ambassador', params: { lat: String(lat), lng: String(lng) } }
                : '/ambassador');
            }}
          />
        )}
      </View>

      {/* Glance card: nearest free street */}
      {nearestStreet && !session && !selectedSpot && !overlayInfo && !searchState && (
        <TouchableOpacity
          style={[styles.glanceCard, { bottom: insets.bottom + 20 }]}
          activeOpacity={0.85}
          onPress={() => {
            mapRef.current?.flyTo(nearestStreet.lat, nearestStreet.lng, 17);
            setOverlayInfo({
              ...(nearestStreet.properties as OverlayInfo),
              kind: nearestStreet.kind,
              tapLat: nearestStreet.lat,
              tapLng: nearestStreet.lng,
            });
          }}
        >
          <View style={styles.glanceDot} />
          <View style={{ flex: 1 }}>
            <Text style={styles.glanceTitle} numberOfLines={1}>
              {t('map.nearestFree', { road: nearestStreet.road ?? t('spot.street') })}
            </Text>
            <Text style={styles.glanceSub} numberOfLines={1}>
              {t('map.nearestFreeSub', {
                distance: nearestStreet.distanceMeters < 1000
                  ? `${Math.max(10, Math.round(nearestStreet.distanceMeters / 10) * 10)} m`
                  : `${(nearestStreet.distanceMeters / 1000).toFixed(1)} km`,
                until: streetUntilText({ ...nearestStreet.properties, kind: nearestStreet.kind }),
              })}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color="#00E676" />
        </TouchableOpacity>
      )}

      {/* Find me */}
      <TouchableOpacity
        style={[styles.locateBtn, { bottom: insets.bottom + (session ? 110 : 90) }]}
        onPress={handleLocateMe}
        disabled={locating}
        activeOpacity={0.85}
        accessibilityLabel={t('map.locateMe')}
      >
        {locating
          ? <ActivityIndicator size="small" color="#2196F3" />
          : <Ionicons name={hasFix ? 'locate' : 'locate-outline'} size={22} color={hasFix ? '#2196F3' : '#AAA'} />}
      </TouchableOpacity>

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
          onFindCar={handleFindCar}
          loading={sessionLoading}
        />
      )}

      {/* Spot detail bottom sheet */}
      <SpotBottomSheet
        spot={selectedSpot}
        allSpots={spots}
        userLat={coordinate.latitude}
        userLng={coordinate.longitude}
        hasLocation={hasFix}
        expanded={expandedSpotId === selectedSpot?.id}
        onExpand={handleExpand}
        onParkHere={handleParkHere}
        onClose={handleSheetClose}
        sessionActive={!!session}
        reportCounts={reportCounts}
        businessOccupancy={spotBusinessOccupancy}
        onSelectNearestSpot={handleSelectNearestSpot}
        carRemembered={!!selectedSpot && car?.spotId === selectedSpot.id}
        onToggleRememberCar={handleToggleRememberCar}
        now={now}
      />

      <DirectionsModal
        visible={carDirections}
        target={car ? { lat: car.lat, lng: car.lng, label: car.label } : null}
        onClose={() => setCarDirections(false)}
      />

      <StayFinder
        visible={stayFinderVisible}
        spots={visibleSpots}
        origin={viewCenter}
        now={now}
        onSelect={handleStaySelect}
        onClose={() => setStayFinderVisible(false)}
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
  loadingText: {
    color: '#AAA',
    fontSize: 15,
    marginTop: 12,
  },
  // ── Top overlay (app name + search bar) ────────────────────────────────────
  searchRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    zIndex: 10,
  },
  searchFlex: {
    flex: 1,
  },
  topOverlay: {
    position: 'absolute',
    left: 16,
    right: 16,
    gap: 8,
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
  // ── Quick action chips ──────────────────────────────────────────────────────
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chipTakenActive: {
    borderColor: MAP_COLORS.taken,
  },
  takenDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: MAP_COLORS.taken,
    borderWidth: 1.5,
    borderColor: '#fff',
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(26,26,26,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(0,200,83,0.35)',
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 20,
  },
  chipActive: {
    backgroundColor: '#00C853',
    borderColor: '#00C853',
  },
  chipText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#111',
  },
  // ── Banners ─────────────────────────────────────────────────────────────────
  offlineBanner: {
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
  locationEnableText: {
    color: '#00C853',
    fontSize: 12,
    fontWeight: '700',
  },
  offlineBannerText: {
    color: '#FFB300',
    fontSize: 12,
    fontWeight: '500',
  },
  emptyBanner: {
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
  // ── FAB ─────────────────────────────────────────────────────────────────────
  glanceCard: {
    position: 'absolute',
    left: 16,
    right: 92,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(26,26,26,0.96)',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,230,118,0.35)',
    elevation: 8,
  },
  glanceDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#00E676',
  },
  glanceTitle: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
  },
  glanceSub: {
    color: '#AAA',
    fontSize: 13,
    marginTop: 2,
  },
  locateBtn: {
    position: 'absolute',
    right: 24,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: 'rgba(26,26,26,0.95)',
    borderWidth: 1,
    borderColor: '#333',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
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
