import { ParkingSpot } from '../_types';
import { haversineMeters } from './overpass';

/**
 * City-wide parking rules that apply even where no sign is posted.
 *
 * Ottawa, Traffic and Parking By-law 2017-301:
 *   s.16(2) max 3 h between 7:00 and 19:00 Mon–Fri, 6 h on Saturdays and
 *   holidays. The City's own page says 6 h on weekends, so Sundays use 6 h.
 *   s.16(6)-(7) overnight bans Nov 15 – Apr 1 only apply once the City declares
 *   a Winter Weather Parking Ban, which has no machine-readable feed.
 * Gatineau, Règlement 300-2006 art. 5:
 *   Dec 1 – Apr 1 no street parking Mon–Fri 0:00–6:00 and Sat–Sun 3:00–6:00
 *   without a winter permit. Permits are not modelled.
 *
 * All times use the device clock, which is assumed to be on Eastern time.
 */

export type RuleLevel = 'ok' | 'limited' | 'banned' | 'unclear';

export interface RuleNote {
  key: string;
  params?: Record<string, string | number>;
}

export interface RuleVerdict {
  level: RuleLevel;
  /** Latest time a car parked now may stay. Null when no limit is known. */
  leaveBy: Date | null;
  /** While banned, when parking is allowed again. */
  allowedFrom: Date | null;
  notes: RuleNote[];
}

export interface RuleContext {
  /** Snow forecast is heavy enough that Ottawa may declare a parking ban. */
  ottawaBanLikely?: boolean;
}

export const OTTAWA_WEEKDAY_LIMIT_MINUTES = 3 * 60;
export const OTTAWA_WEEKEND_LIMIT_MINUTES = 6 * 60;
const OTTAWA_LIMIT_START_HOUR = 7;
const OTTAWA_LIMIT_END_HOUR = 19;

