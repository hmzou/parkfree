import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Animated } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { TimerState } from '../_types';
import { t } from '../_i18n';
import { useLocale } from '../_contexts/LocaleContext';

interface Props {
  timer: TimerState;
  sessionStartTime: Date | null;
  /** Human-readable spot description, e.g. "Street parking · Ottawa" */
  spotLabel?: string;
  onLeave: () => void;
  loading?: boolean;
}

const PHASE_COLORS = {
  green: '#00C853',
  yellow: '#FFC107',
  red: '#F44336',
};

function formatDuration(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  if (h > 0) {
    return `${h}h ${m.toString().padStart(2, '0')}m ${s.toString().padStart(2, '0')}s`;
  }
  return `${m}m ${s.toString().padStart(2, '0')}s`;
}

function formatElapsed(startTime: Date): string {
  const secs = Math.floor((Date.now() - startTime.getTime()) / 1000);
  return formatDuration(secs);
}

export const TimerBar: React.FC<Props> = ({ timer, sessionStartTime, spotLabel, onLeave, loading }) => {
  // Subscribe to locale so t() calls update when language changes
  useLocale();

  const barAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(barAnim, {
      toValue: timer.active ? timer.progress : 0,
      duration: 400,
      useNativeDriver: false,
    }).start();
  }, [timer.progress, timer.active, barAnim]);

  const barColor = timer.active ? PHASE_COLORS[timer.phase] : '#00C853';

  const timeDisplay = timer.active && timer.durationMinutes > 0
    ? t('session.timeRemaining', {
        minutes: Math.floor(timer.remainingSeconds / 60),
        seconds: timer.remainingSeconds % 60,
      })
    : sessionStartTime
    ? formatElapsed(sessionStartTime)
    : '—';

  return (
    <View style={styles.container}>
      {/* Progress bar */}
      {timer.active && timer.durationMinutes > 0 && (
        <View style={styles.trackOuter}>
          <Animated.View
            style={[
              styles.trackFill,
              {
                width: barAnim.interpolate({
                  inputRange: [0, 1],
                  outputRange: ['0%', '100%'],
                }),
                backgroundColor: barColor,
              },
            ]}
          />
        </View>
      )}

      <View style={styles.row}>
        <View style={styles.info}>
          <View style={styles.dotRow}>
            <View style={[styles.dot, { backgroundColor: barColor }]} />
            <Text style={styles.label} numberOfLines={1}>
              {spotLabel ?? t('session.parkedAt')}
            </Text>
          </View>
          <Text style={[styles.time, { color: barColor }]}>{timeDisplay}</Text>
        </View>

        <TouchableOpacity
          style={[styles.leaveBtn, loading && styles.leaveBtnDisabled]}
          onPress={onLeave}
          disabled={loading}
          activeOpacity={0.8}
        >
          {loading
            ? <Ionicons name="hourglass-outline" size={18} color="#fff" />
            : <Ionicons name="log-out-outline" size={18} color="#fff" />
          }
          <Text style={styles.leaveBtnText}>{t('actions.leaving')}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#1A1A1A',
    borderTopWidth: 1,
    borderTopColor: '#2A2A2A',
  },
  trackOuter: {
    height: 3,
    backgroundColor: '#2A2A2A',
  },
  trackFill: {
    height: 3,
    borderRadius: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  info: {
    flex: 1,
    gap: 4,
    marginRight: 12,
  },
  dotRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  label: {
    fontSize: 12,
    color: '#AAA',
    fontWeight: '500',
    flexShrink: 1,
  },
  time: {
    fontSize: 18,
    fontWeight: '700',
  },
  leaveBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F44336',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    gap: 6,
    flexShrink: 0,
  },
  leaveBtnDisabled: {
    opacity: 0.6,
  },
  leaveBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
  },
});
