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
  increment,
  getCountFromServer,
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
    freedAt: data.freedAt instanceof Timestamp ? data.freedAt.toDate() : null,
    city: data.city ?? 'Unknown',
    verified: data.verified ?? false,
    notes: data.notes ?? '',
  };
}

/**
 * Subscribe to currently occupied spots in real time. These docs are overlaid on
 * the OSM / user spots by ID; a spot that frees up drops out of the result set
 * and falls back to its default (free) state.
 * Returns an unsubscribe function.
 */
export function subscribeToSpots(
  onUpdate: (spots: ParkingSpot[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const q = query(
    collection(db, 'spots'),
    where('occupied', '==', true),
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

/**
 * setDoc + merge (not updateDoc) so this works for spots that have no Firestore
 * document yet — e.g. a fresh OSM spot or a user-submitted spot.
 * `activeSessions` counts parked users; the business occupancy meter reads it.
 */
export async function markSpotOccupied(
  spot: Pick<ParkingSpot, 'id' | 'lat' | 'lng' | 'type' | 'city'>,
  userId: string,
): Promise<void> {
  await setDoc(
    doc(db, 'spots', spot.id),
    {
      lat: spot.lat,
      lng: spot.lng,
      type: spot.type,
      city: spot.city,
      feeRequired: false,
      occupied: true,
      occupiedSince: serverTimestamp(),
      occupiedBy: userId,
      activeSessions: increment(1),
    },
    { merge: true },
  );
}

export async function markSpotFree(spotId: string): Promise<void> {
  await setDoc(
    doc(db, 'spots', spotId),
    {
      occupied: false,
      occupiedSince: null,
      occupiedBy: null,
      activeSessions: increment(-1),
      freedAt: serverTimestamp(),
    },
    { merge: true },
  );
}

/** How long a freed / reported-open spot is highlighted as "just freed". */
export const JUST_FREED_WINDOW_MS = 15 * 60 * 1000;

/**
 * Subscribe to spots freed (someone left, or reported it open) since
 * JUST_FREED_WINDOW_MS before subscribing. Callers filter by age as time passes.
 * Returns an unsubscribe function.
 */
export function subscribeToRecentlyFreed(
  onUpdate: (freed: Record<string, Date>) => void,
): () => void {
  const since = new Date(Date.now() - JUST_FREED_WINDOW_MS);
  const q = query(
    collection(db, 'spots'),
    where('freedAt', '>=', Timestamp.fromDate(since)),
  );

  return onSnapshot(q, (snapshot: QuerySnapshot) => {
    const freed: Record<string, Date> = {};
    snapshot.docs.forEach(d => {
      const at = d.data().freedAt;
      if (at instanceof Timestamp) freed[d.id] = at.toDate();
    });
    onUpdate(freed);
  }, (err) => console.warn('Freed spots error:', err));
}

/**
 * Crowd report: "this spot is open". Clears occupancy, flags the spot as just
 * freed for everyone, and logs the report so it counts as a contribution.
 */
export async function reportSpotOpen(
  spot: Pick<ParkingSpot, 'id' | 'lat' | 'lng' | 'type' | 'city'>,
  userId: string,
): Promise<void> {
  await setDoc(
    doc(db, 'spots', spot.id),
    {
      lat: spot.lat,
      lng: spot.lng,
      type: spot.type,
      city: spot.city,
      feeRequired: false,
      occupied: false,
      occupiedSince: null,
      occupiedBy: null,
      freedAt: serverTimestamp(),
    },
    { merge: true },
  );
  const hourKey = new Date().toISOString().slice(0, 13);
  await setDoc(doc(db, 'occupancyReports', `${userId}_${spot.id}_${hourKey}_open`), {
    spotId: spot.id,
    userId,
    kind: 'open',
    reportedAt: serverTimestamp(),
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
    kind: 'taken',
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
      const data = d.data();
      if (data.kind === 'open') return; // "open" reports are surfaced via freedAt
      const spotId = data.spotId as string;
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

// ─── Profile stats ────────────────────────────────────────────────────────────

/** Number of parking sessions (active or past) this user has started. */
export async function getSessionCount(userId: string): Promise<number> {
  const snap = await getCountFromServer(
    query(collection(db, 'sessions'), where('userId', '==', userId)),
  );
  return snap.data().count;
}

/** Number of crowd reports ("full" or "open") this user has submitted. */
export async function getReportCount(userId: string): Promise<number> {
  const snap = await getCountFromServer(
    query(collection(db, 'occupancyReports'), where('userId', '==', userId)),
  );
  return snap.data().count;
}