function atHour(day: Date, hour: number): Date {
  const d = new Date(day);
  d.setHours(hour, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}

/** Parse OSM maxstay strings like "Max 2 hours", "Max 30 min" into minutes. */
export function parseMaxstayMinutes(restrictions: string | null | undefined): number | null {
  if (!restrictions) return null;
  const s = restrictions.toLowerCase();
  const hMatch = s.match(/(\d+)\s*h/);
  if (hMatch) {
    const hours = parseInt(hMatch[1], 10);
    const mMatch = s.match(/(\d+)\s*h.*?(\d+)\s*m/);
    const extraMins = mMatch ? parseInt(mMatch[2], 10) : 0;
    return hours * 60 + extraMins;
  }
  const mMatch = s.match(/(\d+)\s*m(?:in)?/);
  if (mMatch) return parseInt(mMatch[1], 10);
  return null;
}

/**
 * When a car parked at `start` on an unsigned Ottawa street must move. Each
 * day's 7:00–19:00 window is counted on its own, so parking at 17:00 on a
 * weekday runs into the next morning's window.
 */
export function ottawaDefaultLeaveBy(start: Date): Date {
  for (let offset = 0; offset < 3; offset++) {
    const day = addDays(start, offset);
    const windowStart = atHour(day, OTTAWA_LIMIT_START_HOUR);
    const windowEnd = atHour(day, OTTAWA_LIMIT_END_HOUR);
    const from = start > windowStart ? start : windowStart;
    if (from >= windowEnd) continue;
    const dow = day.getDay();
    const limit = dow === 0 || dow === 6
      ? OTTAWA_WEEKEND_LIMIT_MINUTES
      : OTTAWA_WEEKDAY_LIMIT_MINUTES;
    const deadline = addMinutes(from, limit);
    if (deadline <= windowEnd) return deadline;
  }
  // Every window is longer than its limit, so the loop always returns.
  return addMinutes(start, OTTAWA_WEEKDAY_LIMIT_MINUTES);
}

/** Nov 15 – Apr 1 inclusive. */
export function isOttawaBanSeason(t: Date): boolean {
  const m = t.getMonth();
  const d = t.getDate();
  return (m === 10 && d >= 15) || m === 11 || m <= 2 || (m === 3 && d === 1);
}

/** Dec 1 00:00 until Apr 1 00:00. */
export function isGatineauWinter(t: Date): boolean {
  const m = t.getMonth();
  return m === 11 || m <= 2;
}

function gatineauBanWindow(day: Date): { start: Date; end: Date } {
  const dow = day.getDay();
  const startHour = dow === 0 || dow === 6 ? 3 : 0;
  return { start: atHour(day, startHour), end: atHour(day, 6) };
}

/** The overnight ban window containing `t`, if any. */
export function gatineauBanAt(t: Date): { start: Date; end: Date } | null {
  if (!isGatineauWinter(t)) return null;
  const window = gatineauBanWindow(t);
  return t >= window.start && t < window.end ? window : null;
}

/** Start of the next overnight ban after `t`, or null if the season ends first. */
export function nextGatineauBan(t: Date): Date | null {
  for (let offset = 0; offset < 3; offset++) {
    const { start } = gatineauBanWindow(addDays(t, offset));
    if (start > t) return isGatineauWinter(start) ? start : null;
  }
  return null;
}

function earliest(dates: Date[]): Date | null {
  if (dates.length === 0) return null;
  return dates.reduce((a, b) => (b < a ? b : a));
}

export function evaluateSpot(
  spot: Pick<ParkingSpot, 'type' | 'city' | 'timeRestrictions' | 'feeUnknown' | 'seasonalBan'>,
  now: Date = new Date(),
  context: RuleContext = {},
): RuleVerdict {
  const notes: RuleNote[] = [];
  const deadlines: Date[] = [];
  const isStreet = spot.type === 'street';

  if (isStreet && spot.city === 'Gatineau') {
    const ban = gatineauBanAt(now);
    if (ban) {
      return {
        level: 'banned',
        leaveBy: null,
        allowedFrom: ban.end,
        notes: [{ key: 'rules.gatineauNightBan' }],
      };
    }
    const nextBan = nextGatineauBan(now);
    if (nextBan) {
      deadlines.push(nextBan);
      notes.push({ key: 'rules.gatineauNightBanSoon' });
    }
  }

  const posted = parseMaxstayMinutes(spot.timeRestrictions);
  if (posted !== null && posted > 0) {
    deadlines.push(addMinutes(now, posted));
    notes.push({ key: 'rules.posted', params: { limit: spot.timeRestrictions ?? '' } });
  } else if (isStreet && spot.city === 'Ottawa') {
    deadlines.push(ottawaDefaultLeaveBy(now));
    notes.push({ key: 'rules.ottawaDefault' });
  }

  let unclear = false;
  if (isStreet && spot.city === 'Ottawa' && context.ottawaBanLikely && isOttawaBanSeason(now)) {
    notes.push({ key: 'rules.ottawaSnowBan' });
    unclear = true;
  }
  if (spot.seasonalBan && (isOttawaBanSeason(now) || isGatineauWinter(now))) {
    notes.push({ key: 'rules.seasonalBan' });
    unclear = true;
  }
  if (spot.feeUnknown) {
    notes.push({ key: 'rules.feeUnknown' });
    unclear = true;
  }

  const leaveBy = earliest(deadlines);
  const level: RuleLevel = unclear ? 'unclear' : leaveBy ? 'limited' : 'ok';
  return { level, leaveBy, allowedFrom: null, notes };
}

/** Minutes a car parked now may stay; Infinity when no limit is known. */
export function allowedStayMinutes(verdict: RuleVerdict, now: Date = new Date()): number {
  if (verdict.level === 'banned') return 0;
  if (!verdict.leaveBy) return Infinity;
  return Math.max(0, Math.floor((verdict.leaveBy.getTime() - now.getTime()) / 60_000));
}

// ─── "Stay for X hours" search ────────────────────────────────────────────────

export interface StayCandidate {
  spot: ParkingSpot;
  distanceMeters: number;
  walkMinutes: number;
  allowedMinutes: number;
  confirmed: boolean;
}

const WALK_METERS_PER_MINUTE = 80;
export const STAY_SEARCH_RADIUS_METERS = 1500;

/**
 * Spots where a car parked now can stay at least `stayMinutes`. Spots with a
 * confirmed fee status come first, so a guess is only offered when nothing
 * certain is nearby.
 */
export function findSpotsForStay(
  spots: ParkingSpot[],
  origin: { latitude: number; longitude: number },
  stayMinutes: number,
  now: Date = new Date(),
  limit = 5,
  radiusMeters = STAY_SEARCH_RADIUS_METERS,
): StayCandidate[] {
  const candidates: StayCandidate[] = [];
  for (const spot of spots) {
    if (spot.occupied) continue;
    const verdict = spot.rule ?? evaluateSpot(spot, now);
    const allowedMinutes = allowedStayMinutes(verdict, now);
    if (allowedMinutes < stayMinutes) continue;
    const distanceMeters = haversineMeters(origin.latitude, origin.longitude, spot.lat, spot.lng);
    if (distanceMeters > radiusMeters) continue;
    candidates.push({
      spot,
      distanceMeters,
      walkMinutes: Math.max(1, Math.round(distanceMeters / WALK_METERS_PER_MINUTE)),
      allowedMinutes,
      confirmed: verdict.level !== 'unclear',
    });
  }
  return candidates
    .sort((a, b) => Number(b.confirmed) - Number(a.confirmed) || a.distanceMeters - b.distanceMeters)
    .slice(0, limit);
}
