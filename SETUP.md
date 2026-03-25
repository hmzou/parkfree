# ParkFree — Setup Guide

## 1. Install dependencies

```bash
cd ParkFree
npm install
```

## 2. Fill in environment variables

Copy `.env.example` to `.env` and fill in your keys:

```bash
cp .env.example .env
```

### Mapbox
1. Sign up at https://account.mapbox.com
2. Create a **public token** (`pk.xxx`) — paste into `MAPBOX_ACCESS_TOKEN`
3. Create a **secret token** (`sk.xxx`) with `Downloads:Read` scope for the native SDK download in `app.config.ts`

### Firebase
1. Go to https://console.firebase.google.com
2. Create a project (free Spark plan)
3. Enable **Authentication → Anonymous** sign-in
4. Enable **Firestore Database** in production mode
5. Copy Web App config values into your `.env`
6. Deploy Firestore rules: `firebase deploy --only firestore:rules`
7. Deploy Firestore indexes: `firebase deploy --only firestore:indexes`

## 3. Run the app

```bash
# iOS Simulator (requires macOS + Xcode)
npx expo run:ios

# Android Emulator
npx expo run:android

# Expo Go (limited — Mapbox won't work without a dev build)
npx expo start
```

> **Note:** `@rnmapbox/maps` requires a **development build** (not Expo Go).
> Use `npx expo run:ios` or `npx expo run:android` for the full experience.

## 4. Create a dev build (recommended)

```bash
npm install -g eas-cli
eas login
eas build --profile development --platform ios
```

## 5. Admin — verifying user-submitted spots

User-submitted spots have `verified: false` and won't appear on the map until approved.
To verify a spot, go to your Firebase Console → Firestore → `user_spots` collection
and set `verified: true` on the document.

## Project structure

```
app/
  (tabs)/
    index.tsx       ← Map screen (main)
    profile.tsx     ← Language toggle + session info
  components/
    ParkFreeMapView.tsx
    SpotPin.tsx
    BottomSheet.tsx
    TimerBar.tsx
    DirectionsModal.tsx
    AddSpotModal.tsx
  hooks/
    useLocation.ts
    useSpots.ts
    useSession.ts
    useTimer.ts
  services/
    firebase.ts
    overpass.ts
    notifications.ts
  types/index.ts
  i18n/
    en.json
    fr.json
    index.ts
```
