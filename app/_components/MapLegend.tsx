import React, { useState } from 'react';
import { StyleSheet, View, TouchableOpacity, Text } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../_i18n';
import { JUST_FREED_COLOR } from './spotGeoJSON';

const LEGEND_ITEMS = [
  { color: JUST_FREED_COLOR, key: 'map.legendJustFreed' },
  { color: '#4CAF50', key: 'map.legendFree' },
  { color: '#FFB300', key: 'map.legendTimeLimited' },
  { color: '#9E9E9E', key: 'map.legendPermit' },
  { color: '#FF5722', key: 'map.legendOther' },
  { color: '#F44336', key: 'map.legendOccupied' },
];

// Not memoized — needs to re-render when locale changes so t() calls update
export const MapLegend: React.FC = () => {
  const [open, setOpen] = useState(false);
  return (
    <View style={styles.legendContainer}>
      <TouchableOpacity
        style={styles.legendToggle}
        onPress={() => setOpen(v => !v)}
        activeOpacity={0.85}
      >
        <Ionicons name={open ? 'close' : 'information-circle-outline'} size={18} color="#fff" />
        {!open && <Text style={styles.legendToggleText}>{t('map.legend')}</Text>}
      </TouchableOpacity>
      {open && (
        <View style={styles.legendPanel}>
          {LEGEND_ITEMS.map(item => (
            <View key={item.color} style={styles.legendRow}>
              <View style={[styles.legendDot, { backgroundColor: item.color }]} />
              <Text style={styles.legendLabel}>{t(item.key)}</Text>
            </View>
          ))}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  legendContainer: {
    position: 'absolute',
    bottom: 80,
    left: 12,
  },
  legendToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(26,26,26,0.92)',
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 7,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  legendToggleText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  legendPanel: {
    marginTop: 6,
    backgroundColor: 'rgba(26,26,26,0.95)',
    borderRadius: 12,
    padding: 10,
    gap: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 6,
    minWidth: 160,
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  legendLabel: {
    color: '#CCC',
    fontSize: 12,
  },
});
