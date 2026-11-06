import React, { useMemo, useState } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, Pressable, ScrollView } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ParkingSpot, Coordinate } from '../_types';
import { t } from '../_i18n';
import { findSpotsForStay } from '../_services/parkingRules';
import { formatDuration, formatWhen } from '../_i18n/time';

const STAY_OPTIONS_MINUTES = [60, 120, 180, 240, 480];

interface Props {
  visible: boolean;
  spots: ParkingSpot[];
  /** Map centre, so the search follows where the user is looking */
  origin: Coordinate;
  now: Date;
  onSelect: (spot: ParkingSpot) => void;
  onClose: () => void;
}

/** "How long are you staying?" → the closest spots that allow it, surest first. */
export const StayFinder: React.FC<Props> = ({ visible, spots, origin, now, onSelect, onClose }) => {
  const [stayMinutes, setStayMinutes] = useState<number | null>(null);

  const results = useMemo(
    () => (stayMinutes === null ? [] : findSpotsForStay(spots, origin, stayMinutes, now)),
    [spots, origin, stayMinutes, now],
  );

  const spotLabel = (spot: ParkingSpot) =>
    spot.type === 'garage' ? t('spot.garage') : spot.type === 'lot' ? t('spot.lot') : t('spot.street');

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title}>{t('stay.title')}</Text>
          <TouchableOpacity onPress={onClose} hitSlop={12}>
            <Ionicons name="close" size={22} color="#AAA" />
          </TouchableOpacity>
        </View>

        <View style={styles.options}>
          {STAY_OPTIONS_MINUTES.map(minutes => {
            const active = minutes === stayMinutes;
            return (
              <TouchableOpacity
                key={minutes}
                style={[styles.chip, active && styles.chipActive]}
                onPress={() => setStayMinutes(minutes)}
                activeOpacity={0.8}
              >
                <Text style={[styles.chipText, active && styles.chipTextActive]}>
                  {minutes >= 480 ? t('stay.allDay') : t('stay.hoursOption', { h: minutes / 60 })}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {stayMinutes !== null && (
          <ScrollView style={styles.results} contentContainerStyle={{ gap: 8 }}>
            <Text style={styles.resultsTitle}>
              {t('stay.results', { duration: formatDuration(stayMinutes) })}
            </Text>
            {results.length === 0 && <Text style={styles.empty}>{t('stay.none')}</Text>}
            {results.map(candidate => (
              <TouchableOpacity
                key={candidate.spot.id}
                style={styles.row}
                onPress={() => onSelect(candidate.spot)}
                activeOpacity={0.8}
              >
                <Ionicons
                  name={candidate.confirmed ? 'checkmark-circle' : 'help-circle-outline'}
                  size={22}
                  color={candidate.confirmed ? '#4CAF50' : '#90A4AE'}
                />
                <View style={styles.rowBody}>
                  <Text style={styles.rowTitle}>
                    {spotLabel(candidate.spot)}
                    {!candidate.confirmed && ` · ${t('stay.unconfirmed')}`}
                  </Text>
                  <Text style={styles.rowSub}>
                    {t('stay.walk', { minutes: candidate.walkMinutes })}
                    {' · '}
                    {candidate.spot.rule?.leaveBy
                      ? t('stay.until', { time: formatWhen(candidate.spot.rule.leaveBy, now) })
                      : t('stay.noLimit')}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color="#666" />
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  sheet: {
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 20,
    paddingBottom: 36,
    gap: 16,
    maxHeight: '70%',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  options: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#333',
    paddingHorizontal: 16,
    paddingVertical: 9,
    backgroundColor: '#111',
  },
  chipActive: {
    borderColor: '#00C853',
    backgroundColor: 'rgba(0,200,83,0.15)',
  },
  chipText: {
    color: '#CCC',
    fontWeight: '600',
  },
  chipTextActive: {
    color: '#00C853',
  },
  results: {
    flexGrow: 0,
  },
  resultsTitle: {
    color: '#AAA',
    fontSize: 13,
  },
  empty: {
    color: '#888',
    fontSize: 14,
    paddingVertical: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#111',
    borderRadius: 12,
    padding: 12,
  },
  rowBody: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  rowSub: {
    color: '#AAA',
    fontSize: 12,
  },
});
