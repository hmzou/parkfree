import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'ParkFree',
  slug: 'parkfree',
  owner: 'hmzou',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  splash: {
    backgroundColor: '#00C853',
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.parkfree.app',
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'ParkFree needs your location to find free parking near you.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'ParkFree needs your location to notify you when your parking timer expires.',
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#00C853',
    },
    package: 'com.parkfree.app',
    permissions: [
      'ACCESS_FINE_LOCATION',
      'ACCESS_COARSE_LOCATION',
      'RECEIVE_BOOT_COMPLETED',
      'VIBRATE',
    ],
  },
  web: {
    favicon: './assets/favicon.png',
  },
  plugins: [
    'expo-router',
    'expo-dev-client',
    'expo-localization',
    [
      'expo-notifications',
      {
        icon: './assets/notification-icon.png',
        color: '#00C853',
      },
    ],
    [
      'expo-location',
      {
        locationAlwaysAndWhenInUsePermission:
          'ParkFree needs your location to find free parking near you.',
      },
    ],
    [
      '@rnmapbox/maps',
      {
        RNMapboxMapsDownloadToken: process.env.MAPBOX_ACCESS_TOKEN ?? '',
      },
    ],
  ],
  extra: {
    mapboxAccessToken: process.env.MAPBOX_ACCESS_TOKEN,
    firebaseApiKey: process.env.FIREBASE_API_KEY,
    firebaseAuthDomain: process.env.FIREBASE_AUTH_DOMAIN,
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID,
    firebaseStorageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    firebaseMessagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
    firebaseAppId: process.env.FIREBASE_APP_ID,
    eas: {
      projectId: process.env.EAS_PROJECT_ID ?? '8af329eb-81c4-4d1d-a201-8b87727f1d5c',
    },
  },
  scheme: 'parkfree',
});
