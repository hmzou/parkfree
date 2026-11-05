import { getLocale, t } from './index';

function intlLocale(): string {
  return getLocale() === 'fr' ? 'fr-CA' : 'en-CA';
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

/** "3:00 p.m.", "tomorrow 10:00 a.m." or "Sat 1:00 p.m." relative to `now`. */
export function formatWhen(date: Date, now: Date = new Date()): string {
  const time = date.toLocaleTimeString(intlLocale(), { hour: 'numeric', minute: '2-digit' });
  if (sameDay(date, now)) return time;
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (sameDay(date, tomorrow)) return t('time.tomorrowAt', { time });
  const weekday = date.toLocaleDateString(intlLocale(), { weekday: 'short' });
  return `${weekday} ${time}`;
}

/** "45 min", "3 h" or "2 h 15 min". */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return t('time.minutes', { m });
  if (m === 0) return t('time.hours', { h });
  return t('time.hoursMinutes', { h, m });
}
