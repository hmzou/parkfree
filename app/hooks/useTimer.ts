import { useState, useEffect, useRef, useCallback } from 'react';
import { TimerState } from '../types';

const EMPTY_TIMER: TimerState = {
  active: false,
  durationMinutes: 0,
  warnMinutes: 10,
  startTime: null,
  elapsedSeconds: 0,
  remainingSeconds: 0,
  progress: 0,
  phase: 'green',
};

function computePhase(progress: number, warnMinutes: number, durationMinutes: number): TimerState['phase'] {
  if (durationMinutes === 0) return 'green';
  const warnFraction = warnMinutes / durationMinutes;
  if (progress >= 1) return 'red';
  if (progress >= 1 - warnFraction) return 'yellow';
  return 'green';
}

interface UseTimerResult {
  timer: TimerState;
  startTimer: (durationMinutes: number, warnMinutes: number, fromDate?: Date) => void;
  stopTimer: () => void;
}

export function useTimer(): UseTimerResult {
  const [timer, setTimer] = useState<TimerState>(EMPTY_TIMER);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    setTimer(EMPTY_TIMER);
  }, []);

  const startTimer = useCallback(
    (durationMinutes: number, warnMinutes: number, fromDate?: Date) => {
      if (intervalRef.current) clearInterval(intervalRef.current);

      const startTime = fromDate ?? new Date();
      const totalSeconds = durationMinutes * 60;

      const tick = () => {
        const now = new Date();
        const elapsed = Math.floor((now.getTime() - startTime.getTime()) / 1000);
        const remaining = Math.max(0, totalSeconds - elapsed);
        const progress = totalSeconds > 0 ? Math.min(1, elapsed / totalSeconds) : 0;

        setTimer({
          active: true,
          durationMinutes,
          warnMinutes,
          startTime,
          elapsedSeconds: elapsed,
          remainingSeconds: remaining,
          progress,
          phase: computePhase(progress, warnMinutes, durationMinutes),
        });
      };

      tick(); // immediate first tick
      intervalRef.current = setInterval(tick, 1000);
    },
    [],
  );

  // Restore timer when session has active timer
  useEffect(() => {
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  return { timer, startTimer, stopTimer };
}
