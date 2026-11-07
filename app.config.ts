import { ExpoConfig, ConfigContext } from 'expo/config';

// Sign-in providers turn on when their settings exist (see docs/ACCOUNTS.md)
const GOOGLE_WEB_CLIENT_ID = process.env.GOOGLE_WEB_CLIENT_ID ?? '';
const GOOGLE_IOS_CLIENT_ID = process.env.GOOGLE_IOS_CLIENT_ID ?? '';
const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID ?? '';
const APPLE_SIGN_IN = process.env.APPLE_SIGN_IN === '1';

/** com.googleusercontent.apps.<id> — the reversed iOS client id Google sign-in redirects to */
function googleIosUrlScheme(): string | null {
  if (!GOOGLE_IOS_CLIENT_ID) return null;
  return `com.googleusercontent.apps.${GOOGLE_IOS_CLIENT_ID.replace('.apps.googleusercontent.com', '')}`;
}

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'ParkFree',
  slug: 'parkfree',
  owner: 'hamzatheapp',
  version: '1.0.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  splash: {
    image: './assets/splash.png',
    resizeMode: 'contain',
    backgroundColor: '#00C853',
  },
  assetBundlePatterns: ['**/*'],
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.parkfree.app',
    usesAppleSignIn: APPLE_SIGN_IN,
    infoPlist: {
      NSCameraUsageDescription:
        'ParkFree uses the camera when you photograph a parking sign as an ambassador.',
      NSLocationWhenInUseUsageDescription:
        'ParkFree needs your location to find free parking near you.',
      NSLocationAlwaysAndWhenInUseUsageDescription:
        'ParkFree needs your location to notify you when your parking timer expires.',
      ITSAppUsesNonExemptEncryption: false,
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
      'CAMERA',
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
      'expo-build-properties',
      {
        android: {
          kotlinVersion: '1.9.25',
        },
      },
    ],
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
      'expo-image-picker',
      {
        cameraPermission: 'ParkFree uses the camera when you photograph a parking sign as an ambassador.',
        photosPermission: false,
        microphonePermission: false,
      },
    ],
    'expo-apple-authentication',
    ...(googleIosUrlScheme()
      ? [['@react-native-google-signin/google-signin', { iosUrlScheme: googleIosUrlScheme() }] as [string, object]]
      : GOOGLE_WEB_CLIENT_ID ? ['@react-native-google-signin/google-signin'] : []),
    [
      '@rnmapbox/maps',
      {
        RNMapboxMapsDownloadToken: process.env.MAPBOX_SECRET_TOKEN ?? '',
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
    googleWebClientId: GOOGLE_WEB_CLIENT_ID,
    googleIosClientId: GOOGLE_IOS_CLIENT_ID,
    microsoftClientId: MICROSOFT_CLIENT_ID,
    appleSignIn: APPLE_SIGN_IN,
    eas: {
      projectId: process.env.EAS_PROJECT_ID || '0e214edd-8d58-4527-ab7f-88c64f2319e8',
    },
  },
  scheme: 'parkfree',
});
