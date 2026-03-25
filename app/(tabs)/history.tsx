import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSession } from '../_hooks/useSession';
import { getSessionHistory } from '../_services/firebase';
import { ParkingSession } from '../_types';
import { t } from '../_i18n';

function formatDate(date: Date): string {
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(startTime: Date, endTime: Date | null): string {
  if (!endTime) return '—';
  const totalMins = Math.floor((endTime.getTime() - startTime.getTime()) / 60_000);
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  if (hours > 0) {
    return t('history.durationHM', { hours, minutes: mins });
  }
  return t('history.durationM', { minutes: totalMins });
}

function spotTypeLabel(spotType?: string): string {
  if (spotType === 'garage') return t('history.garage');
  if (spotType === 'lot') return t('history.lot');
  return t('history.street');
}

export default function HistoryScreen() {
  const insets = useSafeAreaInsets();
  const { userId } = useSession();
  const [sessions, setSessions] = useState<ParkingSession[]>([]);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const loadHistory = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const history = await getSessionHistory(userId);
      setSessions(history);
    } catch (err) {
      console.warn('History load error:', err);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [userId]);

  useEffect(() => {
    if (userId && !loaded) {
      void loadHistory();
    }
  }, [userId, loaded, loadHistory]);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      <View style={styles.titleRow}>
        <Text style={styles.screenTitle}>{t('history.title')}</Text>
        <TouchableOpacity onPress={loadHistory} style={styles.refreshBtn} activeOpacity={0.7}>
          <Ionicons name="refresh" size={20} color="#00C853" />
        </TouchableOpacity>
      </View>

      {loading && (
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#00C853" />
        </View>
      )}

      {!loading && loaded && sessions.length === 0 && (
        <View style={styles.empty}>
          <Text style={styles.emptyEmoji}>🅿️</Text>
          <Text style={styles.emptyText}>{t('history.empty')}</Text>
        </View>
      )}

      {!loading && sessions.map(session => (
        <View key={session.id} style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="car-outline" size={18} color="#00C853" />
            <Text style={styles.cardType}>{spotTypeLabel(session.spotType)}</Text>
            {session.hitLimit && (
              <View style={styles.limitBadge}>
                <Text style={styles.limitBadgeText}>{t('history.limitHit')}</Text>
              </View>
            )}
          </View>

          <View style={styles.cardRow}>
            <Ionicons name="calendar-outline" size={14} color="#666" />
            <Text style={styles.cardDate}>
              {formatDate(session.startTime)} · {formatTime(session.startTime)}
            </Text>
          </View>

          <View style={styles.cardRow}>
            <Ionicons name="time-outline" size={14} color="#666" />
            <Text style={styles.cardDuration}>
              {formatDuration(session.startTime, session.endTime)}
            </Text>
          </View>

          {session.spotCity && session.spotCity !== 'Unknown' && (
            <View style={styles.cardRow}>
              <Ionicons name="location-outline" size={14} color="#666" />
              <Text style={styles.cardCity}>{session.spotCity}</Text>
            </View>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  content: {
    paddingHorizontal: 20,
    gap: 12,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#fff',
  },
  refreshBtn: {
    padding: 6,
  },
  centered: {
    paddingTop: 60,
    alignItems: 'center',
  },
  empty: {
    paddingTop: 60,
    alignItems: 'center',
    gap: 12,
  },
  emptyEmoji: {
    fontSize: 48,
  },
  emptyText: {
    color: '#555',
    fontSize: 16,
    textAlign: 'center',
  },
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  cardType: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
    flex: 1,
  },
  limitBadge: {
    backgroundColor: 'rgba(244,67,54,0.15)',
    borderRadius: 12,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  limitBadgeText: {
    color: '#F44336',
    fontSize: 11,
    fontWeight: '700',
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cardDate: {
    color: '#AAA',
    fontSize: 13,
  },
  cardDuration: {
    color: '#CCC',
    fontSize: 14,
    fontWeight: '600',
  },
  cardCity: {
    color: '#777',
    fontSize: 13,
  },
});
