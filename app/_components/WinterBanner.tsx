import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Linking } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { t } from '../_i18n';
import {
  GATINEAU_WINTER_PARKING_URL,
  OTTAWA_WINTER_PARKING_URL,
  WinterStatus,
} from '../_services/winter';

interface Props {
  status: WinterStatus;
  /** Gatineau's nightly ban only matters when the user is looking at Gatineau */
  nearGatineau: boolean;
  now: Date;
}

function dateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function dayLabel(date: string, now: Date): string {
  if (date === dateKey(now)) return t('winter.today');
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  return date === dateKey(tomorrow) ? t('winter.tomorrow') : date;
}

/** Heavy-snow warning for Ottawa, or Gatineau's nightly ban reminder. */
export const WinterBanner: React.FC<Props> = ({ status, nearGatineau, now }) => {
  let message: string | null = null;
  let url = OTTAWA_WINTER_PARKING_URL;
  if (status.heavySnow) {
    message = t('winter.snowWarning', {
      cm: Math.round(status.heavySnow.snowCm),
      day: dayLabel(status.heavySnow.date, now),
    });
  } else if (status.gatineauSeason && nearGatineau) {
    message = t('winter.gatineauSeason');
    url = GATINEAU_WINTER_PARKING_URL;
  }
  if (!message) return null;

  return (
    <View style={styles.banner}>
      <Ionicons name="snow-outline" size={16} color="#81D4FA" />
      <Text style={styles.text}>{message}</Text>
      <TouchableOpacity onPress={() => { void Linking.openURL(url); }} hitSlop={8}>
        <Text style={styles.link}>{t('winter.officialInfo')}</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(3,169,244,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(129,212,250,0.35)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  text: {
    color: '#E1F5FE',
    fontSize: 12,
    flex: 1,
  },
  link: {
    color: '#81D4FA',
    fontSize: 12,
    fontWeight: '700',
  },
});
