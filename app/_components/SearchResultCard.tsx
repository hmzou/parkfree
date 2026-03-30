import React, { useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Linking,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocale } from '../_contexts/LocaleContext';
import { t } from '../_i18n';
import { ParkingSpot } from '../_types';
import { haversineMeters } from '../_services/overpass';

interface Props {
  /** The geocoded location the user searched for */
  searchedLat: number;
  searchedLng: number;
  searchedName: string;
  /** The nearest free spot relative to the searched location */
  nearestSpot: ParkingSpot | null;
  onDismiss: () => void;
  onSelectSpot?: (spot: ParkingSpot) => void;
}

export const SearchResultCard: React.FC<Props> = ({
  searchedLat,
  searchedLng,
  searchedName,
  nearestSpot,
  onDismiss,
  onSelectSpot,
}) => {
  useLocale();

  const openGoogleMaps = useCallback(() => {
    if (!nearestSpot) return;
    const url = `https://www.google.com/maps/dir/?api=1&destination=${nearestSpot.lat},${nearestSpot.lng}&travelmode=driving`;
    Linking.openURL(url);
  }, [nearestSpot]);

  if (!nearestSpot) return null;

  const distMeters = Math.round(
    haversineMeters(searchedLat, searchedLng, nearestSpot.lat, nearestSpot.lng),
  );

  const distLabel =
    distMeters >= 1000
      ? `${(distMeters / 1000).toFixed(1)} km`
      : `${distMeters}m`;

  const spotTypeLabel =
    nearestSpot.type === 'garage'
      ? t('spot.garage')
      : nearestSpot.type === 'lot'
      ? t('spot.lot')
      : t('spot.street');

  return (
    <View style={styles.card}>
      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="location" size={18} color="#00C853" />
          <Text style={styles.headerText} numberOfLines={1}>
            {searchedName}
          </Text>
        </View>
        <TouchableOpacity
          onPress={onDismiss}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Ionicons name="close" size={18} color="#666" />
        </TouchableOpacity>
      </View>

      {/* Result row */}
      <View style={styles.resultRow}>
        <View style={styles.greenDot} />
        <View style={styles.resultText}>
          <Text style={styles.resultTitle}>
            {t('search.closestFreeParking')}
          </Text>
          <Text style={styles.resultSub}>
            {spotTypeLabel} · {distLabel} {t('search.away')}
          </Text>
        </View>
        <Text style={styles.distBadge}>{distLabel}</Text>
      </View>

      {/* Actions */}
      <View style={styles.actions}>
        {onSelectSpot && (
          <TouchableOpacity
            style={styles.viewBtn}
            onPress={() => onSelectSpot(nearestSpot)}
            activeOpacity={0.8}
          >
            <Ionicons name="eye-outline" size={16} color="#00C853" />
            <Text style={styles.viewBtnText}>{t('search.viewSpot')}</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity
          style={styles.directionsBtn}
          onPress={openGoogleMaps}
          activeOpacity={0.8}
        >
          <Ionicons name="navigate" size={16} color="#fff" />
          <Text style={styles.directionsBtnText}>{t('actions.getDirections')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(26,26,26,0.97)',
    borderRadius: 16,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(0,200,83,0.2)',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 10,
    gap: 12,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
    marginRight: 8,
  },
  headerText: {
    color: '#AAA',
    fontSize: 13,
    fontWeight: '500',
    flex: 1,
  },
  resultRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: 'rgba(0,200,83,0.06)',
    borderRadius: 10,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,200,83,0.15)',
  },
  greenDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#00C853',
  },
  resultText: {
    flex: 1,
  },
  resultTitle: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  resultSub: {
    color: '#888',
    fontSize: 12,
    marginTop: 2,
  },
  distBadge: {
    color: '#00C853',
    fontWeight: '700',
    fontSize: 14,
  },
  actions: {
    flexDirection: 'row',
    gap: 8,
  },
  viewBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(0,200,83,0.1)',
    borderRadius: 10,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(0,200,83,0.25)',
  },
  viewBtnText: {
    color: '#00C853',
    fontWeight: '600',
    fontSize: 14,
  },
  directionsBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#00C853',
    borderRadius: 10,
    paddingVertical: 10,
  },
  directionsBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
});
