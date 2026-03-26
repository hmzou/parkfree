import { useState, useEffect, useCallback } from 'react';
import { ParkingSession } from '../_types';
import {
  ensureAnonymousAuth,
  startSession,
  endSession,
  getActiveSession,
  markSpotOccupied,
  markSpotFree,
  subscribeToAuthState,
} from '../_services/firebase';
import {
  requestNotificationPermissions,
  scheduleWarningNotification,
  scheduleExpiryNotification,
  scheduleStillParkedReminder,
  cancelAllNotifications,
} from '../_services/notifications';
import { getLocale } from '../_i18n';

interface UseSessionResult {
  userId: string | null;
  session: ParkingSession | null;
  startParking: (
    spotId: string,
    lat: number,
    lng: number,
    timerMinutes?: number,
    warnMinutes?: number,
    spotType?: string,
    spotCity?: string,
  ) => Promise<void>;
  stopParking: (hitLimit?: boolean) => Promise<void>;
  loading: boolean;
}

export function useSession(): UseSessionResult {
  const [userId, setUserId] = useState<string | null>(null);
  const [session, setSession] = useState<ParkingSession | null>(null);
  const [loading, setLoading] = useState(false);

  // Init auth + restore active session
  useEffect(() => {
    const unsub = subscribeToAuthState(async (user) => {
      if (user) {
        setUserId(user.uid);
        const active = await getActiveSession(user.uid);
        setSession(active);
      } else {
        const authed = await ensureAnonymousAuth();
        setUserId(authed.uid);
        const active = await getActiveSession(authed.uid);
        setSession(active);
      }
    });

    return unsub;
  }, []);

  const startParking = useCallback(
    async (
      spotId: string,
      lat: number,
      lng: number,
      timerMinutes?: number,
      warnMinutes = 10,
      spotType?: string,
      spotCity?: string,
    ) => {
      setLoading(true);
      try {
        const user = await ensureAnonymousAuth();

        await markSpotOccupied(spotId, user.uid);

        const sessionId = await startSession(
          spotId,
          user.uid,
          lat,
          lng,
          timerMinutes,
          warnMinutes,
          spotType,
          spotCity,
        );

        const now = new Date();
        const newSession: ParkingSession = {
          id: sessionId,
          spotId,
          userId: user.uid,
          lat,
          lng,
          startTime: now,
          endTime: null,
          active: true,
          timerMinutes,
          warnMinutes,
          spotType,
          spotCity,
        };
        setSession(newSession);

        const hasPerms = await requestNotificationPermissions();
        if (hasPerms) {
          const locale = getLocale();
          const spotLabel = `${spotType ?? 'Parking'} — ${spotCity ?? 'Ottawa'}`;

          if (timerMinutes && timerMinutes > 0) {
            const expiryDate = new Date(now.getTime() + timerMinutes * 60 * 1000);
            const warnDate = new Date(expiryDate.getTime() - warnMinutes * 60 * 1000);

            if (warnDate > now) {
              await scheduleWarningNotification(warnDate, warnMinutes, spotLabel, locale);
            }
            await scheduleExpiryNotification(expiryDate, spotLabel, locale);
          } else {
            // No timer: remind after 3 hours
            const reminderDate = new Date(now.getTime() + 3 * 60 * 60 * 1000);
            await scheduleStillParkedReminder(reminderDate, spotLabel, locale);
          }
        }
      } catch (err) {
        console.error('startParking error:', err);
        throw err;
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const stopParking = useCallback(async (hitLimit = false) => {
    if (!session) return;
    setLoading(true);
    try {
      await markSpotFree(session.spotId);
      await endSession(session.id, hitLimit);
      await cancelAllNotifications();
      setSession(null);
    } catch (err) {
      console.error('stopParking error:', err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [session]);

  return { userId, session, startParking, stopParking, loading };
}
