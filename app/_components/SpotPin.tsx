import React, { useEffect, useRef } from 'react';
import { View, Animated, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ParkingSpot, PinStatus } from '../_types';

interface Props {
  spot: ParkingSpot;
  selected?: boolean;
  onPress?: () => void;
}

function getStatus(spot: ParkingSpot): PinStatus {
  if (spot.seasonalBan) return 'seasonal-ban';
  if (spot.occupied) return 'occupied';
  if (spot.timeRestrictions) return 'time-limited';
  return 'available';
}

const STATUS_COLORS: Record<PinStatus, string> = {
  available: '#00C853',
  occupied: '#F44336',
  'time-limited': '#FFC107',
  'seasonal-ban': '#FF6D00',
};

export const SpotPin: React.FC<Props> = ({ spot, selected, onPress }) => {
  const status = getStatus(spot);
  const color = STATUS_COLORS[status];
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // Pulsing animation for seasonal ban
  useEffect(() => {
    if (status !== 'seasonal-ban') {
      pulseAnim.setValue(1);
      return;
    }

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 0.3,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1.0,
          duration: 600,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [status, pulseAnim]);

  const iconName = spot.source === 'user' ? 'person-circle' : 'car';

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.85}>
      <Animated.View
        style={[
          styles.container,
          { opacity: status === 'seasonal-ban' ? pulseAnim : 1 },
          selected && styles.selected,
        ]}
      >
        <View style={[styles.pin, { backgroundColor: color }]}>
          <Ionicons name={iconName} size={14} color="#fff" />
        </View>
        <View style={[styles.tail, { borderTopColor: color }]} />
      </Animated.View>
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
  },
  pin: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.4,
    shadowRadius: 4,
    elevation: 5,
  },
  tail: {
    width: 0,
    height: 0,
    borderLeftWidth: 5,
    borderRightWidth: 5,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    marginTop: -1,
  },
  selected: {
    transform: [{ scale: 1.25 }],
  },
});
