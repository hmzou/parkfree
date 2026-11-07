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
import { router } from 'expo-router';
import { useAuth } from '../_contexts/AuthContext';
import { ambassadorLevel, countMySignReports } from '../_services/ambassador';

const APP_VERSION = '1.0.0';

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  const { userId, session } = useSessionContext();
  // locale + setLocale drives the language toggle AND subscribes this screen to locale changes
  const { locale, setLocale } = useLocale();

  const { account } = useAuth();
  const [signCount, setSignCount] = useState<number | null>(null);
  useEffect(() => {
    if (!account) { setSignCount(null); return; }
    let cancelled = false;
    countMySignReports(account.uid)
      .then(n => { if (!cancelled) setSignCount(n); })
      .catch(() => { if (!cancelled) setSignCount(null); });
    return () => { cancelled = true; };
  }, [account]);
  const level = ambassadorLevel(signCount ?? 0);

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

      {/* Account card */}
      <TouchableOpacity style={styles.card} onPress={() => router.push('/account')} activeOpacity={0.85}>
        <View style={styles.cardHeader}>
          <Ionicons name="person-circle-outline" size={22} color="#00C853" />
          <Text style={[styles.cardTitle, { flex: 1 }]}>{t('account.title')}</Text>
          <Ionicons name="chevron-forward" size={18} color="#666" />
        </View>
        {account ? (
          <>
            <Text style={styles.accountName}>{account.displayName || account.email}</Text>
            {account.displayName && account.email && <Text style={styles.rowLabel}>{account.email}</Text>}
            {account.email && !account.emailVerified && (
              <Text style={styles.warn}>{t('account.notVerifiedShort')}</Text>
            )}
          </>
        ) : (
          <>
            <Text style={styles.rowLabel}>{t('account.signedOutHint')}</Text>
            <View style={styles.signInBtn}>
              <Text style={styles.signInText}>{t('account.signInOrCreate')}</Text>
            </View>
          </>
        )}
        <View style={styles.row}>
          <Text style={styles.rowLabel}>{t('profile.sessionsParked')}</Text>
          <Text style={styles.rowValue}>{sessionCount ?? '—'}</Text>
        </View>
      </TouchableOpacity>

      {/* Ambassador card */}
      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="ribbon-outline" size={22} color="#00C853" />
          <Text style={styles.cardTitle}>{t('ambassador.title')}</Text>
        </View>
        <Text style={styles.rowLabel}>{t('ambassador.profileBlurb')}</Text>
        {account && (
          <>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>{t('ambassador.signsPhotographed')}</Text>
              <Text style={styles.rowValue}>{signCount ?? '—'}</Text>
            </View>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>{t('ambassador.levelLabel')}</Text>
              <Text style={styles.rowValue}>{t(`ambassador.level${level.level}`)}</Text>
            </View>
            {level.next !== null && signCount !== null && (
              <Text style={styles.openSource}>{t('ambassador.nextLevel', { count: level.next - signCount })}</Text>
            )}
          </>
        )}
        <TouchableOpacity style={styles.signInBtn} onPress={() => router.push('/ambassador')} activeOpacity={0.85}>
          <Ionicons name="camera" size={16} color="#111" />
          <Text style={styles.signInText}>{t('ambassador.photoSign')}</Text>
        </TouchableOpacity>
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
  accountName: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '700',
  },
  warn: {
    color: '#FFB300',
    fontSize: 13,
  },
  signInBtn: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: '#00E676',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  signInText: {
    color: '#111',
    fontWeight: '700',
    fontSize: 15,
  },
  openSource: {
    color: '#555',
    fontSize: 12,
    lineHeight: 18,
  },
});
