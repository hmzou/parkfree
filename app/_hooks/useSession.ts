import { useState, useEffect, useCallback } from 'react';
import { ParkingSession, SpotType, City } from '../_types';
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
      try {
        if (!user) {
          // Signing in re-fires this listener with the new user, which restores the session.
          await ensureAnonymousAuth();
          return;
        }
        setUserId(user.uid);
        const active = await getActiveSession(user.uid);
        setSession(active);
      } catch (err) {
        console.warn('Session restore failed:', err);
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

        // Occupancy is shared state for other users; the session is what matters here.
        await markSpotOccupied(
          { id: spotId, lat, lng, type: (spotType ?? 'street') as SpotType, city: (spotCity ?? 'Unknown') as City },
          user.uid,
        ).catch(err => console.warn('markSpotOccupied failed:', err));

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

        // Reminders are best-effort — a failure here must not report the session as failed.
        const hasPerms = await requestNotificationPermissions().catch(() => false);
        if (hasPerms) {
          try {
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
          } catch (err) {
            console.warn('Scheduling reminders failed:', err);
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
      // End the session first so a failed occupancy write can't leave the user stuck parked.
      await endSession(session.id, hitLimit);
      setSession(null);
      await Promise.all([
        markSpotFree(session.spotId).catch(err => console.warn('markSpotFree failed:', err)),
        cancelAllNotifications().catch(() => null),
      ]);
    } catch (err) {
      console.error('stopParking error:', err);
      throw err;
    } finally {
      setLoading(false);
    }
  }, [session]);

  return { userId, session, startParking, stopParking, loading };
}
