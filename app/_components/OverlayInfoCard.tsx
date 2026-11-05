import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getLocale, t } from '../_i18n';
import { MAP_COLORS, OverlayInfo } from './mapStyle';
import { ensureAnonymousAuth, submitMapCorrection, StreetColor } from '../_services/firebase';

const STREET_KINDS = new Set(['street', 'noParking', 'paid', 'permit', 'free15']);
const CORRECTIONS: { color: StreetColor; key: string; swatch: string }[] = [
  { color: 'free', key: 'map.legendStreetFree', swatch: MAP_COLORS.streetFree },
  { color: 'noParking', key: 'map.legendStreetNo', swatch: MAP_COLORS.streetNo },
  { color: 'paid', key: 'map.legendStreetPaid', swatch: MAP_COLORS.streetPaid },
];

function describe(info: OverlayInfo): { title: string; lines: string[]; color: string } {
  const fr = getLocale() === 'fr';
  switch (info.kind) {
    case 'paid': {
      const lines: string[] = [];
      // Verdict first, like SpotAngels: does today need a meter at all?
      const days = Number(info.daysInEffect);
      const today = new Date().getDay(); // 0 = Sunday
      if ((days === 5 && (today === 0 || today === 6)) || (days === 6 && today === 0)) {
        lines.push(t('overlay.paidNotToday'));
      }
      if (info.road) {
        lines.push(t('overlay.paidDetail', { road: info.road, from: info.from ?? '?', to: info.to ?? '?' }));
      }
      const facts: string[] = [];
      if (info.hourlyRate) facts.push(t('overlay.paidRate', { rate: Number(info.hourlyRate).toFixed(2) }));
      if (info.maxStayHours) facts.push(t('overlay.maxStay', { hours: parseInt(String(info.maxStayHours), 10) }));
      if (days >= 5 && days <= 7) facts.push(t(`overlay.paidDays${days}`));
      if (facts.length) lines.push(facts.join(' · '));
      lines.push(t('overlay.paidHoursVary'));
      return { title: t('overlay.paid'), lines, color: MAP_COLORS.streetPaid };
    }
    case 'street':
      return {
        title: t('overlay.streetFree', { road: info.road ?? '' }),
        lines: [t('overlay.streetFreeDetail')],
        color: MAP_COLORS.streetFree,
      };
    case 'noParking':
      return {
        title: t('overlay.streetNo', { road: info.road ?? '' }),
        lines: [t('overlay.streetNoDetail')],
        color: MAP_COLORS.streetNo,
      };
    case 'permit':
      return {
        title: t('overlay.permit', { area: (fr ? info.areaFr : info.area) ?? info.area ?? '' }),
        lines: [t('overlay.permitDetail')],
        color: MAP_COLORS.streetFree,
      };
    case 'free15':
      return { title: t('overlay.free15'), lines: [], color: MAP_COLORS.streetFree };
    case 'banAlternate':
      return {
        title: t('overlay.banAlternate', { name: (fr ? info.nameFr : info.name) ?? info.name ?? '' }),
        lines: [t('overlay.banAlternateDetail', {
          address: (fr ? info.addressFr : info.address) ?? info.address ?? '',
          spaces: info.spaces ?? '?',
        })],
        color: MAP_COLORS.banAlternate,
      };
    case 'cityLot': {
      const free = Number(info.freeSpaces);
      return {
        title: `${t('overlay.cityLot')} · ${info.address ?? ''}`,
        lines: [free >= 0
          ? t('overlay.cityLotFree', { free, capacity: info.capacity ?? '?' })
          : t('overlay.cityLotNoCount', { capacity: info.capacity ?? '?' })],
        color: MAP_COLORS.cityLot,
      };
    }
    default:
      return { title: info.kind, lines: [], color: '#fff' };
  }
}

interface Props {
  info: OverlayInfo;
  onDismiss: () => void;
}

/** What a tapped city-layer line, area or lot means. */
export const OverlayInfoCard: React.FC<Props> = ({ info, onDismiss }) => {
  const { title, lines, color } = describe(info);
  const [correcting, setCorrecting] = useState(false);
  const [sent, setSent] = useState<'idle' | 'sending' | 'done' | 'failed'>('idle');
  const canCorrect = STREET_KINDS.has(info.kind) && typeof info.tapLat === 'number';

  const sendCorrection = async (shouldBe: StreetColor) => {
    setSent('sending');
    try {
      const user = await ensureAnonymousAuth();
      await submitMapCorrection({
        userId: user.uid,
        kind: info.kind,
        road: (info.road as string | undefined) ?? null,
        lat: info.tapLat as number,
        lng: info.tapLng as number,
        shouldBe,
      });
      setSent('done');
    } catch (err) {
      console.warn('Map correction failed:', err);
      setSent('failed');
    }
  };

  return (
    <View style={[styles.card, { borderLeftColor: color }]}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <TouchableOpacity onPress={onDismiss} hitSlop={12}>
          <Ionicons name="close" size={18} color="#AAA" />
        </TouchableOpacity>
      </View>
      {lines.map(line => <Text key={line} style={styles.line}>{line}</Text>)}
      <Text style={styles.source}>{t('overlay.source')}</Text>

      {canCorrect && sent === 'done' && (
        <Text style={styles.thanks}>{t('overlay.correctionThanks')}</Text>
      )}
      {canCorrect && sent !== 'done' && !correcting && (
        <TouchableOpacity onPress={() => setCorrecting(true)} hitSlop={8}>
          <Text style={styles.correctLink}>{t('overlay.wrongColour')}</Text>
        </TouchableOpacity>
      )}
      {canCorrect && sent !== 'done' && correcting && (
        <View style={styles.correctRow}>
          <Text style={styles.line}>{t('overlay.shouldBe')}</Text>
          {CORRECTIONS.map(c => (
            <TouchableOpacity
              key={c.color}
              style={[styles.correctChip, { borderColor: c.swatch }]}
              onPress={() => void sendCorrection(c.color)}
              disabled={sent === 'sending'}
              activeOpacity={0.8}
            >
              <View style={[styles.swatch, { backgroundColor: c.swatch }]} />
              <Text style={styles.correctChipText}>{t(c.key)}</Text>
            </TouchableOpacity>
          ))}
          {sent === 'failed' && <Text style={styles.failed}>{t('errors.submitFailed')}</Text>}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'rgba(26,26,26,0.96)',
    borderRadius: 14,
    borderLeftWidth: 4,
    padding: 14,
    gap: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  title: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 15,
    flex: 1,
  },
  line: {
    color: '#CCC',
    fontSize: 13,
  },
  source: {
    color: '#777',
    fontSize: 11,
    marginTop: 4,
  },
  correctLink: {
    color: '#00C853',
    fontSize: 12,
    fontWeight: '600',
    marginTop: 6,
  },
  correctRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
    marginTop: 6,
  },
  correctChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 5,
  },
  swatch: {
    width: 10,
    height: 3,
    borderRadius: 2,
  },
  correctChipText: {
    color: '#fff',
    fontSize: 12,
  },
  thanks: {
    color: '#00C853',
    fontSize: 12,
    marginTop: 6,
  },
  failed: {
    color: '#F44336',
    fontSize: 12,
  },
});
