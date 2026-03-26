import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import {
  initializeAuth,
  getAuth,
  signInAnonymously,
  Auth,
  User,
  onAuthStateChanged,
  type Persistence,
} from 'firebase/auth';
import { Platform } from 'react-native';
import {
  getFirestore,
  Firestore,
  collection,
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  serverTimestamp,
  Timestamp,
  addDoc,
  getDocs,
  DocumentData,
  QuerySnapshot,
  limit,
} from 'firebase/firestore';
import Constants from 'expo-constants';
import { ParkingSpot, ParkingSession, UserSpotSubmission, SpotType, OccupancyReport } from '../_types';

/**
 * Use AsyncStorage-backed auth when the native module exists (current dev/release build).
 * If the binary predates the dependency (Expo Go, old dev client, broken link), require() throws
 * — fall back to getAuth (in-memory) so the app still loads. Rebuild the app to get persistence.
 */
function createAuth(firebaseApp: FirebaseApp): Auth {
  if (Platform.OS === 'web') {
    return getAuth(firebaseApp);
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const AsyncStorage = require('@react-native-async-storage/async-storage').default;
    const { getReactNativePersistence } = require('@firebase/auth/dist/rn/index.js') as {
      getReactNativePersistence: (storage: typeof AsyncStorage) => Persistence;
    };
    return initializeAuth(firebaseApp, {
      persistence: getReactNativePersistence(AsyncStorage),
    });
  } catch {
    return getAuth(firebaseApp);
  }
}

// ─── Firebase init ────────────────────────────────────────────────────────────

const {
  firebaseApiKey,
  firebaseAuthDomain,
  firebaseProjectId,
  firebaseStorageBucket,
  firebaseMessagingSenderId,
  firebaseAppId,
} = Constants.expoConfig?.extra ?? {};

const firebaseConfig = {
  apiKey: firebaseApiKey as string,
  authDomain: firebaseAuthDomain as string,
  projectId: firebaseProjectId as string,
  storageBucket: firebaseStorageBucket as string,
  messagingSenderId: firebaseMessagingSenderId as string,
  appId: firebaseAppId as string,
};

let app: FirebaseApp;
let auth: Auth;

if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);
  auth = createAuth(app);
} else {
  app = getApps()[0];
  auth = getAuth(app);
}

export { auth };
export const db: Firestore = getFirestore(app);

// ─── Auth ─────────────────────────────────────────────────────────────────────

export async function ensureAnonymousAuth(): Promise<User> {
  if (auth.currentUser) return auth.currentUser;
  const cred = await signInAnonymously(auth);
  return cred.user;
}

export function subscribeToAuthState(callback: (user: User | null) => void) {
  return onAuthStateChanged(auth, callback);
}

// ─── Spots helpers ────────────────────────────────────────────────────────────

function spotFromDoc(id: string, data: DocumentData): ParkingSpot {
  return {
    id,
    source: data.source ?? 'osm',
    lat: data.lat,
    lng: data.lng,
    type: data.type ?? 'street',
    feeRequired: data.feeRequired ?? false,
    timeRestrictions: data.timeRestrictions ?? null,
    seasonalBan: data.seasonalBan ?? false,
    occupied: data.occupied ?? false,
    occupiedSince: data.occupiedSince instanceof Timestamp
      ? data.occupiedSince.toDate()
      : null,
    occupiedBy: data.occupiedBy ?? null,
    city: data.city ?? 'Unknown',
    verified: data.verified ?? false,
    notes: data.notes ?? '',
  };
}

/**
 * Subscribe to all verified user-submitted spots and OSM-synced spots in real time.
 * Returns an unsubscribe function.
 */
export function subscribeToSpots(
  onUpdate: (spots: ParkingSpot[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const q = query(
    collection(db, 'spots'),
    where('feeRequired', '==', false),
  );

  return onSnapshot(
    q,
    (snapshot: QuerySnapshot) => {
      const spots = snapshot.docs.map(d => spotFromDoc(d.id, d.data()));
      onUpdate(spots);
    },
    (err) => {
      onError?.(err as Error);
    },
  );
}

/**
 * Subscribe to verified user-submitted spots.
 */
export function subscribeToUserSpots(
  onUpdate: (spots: ParkingSpot[]) => void,
): () => void {
  const q = query(
    collection(db, 'user_spots'),
    where('verified', '==', true),
  );

  return onSnapshot(q, (snapshot) => {
    const spots: ParkingSpot[] = snapshot.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        source: 'user',
        lat: data.lat,
        lng: data.lng,
        type: data.type ?? 'street',
        feeRequired: false,
        timeRestrictions: data.timeRestrictions ?? null,
        seasonalBan: false,
        occupied: false,
        occupiedSince: null,
        occupiedBy: null,
        city: data.city ?? 'Unknown',
        verified: true,
        notes: data.notes ?? '',
      };
    });
    onUpdate(spots);
  });
}

// ─── Occupancy ────────────────────────────────────────────────────────────────

export async function markSpotOccupied(
  spotId: string,
  userId: string,
): Promise<void> {
  await updateDoc(doc(db, 'spots', spotId), {
    occupied: true,
    occupiedSince: serverTimestamp(),
    occupiedBy: userId,
  });
}

export async function markSpotFree(spotId: string): Promise<void> {
  await updateDoc(doc(db, 'spots', spotId), {
    occupied: false,
    occupiedSince: null,
    occupiedBy: null,
  });
}

