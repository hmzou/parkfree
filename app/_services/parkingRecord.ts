import { getLocale, t } from '../_i18n';
import { ParkingRecord, ParkingSession, ParkingSpot } from '../_types';
import { prettyRoad } from './nearestStreet';
import { streetStayMinutes } from './parkingRules';

interface PositionInfo {
  positionSource: 'gps' | 'map';
  accuracyMeters: number | null;
  dataAsOf: string | null;
}

/** Record for "I parked here" on a street line: the line's rule as the card showed it. */
export function buildStreetRecord(
  info: Record<string, unknown> & { kind: string },
  verdict: string,
  position: PositionInfo,
  now: Date = new Date(),
): ParkingRecord {
  const stay = streetStayMinutes(info, now);
  const basis = typeof info.basis === 'string'
    ? info.basis
    : info.kind === 'paid' || info.kind === 'permit' || info.kind === 'free15' ? 'city' : 'default';
  return {
    road: prettyRoad(info.road),
    city: info.city === 'Gatineau' ? 'Gatineau' : 'Ottawa',
    kind: info.kind,
    basis,
    verdict,
    leaveBy: stay && stay > 0 ? new Date(now.getTime() + stay * 60_000).toISOString() : null,
    maxstay: typeof info.maxstay === 'string' ? info.maxstay : null,
    ...position,
    locale: getLocale(),
  };
}

/** Record for parking at a pin (lot, garage or mapped street spot). */
export function buildSpotRecord(
  spot: ParkingSpot,
  verdict: string,
  position: Omit<PositionInfo, 'positionSource'>,
): ParkingRecord {
  return {
    road: null,
    city: spot.city,
    kind: spot.type,
    basis: spot.source === 'osm' ? 'osm' : spot.source ?? 'user',
    verdict,
    leaveBy: spot.rule?.leaveBy ? spot.rule.leaveBy.toISOString() : null,
    maxstay: spot.timeRestrictions ?? null,
    positionSource: 'map',
    ...position,
    locale: getLocale(),
  };
}

function formatDateTime(date: Date): string {
  const locale = getLocale() === 'fr' ? 'fr-CA' : 'en-CA';
  return date.toLocaleString(locale, {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    hour: 'numeric', minute: '2-digit', second: '2-digit', timeZoneName: 'short',
  });
}

function basisText(record: ParkingRecord): string {
  switch (record.basis) {
    case 'osm': return t('record.basisOsm');
    case 'default': return t(record.city === 'Gatineau' ? 'record.basisDefaultGatineau' : 'record.basisDefaultOttawa');
    case 'city': return t('record.basisCity');
    default: return t('record.basisOther');
  }
}

export interface RecordLine {
  label: string;
  value: string;
}

/** The record as labelled lines, in the app's current language. */
export function recordLines(session: ParkingSession): RecordLine[] {
  const r = session.record;
  const lines: RecordLine[] = [
    { label: t('record.id'), value: session.id },
    { label: t('record.parkedAt'), value: formatDateTime(session.startTime) },
    {
      label: t('record.leftAt'),
      value: session.endTime ? formatDateTime(session.endTime) : t('record.stillParked'),
    },
    {
      label: t('record.location'),
      value: `${r?.road ? `${r.road}, ` : ''}${r?.city ?? session.spotCity ?? ''} (${session.lat.toFixed(5)}, ${session.lng.toFixed(5)})`,
    },
    { label: t('record.mapLink'), value: `https://www.openstreetmap.org/?mlat=${session.lat.toFixed(5)}&mlon=${session.lng.toFixed(5)}#map=19/${session.lat.toFixed(5)}/${session.lng.toFixed(5)}` },
  ];
  if (r) {
    lines.push({
      label: t('record.position'),
      value: r.positionSource === 'gps' && r.accuracyMeters !== null
        ? t('record.positionGps', { meters: Math.round(r.accuracyMeters) })
        : t('record.positionMap'),
    });
    lines.push({ label: t('record.ruleShown'), value: r.verdict });
    if (r.leaveBy) lines.push({ label: t('record.allowedUntil'), value: formatDateTime(new Date(r.leaveBy)) });
    if (r.maxstay) lines.push({ label: t('record.postedLimit'), value: r.maxstay });
    lines.push({ label: t('record.ruleSource'), value: basisText(r) });
    if (r.dataAsOf) lines.push({ label: t('record.dataAsOf'), value: formatDateTime(new Date(r.dataAsOf)) });
  }
  if (session.endTime && r?.leaveBy) {
    const over = session.endTime.getTime() > Date.parse(r.leaveBy);
    lines.push({ label: t('record.withinLimit'), value: t(over ? 'record.no' : 'record.yes') });
  }
  return lines;
}

/** Plain text to share or print, with a note on how the times were recorded. */
export function recordText(session: ParkingSession): string {
  const body = recordLines(session).map(l => `${l.label}: ${l.value}`).join('\n');
  return `${t('record.title')}\n\n${body}\n\n${t('record.integrity')}\n${t('record.disclaimer')}`;
}
