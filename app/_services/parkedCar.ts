import { Coordinate } from '../_types';

/**
 * Where the car was left, stored only on this phone. SpotAngels remembers the
 * car so you can walk back to it; this does the same without Bluetooth, and it
 * still works when Firestore is unreachable.
 */
export interface ParkedCar {
  lat: number;
  lng: number;
  label: string;
  spotId?: string;
  savedAt: string;
}

const STORAGE_KEY = 'parked_car_v1';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AsyncStorage = (() => {
  try {
    return require('@react-native-async-storage/async-storage').default;
  } catch {
    return null;
  }
})();

function isCar(value: unknown): value is ParkedCar {
  const car = value as ParkedCar | null;
  return !!car && Number.isFinite(car.lat) && Number.isFinite(car.lng) && typeof car.label === 'string';
}

export async function loadParkedCar(): Promise<ParkedCar | null> {
  if (!AsyncStorage) return null;
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return isCar(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export async function saveParkedCar(car: Omit<ParkedCar, 'savedAt'> & { savedAt?: string }): Promise<ParkedCar> {
  const stored: ParkedCar = { ...car, savedAt: car.savedAt ?? new Date().toISOString() };
  await AsyncStorage?.setItem(STORAGE_KEY, JSON.stringify(stored));
  return stored;
}

export async function clearParkedCar(): Promise<void> {
  await AsyncStorage?.removeItem(STORAGE_KEY);
}

export function parkedCarCoordinate(car: ParkedCar | null): Coordinate | null {
  return car ? { latitude: car.lat, longitude: car.lng } : null;
}
