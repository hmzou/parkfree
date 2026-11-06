import { isGatineauWinter, isOttawaBanSeason } from './parkingRules';

/**
 * Neither city publishes a machine-readable parking ban feed, so this reads the
 * snowfall forecast the bans are based on (Ottawa calls one at 7 cm or more)
 * and never claims a ban is in effect. Open-Meteo is free without a key for
 * non-commercial use, up to 10k calls/day.
 */
const FORECAST_URL =
  'https://api.open-meteo.com/v1/forecast?latitude=45.42&longitude=-75.69' +
  '&daily=snowfall_sum&timezone=America%2FToronto&forecast_days=3';
const FORECAST_TTL_MS = 60 * 60 * 1000;
export const OTTAWA_BAN_SNOW_CM = 7;

export const OTTAWA_WINTER_PARKING_URL =
  'https://ottawa.ca/en/parking-roads-and-travel/parking/winter-parking/winter-weather-parking-bans';
export const GATINEAU_WINTER_PARKING_URL = 'https://www.gatineau.ca/stationnementhivernal';

export interface SnowDay {
  /** YYYY-MM-DD in Eastern time */
  date: string;
  snowCm: number;
}

export interface WinterStatus {
  ottawaSeason: boolean;
  gatineauSeason: boolean;
  /** First forecast day with enough snow for Ottawa to call a ban. */
  heavySnow: SnowDay | null;
}

let cached: { days: SnowDay[]; fetchedAt: number } | null = null;

export async function fetchSnowForecast(): Promise<SnowDay[]> {
  if (cached && Date.now() - cached.fetchedAt < FORECAST_TTL_MS) return cached.days;
  const response = await fetch(FORECAST_URL);
  if (!response.ok) throw new Error(`Forecast error: ${response.status}`);
  const json = await response.json();
  const dates: string[] = json?.daily?.time ?? [];
  const snow: (number | null)[] = json?.daily?.snowfall_sum ?? [];
  const days = dates.map((date, i) => ({ date, snowCm: snow[i] ?? 0 }));
  cached = { days, fetchedAt: Date.now() };
  return days;
}

export function winterStatus(now: Date, forecast: SnowDay[]): WinterStatus {
  const ottawaSeason = isOttawaBanSeason(now);
  return {
    ottawaSeason,
    gatineauSeason: isGatineauWinter(now),
    heavySnow: ottawaSeason
      ? forecast.find(day => day.snowCm >= OTTAWA_BAN_SNOW_CM) ?? null
      : null,
  };
}
