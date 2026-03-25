import React, { useCallback, useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Switch,
  ActivityIndicator,
  Dimensions,
  Alert,
} from 'react-native';
import RNBottomSheet, { BottomSheetScrollView, BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import type { BottomSheetBackdropProps } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { ParkingSpot } from '../_types';
import { t } from '../_i18n';
import { nearestFreeSpots, haversineMeters } from '../_services/overpass';
import { DirectionsModal } from './DirectionsModal';
import { submitOccupancyReport } from '../_services/firebase';
import { ensureAnonymousAuth } from '../_services/firebase';

const SCREEN_HEIGHT = Dimensions.get('window').height;
// 3 snap points: PEEK (spot name only), HALF (full details), FULL
const SNAP_PEEK = 110;
const SNAP_HALF = 320;
const SNAP_FULL = SCREEN_HEIGHT - 100;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Parse OSM maxstay strings like "Max 2h", "Max 30 min" → minutes, or null. */
function parseMaxstayMinutes(restrictions: string | null): number | null {
  if (!restrictions) return null;
  const s = restrictions.toLowerCase();
  const hMatch = s.match(/(\d+)\s*h/);
  if (hMatch) {
    const hours = parseInt(hMatch[1], 10);
    const mMatch = s.match(/(\d+)\s*h.*?(\d+)\s*m/);
    const extraMins = mMatch ? parseInt(mMatch[2], 10) : 0;
    return hours * 60 + extraMins;
  }
  const mMatch = s.match(/(\d+)\s*m(?:in)?/);
  if (mMatch) return parseInt(mMatch[1], 10);
  return null;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface Props {
  spot: ParkingSpot | null;
  allSpots: ParkingSpot[];
  userLat: number;
  userLng: number;
  /** True once the user has tapped the same pin a second time (or "See options"). */
  expanded: boolean;
  onExpand: () => void;
  onParkHere: (timerMinutes?: number, warnMinutes?: number) => Promise<void>;
  onClose: () => void;
  sessionActive: boolean;
  reportCounts: Record<string, number>;
}

export const SpotBottomSheet: React.FC<Props> = ({
  spot,
  allSpots,
  userLat,
  userLng,
  expanded,
  onExpand,
  onParkHere,
  onClose,
  sessionActive,
  reportCounts,
}) => {
  const sheetRef = useRef<RNBottomSheet>(null);
  const snapPoints = [SNAP_PEEK, SNAP_HALF, SNAP_FULL];

  const [directionsVisible, setDirectionsVisible] = useState(false);
  const [timerEnabled, setTimerEnabled] = useState(false);
  const [timerHours, setTimerHours] = useState('0');
  const [timerMins, setTimerMins] = useState('30');
  const [warnMins, setWarnMins] = useState('10');
  const [parking, setParking] = useState(false);
  const [reportedThisSession, setReportedThisSession] = useState(false);
  const [snapIndex, setSnapIndex] = useState(-1);

  // Open/close sheet and reset local state whenever the selected spot changes.
  useEffect(() => {
    if (spot) {
      sheetRef.current?.snapToIndex(0);
      setParking(false);
      setWarnMins('10');
      setReportedThisSession(false);

      const parsedMins = parseMaxstayMinutes(spot.timeRestrictions);
      if (parsedMins !== null && parsedMins > 0) {
        setTimerEnabled(true);
        setTimerHours(String(Math.floor(parsedMins / 60)));
        setTimerMins(String(parsedMins % 60));
      } else {
        setTimerEnabled(false);
        setTimerHours('0');
        setTimerMins('30');
      }
    } else {
      sheetRef.current?.close();
    }
  }, [spot?.id]);

  // Snap to HALF when expanded
  useEffect(() => {
    if (expanded && spot) {
      sheetRef.current?.snapToIndex(1);
    }
  }, [expanded, spot?.id]);

  const handleParkHere = useCallback(async () => {
    setParking(true);
    try {
      const totalMins = timerEnabled
        ? parseInt(timerHours, 10) * 60 + parseInt(timerMins, 10)
        : undefined;
      const warn = parseInt(warnMins, 10) || 10;
      await onParkHere(totalMins, warn);
    } finally {
      setParking(false);
      sheetRef.current?.close();
    }
  }, [timerEnabled, timerHours, timerMins, warnMins, onParkHere]);

  const handleReport = useCallback(async () => {
    if (!spot || reportedThisSession) return;
    try {
      const user = await ensureAnonymousAuth();
      await submitOccupancyReport(spot.id, user.uid);
      setReportedThisSession(true);
      Alert.alert(t('reports.thanks'));
    } catch {
      // non-fatal
    }
  }, [spot, reportedThisSession]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        disappearsOnIndex={0}
        appearsOnIndex={1}
        opacity={0.4}
      />
    ),
    [],
  );

  const nearby = spot
    ? nearestFreeSpots(allSpots, spot.lat, spot.lng, 3, spot.id)
    : [];

  const occupiedMinsAgo = spot?.occupiedSince
    ? Math.floor((Date.now() - spot.occupiedSince.getTime()) / 60_000)
    : null;

  const distanceMeters = spot
    ? haversineMeters(userLat, userLng, spot.lat, spot.lng)
    : Infinity;
  const canPark = distanceMeters <= 150;

  const reportCount = spot ? (reportCounts[spot.id] ?? 0) : 0;

  if (!spot) return null;

  const spotTypeLabel =
    spot.type === 'garage'
      ? t('spot.garage')
      : spot.type === 'lot'
      ? t('spot.lot')
      : t('spot.street');

  const cityLabel = spot.city === 'Gatineau' ? t('spot.gatineau') : t('spot.ottawa');
  const isAtHalfOrFull = snapIndex >= 1;

  return (
    <>
      <RNBottomSheet
        ref={sheetRef}
        index={-1}
        snapPoints={snapPoints}
        enablePanDownToClose
        onClose={onClose}
        onChange={setSnapIndex}
        backgroundStyle={styles.sheetBg}
        handleIndicatorStyle={styles.handle}
        backdropComponent={renderBackdrop}
      >
        <BottomSheetScrollView contentContainerStyle={styles.content}>
          {/* ── Peek row — always visible ─────────────────────────────── */}
          <TouchableOpacity
            style={styles.peekRow}
            onPress={snapIndex === 0 ? onExpand : undefined}
            activeOpacity={snapIndex === 0 ? 0.7 : 1}
          >
            <View style={styles.peekLeft}>
              <Text style={styles.peekTitle} numberOfLines={1}>
                {spot.occupied ? t('spot.occupied') : t('spot.free')}
              </Text>
              <Text style={styles.peekSub} numberOfLines={1}>
                {spotTypeLabel} · {cityLabel}
              </Text>
            </View>
            <View style={styles.peekRight}>
              <Text style={styles.peekDist}>{Math.round(distanceMeters)}m</Text>
              {snapIndex === 0 && (
                <Ionicons name="chevron-up" size={16} color="#00C853" />
              )}
            </View>
          </TouchableOpacity>

          {/* ── Full content — shown at HALF and FULL ────────────────── */}
          {isAtHalfOrFull && (
            <>
              {/* Badge row */}
              <View style={styles.header}>
                <View style={[styles.badge, spot.occupied ? styles.badgeRed : styles.badgeGreen]}>
                  <Text style={styles.badgeText}>
                    {spot.occupied ? t('spot.occupied') : t('spot.available')}
                  </Text>
                </View>
              </View>

              {/* Seasonal ban warning */}
              {spot.seasonalBan && (
                <View style={styles.warningBanner}>
                  <Ionicons name="warning" size={18} color="#FF6D00" />
                  <Text style={styles.warningText}>{t('spot.seasonalBan')}</Text>
                </View>
              )}

              {/* Crowd reports warning */}
              {reportCount > 0 && (
                <View style={styles.reportBanner}>
                  <Ionicons name="alert-circle-outline" size={16} color="#FFB300" />
                  <Text style={styles.reportBannerText}>
                    {reportCount === 1
                      ? t('reports.oneReported')
                      : t('reports.manyReported', { count: reportCount })}
                  </Text>
                </View>
              )}

              {/* Restrictions */}
              <View style={styles.infoRow}>
                <Ionicons name="time-outline" size={18} color="#AAA" />
                <Text style={styles.infoLabel}>{t('spot.restrictions')}:</Text>
                <Text style={styles.infoValue}>
                  {spot.timeRestrictions ?? t('spot.none')}
                </Text>
              </View>

              {/* User submitted */}
              {spot.source === 'user' && (
                <View style={styles.infoRow}>
                  <Ionicons name="person-outline" size={16} color="#AAA" />
                  <Text style={styles.infoValue}>{t('spot.userSubmitted')}</Text>
                </View>
              )}

              {/* Occupied ago */}
              {spot.occupied && occupiedMinsAgo !== null && (
                <Text style={styles.occupiedAgo}>
                  {t('spot.occupiedAgo', { minutes: occupiedMinsAgo })}
                </Text>
              )}

              {/* Nearby free spots when occupied */}
              {spot.occupied && nearby.length > 0 && (
                <View style={styles.nearbySection}>
                  <Text style={styles.nearbyTitle}>{t('spot.nearbySpots')}</Text>
                  {nearby.map(ns => {
                    const dist = Math.round(haversineMeters(spot.lat, spot.lng, ns.lat, ns.lng));
                    return (
                      <View key={ns.id} style={styles.nearbyRow}>
                        <View style={styles.greenDot} />
                        <Text style={styles.nearbyText}>
                          {ns.type === 'garage' ? t('spot.garage') : ns.type === 'lot' ? t('spot.lot') : t('spot.street')}
                          {' — '}{dist}m
                        </Text>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* ── Actions ─────────────────────────────────────────── */}
              {!expanded && (
                <TouchableOpacity style={styles.seeOptionsBtn} onPress={onExpand} activeOpacity={0.75}>
                  <Text style={styles.seeOptionsBtnText}>See options</Text>
                  <Ionicons name="chevron-down" size={16} color="#00C853" />
                </TouchableOpacity>
              )}

              {expanded && (
                <>
                  {/* Timer setup */}
                  {!spot.occupied && !sessionActive && (
                    <View style={styles.timerSection}>
                      <View style={styles.timerHeader}>
                        <Text style={styles.timerLabel}>{t('session.setTimer')}</Text>
                        <Switch
                          value={timerEnabled}
                          onValueChange={setTimerEnabled}
                          trackColor={{ false: '#333', true: '#00C853' }}
                          thumbColor="#fff"
                        />
                      </View>

                      {timerEnabled && (
                        <View style={styles.timerInputs}>
                          <View style={styles.timerField}>
                            <Text style={styles.timerFieldLabel}>{t('session.hours')}</Text>
                            <TextInput
                              style={styles.timerInput}
                              keyboardType="number-pad"
                              value={timerHours}
                              onChangeText={setTimerHours}
                              maxLength={2}
                              placeholderTextColor="#666"
                            />
                          </View>
                          <Text style={styles.timerColon}>:</Text>
                          <View style={styles.timerField}>
                            <Text style={styles.timerFieldLabel}>{t('session.minutes')}</Text>
                            <TextInput
                              style={styles.timerInput}
                              keyboardType="number-pad"
                              value={timerMins}
                              onChangeText={setTimerMins}
                              maxLength={2}
                              placeholderTextColor="#666"
                            />
                          </View>
                        </View>
                      )}

                      {timerEnabled && (
                        <View style={styles.warnRow}>
                          <Ionicons name="notifications-outline" size={16} color="#AAA" />
                          <Text style={styles.warnText}>
                            {t('session.warnBefore', { minutes: warnMins })}
                          </Text>
                          <TextInput
                            style={styles.warnInput}
                            keyboardType="number-pad"
                            value={warnMins}
                            onChangeText={setWarnMins}
                            maxLength={2}
                          />
                          <Text style={styles.warnText}> min</Text>
                        </View>
                      )}
                    </View>
                  )}

                  <View style={styles.actions}>
                    {/* "I'm Parking Here" — gated on proximity */}
                    {!spot.occupied && !sessionActive && (
                      canPark ? (
                        <TouchableOpacity
                          style={[styles.primaryBtn, parking && styles.primaryBtnDisabled]}
                          onPress={handleParkHere}
                          disabled={parking}
                          activeOpacity={0.8}
                        >
                          {parking
                            ? <ActivityIndicator color="#fff" size="small" />
                            : <Ionicons name="car" size={20} color="#fff" />
                          }
                          <Text style={styles.primaryBtnText}>{t('actions.parkHere')}</Text>
                        </TouchableOpacity>
                      ) : (
                        <View style={styles.tooFarRow}>
                          <Ionicons name="location-outline" size={16} color="#666" />
                          <Text style={styles.tooFarText}>
                            {Math.round(distanceMeters)}m away — get closer to park here
                          </Text>
                        </View>
                      )
                    )}

                    <TouchableOpacity
                      style={styles.secondaryBtn}
                      onPress={() => setDirectionsVisible(true)}
                      activeOpacity={0.8}
                    >
                      <Ionicons name="navigate-outline" size={20} color="#00C853" />
                      <Text style={styles.secondaryBtnText}>{t('actions.getDirections')}</Text>
                    </TouchableOpacity>

                    {/* Crowd report button */}
                    {!spot.occupied && (
                      <TouchableOpacity
                        style={[styles.reportBtn, reportedThisSession && styles.reportBtnDone]}
                        onPress={handleReport}
                        disabled={reportedThisSession}
                        activeOpacity={0.8}
                      >
                        <Ionicons
                          name={reportedThisSession ? 'checkmark-circle-outline' : 'close-circle-outline'}
                          size={18}
                          color={reportedThisSession ? '#4CAF50' : '#F44336'}
                        />
                        <Text style={[styles.reportBtnText, reportedThisSession && styles.reportBtnTextDone]}>
                          {reportedThisSession ? t('reports.thanks') : t('reports.reportTaken')}
                        </Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </>
              )}
            </>
          )}
        </BottomSheetScrollView>
      </RNBottomSheet>

      <DirectionsModal
        visible={directionsVisible}
        target={spot ? { lat: spot.lat, lng: spot.lng, label: spotTypeLabel } : null}
        onClose={() => setDirectionsVisible(false)}
      />
    </>
  );
};

const styles = StyleSheet.create({
  sheetBg: {
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
  },
  handle: {
    backgroundColor: '#444',
    width: 40,
  },
  content: {
    paddingHorizontal: 20,
    paddingBottom: 40,
    gap: 16,
  },
  // ── Peek row ──────────────────────────────────────────────────────────────
  peekRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 4,
  },
  peekLeft: {
    flex: 1,
    gap: 2,
  },
  peekTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
  },
  peekSub: {
    fontSize: 13,
    color: '#AAA',
  },
  peekRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  peekDist: {
    color: '#00C853',
    fontWeight: '600',
    fontSize: 13,
  },
  // ── Header badge ──────────────────────────────────────────────────────────
  header: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
  },
  badge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
  },
  badgeGreen: { backgroundColor: 'rgba(0,200,83,0.15)' },
  badgeRed: { backgroundColor: 'rgba(244,67,54,0.15)' },
  badgeText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  // ── Banners ───────────────────────────────────────────────────────────────
  warningBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,109,0,0.12)',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,109,0,0.3)',
  },
  warningText: {
    color: '#FF6D00',
    fontWeight: '600',
    fontSize: 14,
  },
  reportBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,179,0,0.1)',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,179,0,0.25)',
  },
  reportBannerText: {
    color: '#FFB300',
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  // ── Info rows ─────────────────────────────────────────────────────────────
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  infoLabel: {
    color: '#AAA',
    fontSize: 14,
  },
  infoValue: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '500',
  },
  occupiedAgo: {
    color: '#F44336',
    fontSize: 13,
    fontStyle: 'italic',
  },
  // ── Nearby ────────────────────────────────────────────────────────────────
  nearbySection: {
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  nearbyTitle: {
    color: '#00C853',
    fontWeight: '700',
    fontSize: 13,
    marginBottom: 4,
  },
  nearbyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  greenDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#00C853',
  },
  nearbyText: {
    color: '#CCC',
    fontSize: 13,
  },
  // ── See options ───────────────────────────────────────────────────────────
  seeOptionsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(0,200,83,0.3)',
    paddingVertical: 12,
    backgroundColor: 'rgba(0,200,83,0.06)',
  },
  seeOptionsBtnText: {
    color: '#00C853',
    fontWeight: '600',
    fontSize: 14,
  },
  // ── Timer ─────────────────────────────────────────────────────────────────
  timerSection: {
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 14,
    gap: 12,
  },
  timerHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  timerLabel: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  timerInputs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timerField: {
    flex: 1,
    alignItems: 'center',
  },
  timerFieldLabel: {
    color: '#AAA',
    fontSize: 11,
    marginBottom: 4,
  },
  timerInput: {
    backgroundColor: '#222',
    borderRadius: 10,
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 10,
    width: '100%',
    borderWidth: 1,
    borderColor: '#333',
  },
  timerColon: {
    color: '#fff',
    fontSize: 24,
    fontWeight: '700',
    marginTop: 16,
  },
  warnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  warnText: {
    color: '#AAA',
    fontSize: 13,
  },
  warnInput: {
    backgroundColor: '#222',
    borderRadius: 8,
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
    textAlign: 'center',
    paddingVertical: 6,
    width: 40,
    borderWidth: 1,
    borderColor: '#333',
  },
  // ── Actions ───────────────────────────────────────────────────────────────
  actions: {
    gap: 10,
    marginTop: 4,
  },
  primaryBtn: {
    backgroundColor: '#00C853',
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryBtnDisabled: {
    opacity: 0.6,
  },
  primaryBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  tooFarRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: 'rgba(255,255,255,0.04)',
    borderRadius: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  tooFarText: {
    color: '#666',
    fontSize: 14,
  },
  secondaryBtn: {
    backgroundColor: 'rgba(0,200,83,0.1)',
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,200,83,0.25)',
  },
  secondaryBtnText: {
    color: '#00C853',
    fontWeight: '700',
    fontSize: 16,
  },
  reportBtn: {
    backgroundColor: 'rgba(244,67,54,0.08)',
    borderRadius: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(244,67,54,0.2)',
  },
  reportBtnDone: {
    backgroundColor: 'rgba(76,175,80,0.08)',
    borderColor: 'rgba(76,175,80,0.2)',
  },
  reportBtnText: {
    color: '#F44336',
    fontWeight: '600',
    fontSize: 14,
  },
  reportBtnTextDone: {
    color: '#4CAF50',
  },
});
