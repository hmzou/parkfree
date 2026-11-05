import {
  computeOccupiedUntil,
  isOccupiedNow,
  MAX_HOLD_MINUTES,
  TIMER_GRACE_MINUTES,
  UNTIMED_HOLD_MINUTES,
} from '../app/_services/occupancy';

const START = new Date('2026-11-03T12:00:00Z');
const minutesAfter = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60_000);

describe('computeOccupiedUntil', () => {
  it('holds a timed spot until the timer ends plus the grace period', () => {
    expect(computeOccupiedUntil(START, 60)).toEqual(minutesAfter(START, 60 + TIMER_GRACE_MINUTES));
  });

  it('uses the untimed hold when there is no timer', () => {
    expect(computeOccupiedUntil(START)).toEqual(minutesAfter(START, UNTIMED_HOLD_MINUTES));
    expect(computeOccupiedUntil(START, 0)).toEqual(minutesAfter(START, UNTIMED_HOLD_MINUTES));
  });

  it('never exceeds the maximum hold enforced by the security rules', () => {
    expect(computeOccupiedUntil(START, 99 * 60 + 59)).toEqual(minutesAfter(START, MAX_HOLD_MINUTES));
  });
});

describe('isOccupiedNow', () => {
  it('is false for a free spot', () => {
    expect(isOccupiedNow({ occupied: false, occupiedSince: null, occupiedUntil: null }, START)).toBe(false);
  });

  it('respects occupiedUntil', () => {
    const spot = { occupied: true, occupiedSince: START, occupiedUntil: minutesAfter(START, 30) };
    expect(isOccupiedNow(spot, minutesAfter(START, 29))).toBe(true);
    expect(isOccupiedNow(spot, minutesAfter(START, 31))).toBe(false);
  });

  it('expires legacy holds without occupiedUntil after the untimed hold', () => {
    const spot = { occupied: true, occupiedSince: START, occupiedUntil: null };
    expect(isOccupiedNow(spot, minutesAfter(START, UNTIMED_HOLD_MINUTES - 1))).toBe(true);
    expect(isOccupiedNow(spot, minutesAfter(START, UNTIMED_HOLD_MINUTES + 1))).toBe(false);
  });

  it('treats an occupied flag with no timestamps as free', () => {
    expect(isOccupiedNow({ occupied: true, occupiedSince: null, occupiedUntil: null }, START)).toBe(false);
  });
});
