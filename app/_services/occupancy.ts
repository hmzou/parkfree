import { ParkingSpot } from '../_types';

/** How long an untimed session holds a spot before it is treated as free again */
export const UNTIMED_HOLD_MINUTES = 4 * 60;
/** Extra time after a timer ends before the spot is released */
export const TIMER_GRACE_MINUTES = 15;
/** Upper bound on any hold; firestore.rules enforces the same limit */
export const MAX_HOLD_MINUTES = 24 * 60;

/** When a new session should stop marking its spot as occupied. */
export function computeOccupiedUntil(start: Date, timerMinutes?: number): Date {
  const holdMinutes = timerMinutes && timerMinutes > 0
    ? timerMinutes + TIMER_GRACE_MINUTES
    : UNTIMED_HOLD_MINUTES;
  const clamped = Math.min(holdMinutes, MAX_HOLD_MINUTES);
  return new Date(start.getTime() + clamped * 60_000);
}

/**
 * True while the spot is held. Spots written before occupiedUntil existed fall
 * back to occupiedSince + the untimed hold, so abandoned sessions expire.
 */
export function isOccupiedNow(
  spot: Pick<ParkingSpot, 'occupied' | 'occupiedSince' | 'occupiedUntil'>,
  now: Date = new Date(),
): boolean {
  if (!spot.occupied) return false;
  if (spot.occupiedUntil) return spot.occupiedUntil.getTime() > now.getTime();
  if (spot.occupiedSince) {
    return spot.occupiedSince.getTime() + UNTIMED_HOLD_MINUTES * 60_000 > now.getTime();
  }
  return false;
}
