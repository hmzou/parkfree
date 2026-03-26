import React, { useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DirectionsTarget } from '../_types';
import { t } from '../_i18n';
import { useLocale } from '../_contexts/LocaleContext';

interface NavApp {
  id: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  /** Native deep-link URL (tried first) */
  url: (lat: number, lng: number, label: string) => string;
  /** Web browser fallback when native app is not installed */
  webUrl: (lat: number, lng: number, label: string) => string;
  iosOnly?: boolean;
}

const NAV_APPS: NavApp[] = [
  {
    id: 'google',
    label: 'Google Maps',
    icon: 'navigate-circle-outline',
    url: (lat, lng) =>
      `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`,
    webUrl: (lat, lng) =>
      `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
  },
  {
    id: 'waze',
    label: 'Waze',
    icon: 'car-outline',
    url: (lat, lng) =>
      `waze://?ll=${lat},${lng}&navigate=yes`,
    webUrl: (lat, lng) =>
      `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`,
  },
  {
    id: 'apple',
    label: 'Apple Maps',
    icon: 'map-outline',
    url: (lat, lng, label) =>
      `maps://?daddr=${lat},${lng}&q=${encodeURIComponent(label)}`,
    webUrl: (lat, lng) =>
      `https://maps.apple.com/?daddr=${lat},${lng}`,
    iosOnly: true,
  },
];

interface Props {
  visible: boolean;
  target: DirectionsTarget | null;
  onClose: () => void;
}

export const DirectionsModal: React.FC<Props> = ({ visible, target, onClose }) => {
  // Subscribe to locale changes so labels update when language is switched
  useLocale();

  const openApp = useCallback(
    async (app: NavApp) => {
      if (!target) return;
      const deepLink = app.url(target.lat, target.lng, target.label);
      const canOpen = await Linking.canOpenURL(deepLink);

      if (!canOpen) {
        // Use each app's own web fallback (not always Google Maps)
        const fallback = app.webUrl(target.lat, target.lng, target.label);
        await Linking.openURL(fallback);
        onClose();
        return;
      }

      await Linking.openURL(deepLink);
      onClose();
    },
    [target, onClose],
  );

  // Filter iOS-only apps on Android
  const apps = NAV_APPS.filter(a => {
    if (a.iosOnly && Platform.OS !== 'ios') return false;
    return true;
  });

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose} />
      <View style={styles.sheet}>
        <View style={styles.handle} />
        <Text style={styles.title}>{t('directions.title')}</Text>
        <Text style={styles.subtitle}>{t('directions.subtitle')}</Text>

        <View style={styles.appsRow}>
          {apps.map(app => (
            <TouchableOpacity
              key={app.id}
              style={styles.appButton}
              onPress={() => openApp(app)}
              activeOpacity={0.7}
            >
              <View style={styles.appIconWrap}>
                <Ionicons name={app.icon} size={28} color="#00C853" />
              </View>
              <Text style={styles.appLabel}>{app.label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={styles.cancelButton} onPress={onClose}>
          <Text style={styles.cancelText}>{t('actions.cancel')}</Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  sheet: {
    backgroundColor: '#1A1A1A',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    padding: 24,
    paddingBottom: 40,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#333',
    alignSelf: 'center',
    marginBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 14,
    color: '#AAA',
    marginBottom: 24,
  },
  appsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 24,
  },
  appButton: {
    alignItems: 'center',
    gap: 8,
  },
  appIconWrap: {
    width: 64,
    height: 64,
    borderRadius: 16,
    backgroundColor: '#2A2A2A',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#333',
  },
  appLabel: {
    fontSize: 12,
    color: '#CCC',
    textAlign: 'center',
  },
  cancelButton: {
    backgroundColor: '#2A2A2A',
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  cancelText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#AAA',
  },
});
