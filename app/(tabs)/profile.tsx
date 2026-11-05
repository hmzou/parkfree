import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { t } from '../_i18n';
import { useSessionContext } from '../_contexts/SessionContext';
import { useLocale } from '../_contexts/LocaleContext';
import { countUserSessions } from '../_services/firebase';
import { legendItems, MAP_COLORS } from '../_components/mapStyle';

const APP_VERSION = '1.0.0';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { userId, session } = useSessionContext();
  // locale + setLocale drives the language toggle AND subscribes this screen to locale changes
  const { locale, setLocale } = useLocale();

  const shortId = userId ? userId.slice(0, 12) + '…' : '—';

  const [sessionCount, setSessionCount] = useState<number | null>(null);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    countUserSessions(userId)
      .then(count => { if (!cancelled) setSessionCount(count); })
      .catch((err) => {
        console.warn('Session count error:', err);
        if (!cancelled) setSessionCount(null);
      });
    return () => { cancelled = true; };
  }, [userId, session?.id]);

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + 16, paddingBottom: insets.bottom + 32 },
      ]}
      showsVerticalScrollIndicator={false}
    >
      {/* Header */}
      <Text style={styles.screenTitle}>{t('profile.title')}</Text>

      {/* Session card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="person-circle-outline" size={22} color="#00C853" />
          <Text style={styles.cardTitle}>{t('profile.session')}</Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('profile.sessionId')}</Text>
          <Text style={styles.rowValue} numberOfLines={1}>{shortId}</Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('profile.sessionsParked')}</Text>
          <Text style={styles.rowValue}>{sessionCount ?? '—'}</Text>
        </View>
      </View>

      {/* Language card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="language-outline" size={22} color="#00C853" />
          <Text style={styles.cardTitle}>{t('profile.language')}</Text>
        </View>

        <View style={styles.langRow}>
          <TouchableOpacity
            style={[styles.langChip, locale === 'en' && styles.langChipActive]}
            onPress={() => { if (locale !== 'en') setLocale('en'); }}
            activeOpacity={0.8}
          >
            <Text style={[styles.langChipText, locale === 'en' && styles.langChipTextActive]}>
              {t('profile.english')}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.langChip, locale === 'fr' && styles.langChipActive]}
            onPress={() => { if (locale !== 'fr') setLocale('fr'); }}
            activeOpacity={0.8}
          >
            <Text style={[styles.langChipText, locale === 'fr' && styles.langChipTextActive]}>
              {t('profile.french')}
            </Text>
          </TouchableOpacity>
        </View>
      </View>

      {/* Pin legend card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="map-outline" size={22} color="#00C853" />
          <Text style={styles.cardTitle}>{t('map.legend')}</Text>
        </View>

        {legendItems(true, true).map(item => (
          <View key={item.key} style={styles.legendRow}>
            <View
              style={[
                styles.legendDot,
                item.shape === 'line' && styles.legendLine,
                item.shape === 'ring'
                  ? { backgroundColor: MAP_COLORS.unclearFill, borderColor: item.color, borderWidth: 2 }
                  : { backgroundColor: item.color },
              ]}
            />
            <Text style={styles.legendLabel}>{t(item.key)}</Text>
          </View>
        ))}
      </View>

      {/* About card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="information-circle-outline" size={22} color="#00C853" />
          <Text style={styles.cardTitle}>{t('profile.about')}</Text>
        </View>

        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('profile.version')}</Text>
          <Text style={styles.rowValue}>{APP_VERSION}</Text>
        </View>

        <Text style={styles.openSource}>{t('profile.openSource')}</Text>
      </View>
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
    gap: 16,
  },
  screenTitle: {
    fontSize: 28,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 4,
  },
  card: {
    backgroundColor: '#1A1A1A',
    borderRadius: 16,
    padding: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#2A2A2A',
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  cardTitle: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  rowLabel: {
    color: '#AAA',
    fontSize: 14,
  },
  rowValue: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    maxWidth: '60%',
    textAlign: 'right',
  },
  langRow: {
    flexDirection: 'row',
    gap: 12,
  },
  langChip: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: '#111',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  langChipActive: {
    backgroundColor: 'rgba(0,200,83,0.15)',
    borderColor: '#00C853',
  },
  langChipText: {
    color: '#AAA',
    fontWeight: '600',
    fontSize: 14,
  },
  langChipTextActive: {
    color: '#00C853',
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  legendDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  legendLine: {
    width: 16,
    height: 4,
    borderRadius: 2,
  },
  legendLabel: {
    color: '#CCC',
    fontSize: 14,
  },
  openSource: {
    color: '#555',
    fontSize: 12,
    lineHeight: 18,
  },
});
