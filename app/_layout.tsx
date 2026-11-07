import { useEffect } from 'react';
import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LocaleProvider } from './_contexts/LocaleContext';
import { LanguagePicker } from './_components/LanguagePicker';
import { AuthProvider } from './_contexts/AuthContext';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  useEffect(() => {
    // Hide splash after a short green branded pause
    const timer = setTimeout(() => {
      SplashScreen.hideAsync();
    }, 1200);
    return () => clearTimeout(timer);
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <LocaleProvider>
          <AuthProvider>
            <StatusBar style="light" />
            <Stack screenOptions={{ headerShown: false }}>
              <Stack.Screen name="(tabs)" />
              <Stack.Screen name="account" options={{ presentation: 'modal' }} />
              <Stack.Screen name="ambassador" options={{ presentation: 'modal' }} />
            </Stack>
            <LanguagePicker />
          </AuthProvider>
        </LocaleProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
