# ParkFree

![Expo SDK](https://img.shields.io/badge/Expo-SDK%2052-000020?logo=expo&logoColor=white)
![React Native](https://img.shields.io/badge/React%20Native-0.76-61DAFB?logo=react&logoColor=white)
![Firebase](https://img.shields.io/badge/Firebase-Firestore-FFCA28?logo=firebase&logoColor=black)
![Platform](https://img.shields.io/badge/Platform-Android%20%7C%20iOS-lightgrey)
![License](https://img.shields.io/badge/License-MIT-green)

Free parking finder for **Ottawa & Gatineau** — real-time street parking spots from OpenStreetMap, crowd-sourced occupancy reports, and smart session timers.

---

## Features

- **Pin clustering** — Mapbox ShapeSource/CircleLayer clusters that expand on tap, color-coded by density (green → orange → red)
- **Spot type colors** — green (free), amber (time-restricted), gray (fee required), deep orange (seasonal ban / high reports), red (occupied)
- **Proximity gate** — "Park Here" button only activates within 150 m of the selected spot
- **3-snap bottom sheet** — Peek (110 px) / Half (320 px) / Full (screen − 100 px) via `@gorhom/bottom-sheet`
- **Cached spots** — AsyncStorage cache with 30-min TTL; stale data shown at 50% opacity with an offline banner
- **Crowd-sourced occupancy** — submit/view occupancy reports (Firestore, 2-hour rolling window, deduplicated per user)
- **History tab** — full list of past parking sessions with duration, spot type, city, and "limit hit" badge
- **Smart notifications** — warning + expiry alerts for timed spots; 3-hour reminder for untimed sessions
- **Bilingual (EN / FR)** — full i18n with live language toggle in the Profile tab
- **Directions** — opens Google Maps, Waze, or Apple Maps (iOS) with correct per-app web fallback
- **Search this area** — manual pill button replaces auto-fetch on map drag

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | Expo SDK 52, React Native 0.76.5 |
| Navigation | expo-router v4 (file-based, tab layout) |
| Map | @rnmapbox/maps (Mapbox GL) |
| Backend | Firebase Firestore (anonymous auth) |
| Local storage | @react-native-async-storage/async-storage |
| Notifications | expo-notifications |
| Bottom sheet | @gorhom/bottom-sheet |
| i18n | i18n-js |
| Parking data | OpenStreetMap via Overpass API |
| Build / OTA | Expo EAS Build |

## Prerequisites

- Node 18+
- Expo CLI (`npm install -g expo-cli`)
- EAS CLI (`npm install -g eas-cli`)
- A [Mapbox](https://account.mapbox.com/) account with a public token
- A Firebase project with Firestore enabled and anonymous auth turned on

## Setup

1. **Clone the repo**

   ```bash
   git clone https://github.com/hmzou/parkfree.git
   cd parkfree
   ```

2. **Install dependencies**

   ```bash
   npm install --legacy-peer-deps
   ```

3. **Configure environment variables**

   Create a `.env` file in the project root:

   ```env
   MAPBOX_ACCESS_TOKEN=pk.your_mapbox_token_here
   FIREBASE_API_KEY=your_key
   FIREBASE_AUTH_DOMAIN=your_project.firebaseapp.com
   FIREBASE_PROJECT_ID=your_project_id
   FIREBASE_STORAGE_BUCKET=your_project.appspot.com
   FIREBASE_MESSAGING_SENDER_ID=your_sender_id
   FIREBASE_APP_ID=your_app_id
   ```

4. **Start the development server**

   ```bash
   npx expo start
   ```

## Testing on Device

### Android (EAS development build)

```bash
eas build --platform android --profile development
```

**Latest build:**
[https://expo.dev/accounts/hmzou/projects/parkfree/builds/b918bd9b-7bab-41e7-b884-d08f1ed1873b](https://expo.dev/accounts/hmzou/projects/parkfree/builds/b918bd9b-7bab-41e7-b884-d08f1ed1873b)

Scan the QR code on that page from your Android device to install directly.

### iOS (EAS development build)

```bash
eas build --platform ios --profile development
```

## Project Structure

```
app/
  (tabs)/          # Tab screens: map, history, profile
  _components/     # Reusable UI: BottomSheet, TimerBar, MapView, DirectionsModal
  _contexts/       # React contexts: SessionContext, LocaleContext
  _hooks/          # Custom hooks: useSession, useSpots, useLocation, useTimer
  _i18n/           # EN/FR translation files
  _services/       # Firebase, Overpass API, notifications
  _layout.tsx      # Root layout (GestureHandlerRootView, SafeAreaProvider)
```

## Contributing

Pull requests are welcome. For major changes, open an issue first to discuss what you'd like to change.

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'feat: add my feature'`)
4. Push to the branch (`git push origin feature/my-feature`)
5. Open a pull request

## License

[MIT](LICENSE)