// ─── Sessions ─────────────────────────────────────────────────────────────────

export async function startSession(
  spotId: string,
  userId: string,
  lat: number,
  lng: number,
  timerMinutes?: number,
  warnMinutes?: number,
  spotType?: string,
  spotCity?: string,
): Promise<string> {
  const ref = await addDoc(collection(db, 'sessions'), {
    spotId,
    userId,
    lat,
    lng,
    startTime: serverTimestamp(),
    endTime: null,
    active: true,
    timerMinutes: timerMinutes ?? null,
    warnMinutes: warnMinutes ?? 10,
    spotType: spotType ?? 'street',
    spotCity: spotCity ?? 'Unknown',
    hitLimit: false,
  });
  return ref.id;
}

export async function endSession(sessionId: string, hitLimit = false): Promise<void> {
  await updateDoc(doc(db, 'sessions', sessionId), {
    endTime: serverTimestamp(),
    active: false,
    hitLimit,
  });
}

export async function getActiveSession(userId: string): Promise<ParkingSession | null> {
  const q = query(
    collection(db, 'sessions'),
    where('userId', '==', userId),
    where('active', '==', true),
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  const data = d.data();
  return {
    id: d.id,
    spotId: data.spotId,
    userId: data.userId,
    lat: data.lat,
    lng: data.lng,
    startTime: data.startTime instanceof Timestamp ? data.startTime.toDate() : new Date(),
    endTime: data.endTime instanceof Timestamp ? data.endTime.toDate() : null,
    active: data.active,
    timerMinutes: data.timerMinutes ?? undefined,
    warnMinutes: data.warnMinutes ?? 10,
    spotType: data.spotType ?? 'street',
    spotCity: data.spotCity ?? 'Unknown',
  };
}

export async function getSessionHistory(userId: string): Promise<ParkingSession[]> {
  const q = query(
    collection(db, 'sessions'),
    where('userId', '==', userId),
    where('active', '==', false),
    orderBy('startTime', 'desc'),
    limit(50),
  );
  const snap = await getDocs(q);
  return snap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      spotId: data.spotId,
      userId: data.userId,
      lat: data.lat,
      lng: data.lng,
      startTime: data.startTime instanceof Timestamp ? data.startTime.toDate() : new Date(),
      endTime: data.endTime instanceof Timestamp ? data.endTime.toDate() : null,
      active: false,
      timerMinutes: data.timerMinutes ?? undefined,
      warnMinutes: data.warnMinutes ?? 10,
      spotType: data.spotType ?? 'street',
      spotCity: data.spotCity ?? 'Unknown',
      hitLimit: data.hitLimit ?? false,
    };
  });
}

// ─── Occupancy reports ────────────────────────────────────────────────────────

/**
 * Submit a crowd-sourced "this spot is taken" report.
 * Deduplicates by userId + spotId + hour (overwrites the existing doc for that hour).
 */
export async function submitOccupancyReport(
  spotId: string,
  userId: string,
): Promise<void> {
  const hourKey = new Date().toISOString().slice(0, 13); // e.g. "2025-06-01T14"
  const docId = `${userId}_${spotId}_${hourKey}`;
  await setDoc(doc(db, 'occupancyReports', docId), {
    spotId,
    userId,
    reportedAt: serverTimestamp(),
  });
}

/**
 * Subscribe to occupancy reports from the last 2 hours.
 * Returns reportCounts keyed by spotId.
 */
export function subscribeToRecentReports(
  onUpdate: (counts: Record<string, number>) => void,
): () => void {
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000);
  const q = query(
    collection(db, 'occupancyReports'),
    where('reportedAt', '>=', Timestamp.fromDate(twoHoursAgo)),
  );

  return onSnapshot(q, (snapshot: QuerySnapshot) => {
    const counts: Record<string, number> = {};
    snapshot.docs.forEach(d => {
      const spotId = d.data().spotId as string;
      counts[spotId] = (counts[spotId] ?? 0) + 1;
    });
    onUpdate(counts);
  });
}

// ─── User-submitted spots ─────────────────────────────────────────────────────

export async function submitUserSpot(
  submission: Omit<UserSpotSubmission, 'createdAt' | 'verified'>,
): Promise<string> {
  const ref = await addDoc(collection(db, 'user_spots'), {
    ...submission,
    createdAt: serverTimestamp(),
    verified: false,
  });
  return ref.id;
}

// ─── OSM spot upsert (called from overpass service) ───────────────────────────

/**
 * Write or merge an OSM spot into Firestore using the spot's own OSM ID as the
 * document key (e.g. "osm_node_123456").  This keeps the Firestore document ID
 * in sync with the in-memory ParkingSpot.id so that occupancy lookups and
 * markSpotOccupied() can find the correct document.
 */
export async function upsertOsmSpot(spot: ParkingSpot): Promise<void> {
  await setDoc(
    doc(db, 'spots', spot.id),
    {
      source: spot.source,
      lat: spot.lat,
      lng: spot.lng,
      type: spot.type,
      feeRequired: spot.feeRequired,
      timeRestrictions: spot.timeRestrictions,
      seasonalBan: spot.seasonalBan,
      occupied: spot.occupied,
      occupiedSince: spot.occupiedSince ? Timestamp.fromDate(spot.occupiedSince) : null,
      occupiedBy: spot.occupiedBy,
      city: spot.city,
      verified: spot.verified ?? true,
      notes: spot.notes ?? '',
    },
    { merge: true },
  );
}
