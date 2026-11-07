import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getLocale, t } from '../_i18n';
import { formatWhen } from '../_i18n/time';
import { streetStayMinutes, streetVerdict } from '../_services/parkingRules';
import { prettyRoad } from '../_services/nearestStreet';
import { MAP_COLORS, OverlayInfo } from './mapStyle';
import { ensureAnonymousAuth, submitMapCorrection, StreetColor } from '../_services/firebase';

const STREET_KINDS = new Set(['street', 'noParking', 'paid', 'permit', 'free15']);
/** Lines an ambassador can photograph the sign for */
const PHOTO_KINDS = new Set([...STREET_KINDS, 'unknown']);
const CORRECTIONS: { color: StreetColor; key: string; swatch: string }[] = [
  { color: 'free', key: 'map.legendStreetFree', swatch: MAP_COLORS.streetFree },
  { color: 'noParking', key: 'map.legendStreetNo', swatch: MAP_COLORS.streetNo },
  { color: 'paid', key: 'map.legendStreetPaid', swatch: MAP_COLORS.streetPaid },
];

/**
 * Short verdict for a free street line, e.g. "free until 3:40 p.m.", "free, no
 * time limit" or "no parking until 6:00 a.m.". Used by the glance and search cards.
 */
export function streetUntilText(props: OverlayInfo | Record<string, unknown>, now: Date = new Date()): string {
  if (props.kind === 'free15') return t('overlay.untilTime', { time: formatWhen(new Date(now.getTime() + 15 * 60_000), now) });
  const verdict = streetVerdict(props, now);
  if (verdict.level === 'banned' && verdict.allowedFrom) {
    return t('overlay.bannedUntil', { time: formatWhen(verdict.allowedFrom, now) });
  }
  if (!verdict.leaveBy) return t('overlay.noTimeLimit');
  return t('overlay.untilTime', { time: formatWhen(verdict.leaveBy, now) });
}

/** SpotAngels-style verdict line for the street card: what does a car parked now get? */
function freeUntilLine(info: OverlayInfo, now: Date = new Date()): string {
  const verdict = streetVerdict(info, now);
  if (verdict.level === 'banned' && verdict.allowedFrom) {
    return t('overlay.bannedNow', { time: formatWhen(verdict.allowedFrom, now) });
  }
  if (!verdict.leaveBy) return t('overlay.freeNowNoLimit');
  return t('overlay.freeNowUntil', { time: formatWhen(verdict.leaveBy, now) });
}

/** Why the line has its colour: mapped from the signs, or the city's default rule. */
function basisLines(info: OverlayInfo): string[] {
  if (info.basis === 'ambassador') {
    const lines: string[] = [];
    if (info.maxstay) lines.push(t('overlay.mappedMaxstay', { limit: String(info.maxstay) }));
    if (info.signNote) lines.push(t('overlay.signSays', { note: String(info.signNote) }));
    lines.push(info.reportedAt
      ? t('overlay.ambassadorDetailWhen', { date: new Date(String(info.reportedAt)).toLocaleDateString(t('common.dateLocale'), { month: 'long', day: 'numeric', year: 'numeric' }) })
      : t('overlay.ambassadorDetail'));
    return lines;
  }
  if (info.basis === 'osm') {
    const lines = [t(info.kind === 'noParking' ? 'overlay.mappedNoDetail' : 'overlay.mappedFreeDetail')];
    if (info.maxstay) lines.push(t('overlay.mappedMaxstay', { limit: String(info.maxstay) }));
    return lines;
  }
  return [
    t(info.city === 'Gatineau' ? 'overlay.gatineauDefaultDetail' : 'overlay.streetFreeDetail'),
    t('overlay.defaultBasis'),
  ];
}

function sourceKey(info: OverlayInfo): string {
  if (info.basis === 'ambassador') return 'overlay.sourceAmbassador';
  if (info.kind === 'taken') return 'overlay.sourceTaken';
  if (info.basis === 'osm') return 'overlay.sourceOsm';
  if (info.city === 'Gatineau') return 'overlay.sourceGatineau';
  return 'overlay.source';
}

