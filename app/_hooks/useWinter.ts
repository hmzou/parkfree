import { useEffect, useState } from 'react';
import { fetchSnowForecast, SnowDay, winterStatus, WinterStatus } from '../_services/winter';
import { isGatineauWinter, isOttawaBanSeason } from '../_services/parkingRules';

const RECHECK_MS = 60 * 60 * 1000;

/** Winter parking season flags plus a heavy-snow warning from the forecast. */
export function useWinter(): WinterStatus {
  const [forecast, setForecast] = useState<SnowDay[]>([]);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), RECHECK_MS);
    return () => clearInterval(id);
  }, []);

  const inSeason = isOttawaBanSeason(now) || isGatineauWinter(now);

  useEffect(() => {
    if (!inSeason) return;
    let cancelled = false;
    fetchSnowForecast()
      .then(days => { if (!cancelled) setForecast(days); })
      .catch(err => console.warn('Snow forecast unavailable:', err));
    return () => { cancelled = true; };
  }, [inSeason, now]);

  return winterStatus(now, forecast);
}
