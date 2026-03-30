import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Animated,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocale } from '../_contexts/LocaleContext';
import { t } from '../_i18n';
import { ParkingSpot } from '../_types';
import { haversineMeters } from '../_services/overpass';

interface Props {
  /** How many active sessions are in this lot */
  activeCount: number;
  /** Max capacity of the lot */
  capacity: number;
  /** Nearest free spot outside this lot (shown when the lot is full) */
  nearestFreeSpot: ParkingSpot | null;
  nearestFreeSpotLat: number;
  nearestFreeSpotLng: number;
  onSelectNearestSpot?: (spot: ParkingSpot) => void;
}

const FULL_THRESHOLD = 0.85; // 85 %+ → show "lot is full" recommendation

export const OccupancyMeter: React.FC<Props> = ({
  activeCount,
  capacity,
  nearestFreeSpot,
  nearestFreeSpotLat,
  nearestFreeSpotLng,
  onSelectNearestSpot,
}) => {
  useLocale();

  const safeCapacity = Math.max(capacity, 1);
  const ratio = Math.min(activeCount / safeCapacity, 1);
  const pct = Math.round(ratio * 100);

  const isFull = ratio >= FULL_THRESHOLD;

  // Colour interpolation: green → yellow → red
  let barColor = '#4CAF50';
  if (ratio >= 0.85) barColor = '#F44336';
  else if (ratio >= 0.6) barColor = '#FFB300';

  const openGoogleMaps = useCallback(() => {
    if (!nearestFreeSpot) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${nearestFreeSpot.lat},${nearestFreeSpot.lng}&travelmode=driving`;
    Linking.openURL(url);
  }, [nearestFreeSpot]);

  const nearestDistMeters = nearestFreeSpot
    ? Math.round(
        haversineMeters(
          nearestFreeSpotLat,
          nearestFreeSpotLng,
          nearestFreeSpot.lat,
          nearestFreeSpot.lng,
        ),
      )
    : null;

  return (
    <View style={styles.container}>
      {/* Meter header */}
      <View style={styles.header}>
        <Ionicons name="car" size={16} color="#AAA" />
        <Text style={styles.headerText}>{t('occupancy.lotOccupancy')}</Text>
        <Text style={[styles.pctText, { color: barColor }]}>{pct}%</Text>
      </View>

      {/* Progress bar */}
      <View style={styles.barTrack}>
        <View
          style={[
            styles.barFill,
            { width: `${pct}%` as unknown as number, backgroundColor: barColor },
          ]}
        />
      </View>

      <Text style={styles.countText}>
        {t('occupancy.spotsUsed', {
          used: activeCount,
          total: safeCapacity,
        })}
      </Text>

      {/* Recommendation when lot is full */}
      {isFull && nearestFreeSpot && nearestDistMeters !== null && (
        <View style={styles.fullBanner}>
          <View style={styles.fullBannerHeader}>
            <Ionicons name="warning" size={16} color="#F44336" />
            <Text style={styles.fullBannerTitle}>{t('occupancy.lotFull')}</Text>
          </View>
          <Text style={styles.fullBannerSub}>
            {t('occupancy.nearestFreeIs', { distance: `${nearestDistMeters}m` })}
          </Text>
          <View style={styles.fullBannerActions}>
            {onSelectNearestSpot && (
              <TouchableOpacity
                style={styles.viewBtn}
                onPress={() => onSelectNearestSpot(nearestFreeSpot)}
                activeOpacity={0.8}
              >
                <Ionicons name="eye-outline" size={14} color="#00C853" />
                <Text style={styles.viewBtnText}>{t('search.viewSpot')}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity
              style={styles.directionsBtn}
              onPress={openGoogleMaps}
              activeOpacity={0.8}
            >
              <Ionicons name="navigate" size={14} color="#fff" />
              <Text style={styles.directionsBtnText}>{t('actions.getDirections')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 14,
    gap: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  headerText: {
    color: '#AAA',
    fontSize: 13,
    fontWeight: '600',
    flex: 1,
  },
  pctText: {
    fontSize: 14,
    fontWeight: '800',
  },
  barTrack: {
    height: 8,
    backgroundColor: '#2A2A2A',
    borderRadius: 4,
    overflow: 'hidden',
  },
  barFill: {
    height: '100%',
    borderRadius: 4,
    minWidth: 4,
  },
  countText: {
    color: '#666',
    fontSize: 12,
  },
  fullBanner: {
    backgroundColor: 'rgba(244,67,54,0.08)',
    borderRadius: 10,
    padding: 12,
    gap: 8,
    borderWidth: 1,
    borderColor: 'rgba(244,67,54,0.2)',
    marginTop: 4,
  },
  fullBannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fullBannerTitle: {
    color: '#F44336',
    fontWeight: '700',
    fontSize: 14,
  },
  fullBannerSub: {
    color: '#CCC',
    fontSize: 13,
  },
  fullBannerActions: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 4,
  },
  viewBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: 'rgba(0,200,83,0.1)',
    borderRadius: 10,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: 'rgba(0,200,83,0.25)',
  },
  viewBtnText: {
    color: '#00C853',
    fontWeight: '600',
    fontSize: 13,
  },
  directionsBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#00C853',
    borderRadius: 10,
    paddingVertical: 8,
  },
  directionsBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 13,
  },
});
