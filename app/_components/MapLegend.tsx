import React, { useState } from 'react';
import { StyleSheet, View, TouchableOpacity, Text, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../_i18n';
import { legendItems, MAP_COLORS } from './mapStyle';

interface Props {
  showOverlays: boolean;
  onToggleOverlays: (value: boolean) => void;
  showWinterParking: boolean;
}

// Not memoized — needs to re-render when locale changes so t() calls update
export const MapLegend: React.FC<Props> = ({ showOverlays, onToggleOverlays, showWinterParking }) => {
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
          {legendItems(showOverlays, showWinterParking).map(item => (
            <View key={item.key} style={styles.legendRow}>
              <View
                style={[
                  item.shape === 'line' ? styles.legendLine : styles.legendDot,
                  item.shape === 'ring'
                    ? { backgroundColor: MAP_COLORS.unclearFill, borderColor: item.color, borderWidth: 2 }
                    : { backgroundColor: item.color },
                ]}
              />
              <Text style={styles.legendLabel}>{t(item.key)}</Text>
            </View>
          ))}
          <View style={styles.divider} />
          <View style={styles.legendRow}>
            <Text style={[styles.legendLabel, styles.toggleLabel]}>{t('map.cityLayers')}</Text>
            <Switch
              value={showOverlays}
              onValueChange={onToggleOverlays}
              trackColor={{ false: '#333', true: '#00C853' }}
              thumbColor="#fff"
            />
          </View>
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
    alignSelf: 'flex-start',
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
    minWidth: 200,
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
  legendLine: {
    width: 14,
    height: 4,
    borderRadius: 2,
  },
  legendLabel: {
    color: '#CCC',
    fontSize: 12,
  },
  toggleLabel: {
    flex: 1,
  },
  divider: {
    height: 1,
    backgroundColor: '#333',
    marginVertical: 2,
  },
});
