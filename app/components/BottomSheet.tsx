import React, { useCallback, useRef, useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Switch,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import RNBottomSheet, { BottomSheetView, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Ionicons } from '@expo/vector-icons';
import { ParkingSpot } from '../types';
import { t } from '../i18n';
import { nearestFreeSpots, haversineMeters } from '../services/overpass';
import { DirectionsModal } from './DirectionsModal';

interface Props {
  spot: ParkingSpot | null;
  allSpots: ParkingSpot[];
  userLat: number;
  userLng: number;
  onParkHere: (timerMinutes?: number, warnMinutes?: number) => Promise<void>;
  onClose: () => void;
  sessionActive: boolean;
}

export const SpotBottomSheet: React.FC<Props> = ({
  spot,
  allSpots,
  userLat,
  userLng,
  onParkHere,
  onClose,
  sessionActive,
}) => {
  const sheetRef = useRef<RNBottomSheet>(null);
  const snapPoints = ['40%', '80%'];

  const [directionsVisible, setDirectionsVisible] = useState(false);
  const [timerEnabled, setTimerEnabled] = useState(false);
  const [timerHours, setTimerHours] = useState('0');
  const [timerMins, setTimerMins] = useState('30');
  const [warnMins, setWarnMins] = useState('10');
  const [parking, setParking] = useState(false);

  useEffect(() => {
    if (spot) {
      sheetRef.current?.snapToIndex(0);
      setTimerEnabled(false);
      setTimerHours('0');
      setTimerMins('30');
      setWarnMins('10');
      setParking(false);
    } else {
      sheetRef.current?.close();
    }
  }, [spot]);

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

  const nearby = spot
    ? nearestFreeSpots(allSpots, spot.lat, spot.lng, 3, spot.id)
    : [];

  const occupiedMinsAgo = spot?.occupiedSince
    ? Math.floor((Date.now() - spot.occupiedSince.getTime()) / 60_000)
    : null;

  if (!spot) return null;

  const spotTypeLabel =
    spot.type === 'garage'
      ? t('spot.garage')
      : spot.type === 'lot'
      ? t('spot.lot')
      : t('spot.street');

  const cityLabel = spot.city === 'Gatineau' ? t('spot.gatineau') : t('spot.ottawa');

  return (
    <>
      <RNBottomSheet
        ref={sheetRef}
        index={-1}
        snapPoints={snapPoints}
        enablePanDownToClose
        onClose={onClose}
        backgroundStyle={styles.sheetBg}
        handleIndicatorStyle={styles.handle}
      >
        <BottomSheetScrollView contentContainerStyle={styles.content}>
          {/* Header */}
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.title}>
                {spot.occupied ? t('spot.occupied') : t('spot.free')}
              </Text>
              <Text style={styles.subtitle}>
                {spotTypeLabel} · {cityLabel}
              </Text>
            </View>
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

          {/* Occupied state */}
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

          {/* Timer setup (only when not occupied + no active session) */}
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

          {/* Actions */}
          <View style={styles.actions}>
            {!spot.occupied && !sessionActive && (
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
            )}

            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => setDirectionsVisible(true)}
              activeOpacity={0.8}
            >
              <Ionicons name="navigate-outline" size={20} color="#00C853" />
              <Text style={styles.secondaryBtnText}>{t('actions.getDirections')}</Text>
            </TouchableOpacity>
          </View>
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
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingTop: 4,
  },
  headerLeft: {
    flex: 1,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
  },
  subtitle: {
    fontSize: 14,
    color: '#AAA',
    marginTop: 2,
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
});
