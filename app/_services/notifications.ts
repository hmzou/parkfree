import * as Notifications from 'expo-notifications';
import { SchedulableTriggerInputTypes } from 'expo-notifications';
import { Platform } from 'react-native';

// Configure notification handler once at module load
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export async function requestNotificationPermissions(): Promise<boolean> {
  if (Platform.OS === 'web') return false;

  const { status: existing } = await Notifications.getPermissionsAsync();
  if (existing === 'granted') return true;

  const { status } = await Notifications.requestPermissionsAsync();
  return status === 'granted';
}

/**
 * Schedule a warning notification before the timer expires.
 * Returns the notification identifier.
 */
export async function scheduleWarningNotification(
  triggerDate: Date,
  warnMinutes: number,
  spotLabel: string,
  locale: 'en' | 'fr',
): Promise<string> {
  const title = locale === 'fr'
    ? 'Stationnement bientôt expiré'
    : 'Parking expiring soon';
  const body = locale === 'fr'
    ? `Votre stationnement expire dans ${warnMinutes} minutes.`
    : `Your parking expires in ${warnMinutes} minutes.`;

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: { type: 'warning', spot: spotLabel },
      sound: true,
    },
    trigger: { type: SchedulableTriggerInputTypes.DATE, date: triggerDate },
  });

  return id;
}

/**
 * Schedule an expiry notification at the exact timer end.
 */
export async function scheduleExpiryNotification(
  triggerDate: Date,
  spotLabel: string,
  locale: 'en' | 'fr',
): Promise<string> {
  const title = locale === 'fr' ? 'Temps écoulé !' : "Time's up!";
  const body = locale === 'fr'
    ? `Votre minuterie de stationnement a expiré à ${spotLabel}.`
    : `Your parking timer has expired at ${spotLabel}.`;

  const id = await Notifications.scheduleNotificationAsync({
    content: {
      title,
      body,
      data: { type: 'expiry', spot: spotLabel },
      sound: true,
    },
    trigger: { type: SchedulableTriggerInputTypes.DATE, date: triggerDate },
  });

  return id;
}

/**
 * Cancel all pending notifications for a session (pass the IDs returned above).
 */
export async function cancelSessionNotifications(ids: string[]): Promise<void> {
  await Promise.all(ids.map(id => Notifications.cancelScheduledNotificationAsync(id)));
}

/**
 * Cancel ALL scheduled notifications (call on "I'm Leaving").
 */
export async function cancelAllNotifications(): Promise<void> {
  await Notifications.cancelAllScheduledNotificationsAsync();
}

export function addNotificationResponseListener(
  handler: (response: Notifications.NotificationResponse) => void,
) {
  return Notifications.addNotificationResponseReceivedListener(handler);
}
