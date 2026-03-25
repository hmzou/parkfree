import React, { useCallback } from 'react';
import {
  View,
  Text,
  Modal,
  StyleSheet,
  TouchableOpacity,
  Linking,
  Platform,
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DirectionsTarget } from '../types';
import { t } from '../i18n';

interface NavApp {
  id: string;
  label: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
  url: (lat: number, lng: number, label: string) => string;
  iosOnly?: boolean;
}

const NAV_APPS: NavApp[] = [
  {
    id: 'google',
    label: 'Google Maps',
    icon: 'navigate-circle-outline',
    url: (lat, lng) =>
      `comgooglemaps://?daddr=${lat},${lng}&directionsmode=driving`,
  },
  {
    id: 'waze',
    label: 'Waze',
    icon: 'car-outline',
    url: (lat, lng) =>
      `waze://?ll=${lat},${lng}&navigate=yes`,
  },
  {
    id: 'apple',
    label: 'Apple Maps',
    icon: 'map-outline',
    url: (lat, lng, label) =>
      `maps://?daddr=${lat},${lng}&q=${encodeURIComponent(label)}`,
    iosOnly: true,
  },
];

interface Props {
  visible: boolean;
  target: DirectionsTarget | null;
  onClose: () => void;
}

export const DirectionsModal: React.FC<Props> = ({ visible, target, onClose }) => {
  const openApp = useCallback(
    async (app: NavApp) => {
      if (!target) return;
      const url = app.url(target.lat, target.lng, target.label);
      const canOpen = await Linking.canOpenURL(url);

      if (!canOpen) {
        // Fallback to browser-based Google Maps
        const webUrl = `https://www.google.com/maps/dir/?api=1&destination=${target.lat},${target.lng}&travelmode=driving`;
        await Linking.openURL(webUrl);
        onClose();
        return;
      }

      await Linking.openURL(url);
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