function describe(info: OverlayInfo): { title: string; lines: string[]; color: string } {
  const fr = getLocale() === 'fr';
  switch (info.kind) {
    case 'paid': {
      if (info.basis === 'ambassador') {
        const lines = info.maxStayHours ? [t('overlay.maxStay', { hours: Number(info.maxStayHours) })] : [];
        return {
          title: prettyRoad(info.road) ? `${t('overlay.paid')} · ${prettyRoad(info.road)}` : t('overlay.paid'),
          lines: [...lines, ...basisLines(info)],
          color: MAP_COLORS.streetPaid,
        };
      }
      const lines: string[] = [];
      // Verdict first, like SpotAngels: does today need a meter at all?
      const days = Number(info.daysInEffect);
      const today = new Date().getDay(); // 0 = Sunday
      if ((days === 5 && (today === 0 || today === 6)) || (days === 6 && today === 0)) {
        lines.push(t('overlay.paidNotToday'));
      }
      if (info.road) {
        lines.push(t('overlay.paidDetail', {
          road: prettyRoad(info.road) ?? '', from: prettyRoad(info.from) ?? '?', to: prettyRoad(info.to) ?? '?',
        }));
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
        title: t('overlay.streetFree', { road: prettyRoad(info.road) ?? '' }),
        lines: [freeUntilLine(info), ...basisLines(info)],
        color: MAP_COLORS.streetFree,
      };
    case 'noParking':
      return {
        title: t('overlay.streetNo', { road: prettyRoad(info.road) ?? '' }),
        lines: info.basis === 'osm' || info.basis === 'ambassador' ? basisLines(info) : [t('overlay.streetNoDetail')],
        color: MAP_COLORS.streetNo,
      };
    case 'permit':
      if (info.basis === 'ambassador') {
        return {
          title: t('overlay.permitStreet', { road: prettyRoad(info.road) ?? '' }),
          lines: [t('overlay.permitDetail'), ...basisLines(info)],
          color: MAP_COLORS.streetFree,
        };
      }
      return {
        title: t('overlay.permit', { area: (fr ? info.areaFr : info.area) ?? info.area ?? '' }),
        lines: [freeUntilLine(info), t('overlay.permitDetail')],
        color: MAP_COLORS.streetFree,
      };
    case 'unknown':
      return {
        title: t('overlay.unknown', { road: prettyRoad(info.road) ?? '' }),
        lines: [t('overlay.unknownDetail'), t('overlay.unknownHelp')],
        color: MAP_COLORS.streetUnknown,
      };
    case 'taken': {
      const until = info.until ? new Date(String(info.until)) : null;
      return {
        title: t('overlay.taken'),
        lines: [until && until.getTime() > Date.now()
          ? t('overlay.takenUntil', { time: formatWhen(until) })
          : t('overlay.takenDetail')],
        color: MAP_COLORS.taken,
      };
    }
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
  /** Start a parking session on this street with a reminder before the limit */
  onParkHere?: (timerMinutes: number) => void;
  /** Open the ambassador camera to photograph this street's sign */
  onPhotoSign?: () => void;
}

export { streetStayMinutes };

/** What a tapped city-layer line, area or lot means. */
export const OverlayInfoCard: React.FC<Props> = ({ info, onDismiss, onParkHere, onPhotoSign }) => {
  const { title, lines, color } = describe(info);
  // null = no time limit; 0 = can't park here right now
  const stayMinutes = onParkHere && STREET_KINDS.has(info.kind) && info.kind !== 'noParking'
    ? streetStayMinutes(info)
    : 0;
  const [correcting, setCorrecting] = useState(false);
  const [sent, setSent] = useState<'idle' | 'sending' | 'done' | 'failed'>('idle');
  const canCorrect = PHOTO_KINDS.has(info.kind) && typeof info.tapLat === 'number';
  const canPhoto = !!onPhotoSign && PHOTO_KINDS.has(info.kind);

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

      {stayMinutes !== 0 && onParkHere && (
        <TouchableOpacity
          style={[styles.parkBtn, { backgroundColor: color }]}
          onPress={() => onParkHere(stayMinutes ?? 0)}
          activeOpacity={0.85}
        >
          <Ionicons name="car" size={18} color="#111" />
          <Text style={styles.parkBtnText}>
            {stayMinutes === null
              ? t('overlay.parkedHereNoLimit')
              : t('overlay.parkedHere', {
                time: formatWhen(new Date(Date.now() + stayMinutes * 60_000)),
              })}
          </Text>
        </TouchableOpacity>
      )}
      {canPhoto && (
        <TouchableOpacity
          style={[styles.photoBtn, info.kind === 'unknown' && styles.photoBtnStrong]}
          onPress={onPhotoSign}
          activeOpacity={0.85}
        >
          <Ionicons name="camera" size={16} color={info.kind === 'unknown' ? '#111' : '#fff'} />
          <Text style={[styles.photoBtnText, info.kind === 'unknown' && { color: '#111' }]}>
            {t('ambassador.photoSign')}
          </Text>
        </TouchableOpacity>
      )}
      <Text style={styles.source}>{t(sourceKey(info))}</Text>

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
  parkBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: 12,
    marginTop: 8,
  },
  parkBtnText: {
    color: '#111',
    fontWeight: '700',
    fontSize: 15,
  },
  photoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderRadius: 12,
    paddingVertical: 10,
    marginTop: 8,
    borderWidth: 1,
    borderColor: '#444',
  },
  photoBtnStrong: {
    backgroundColor: '#00E676',
    borderColor: '#00E676',
  },
  photoBtnText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 14,
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
