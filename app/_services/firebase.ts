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
  serverTimestamp,
  Timestamp,
  addDoc,
  deleteDoc,
  getDocs,
  getCountFromServer,
  orderBy,
  limit,
  DocumentData,
  QuerySnapshot,
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
    occupiedUntil: data.occupiedUntil instanceof Timestamp
      ? data.occupiedUntil.toDate()
      : null,
    city: data.city ?? 'Unknown',
    verified: data.verified ?? false,
    notes: data.notes ?? '',
  };
}

/**
 * Subscribe to spots whose hold had not expired when the listener started.
 * Spot docs only exist once someone parks, and filtering on occupiedUntil keeps
 * each app open to a handful of reads instead of the whole collection (the
 * Spark plan allows 50k reads/day). Holds that expire later are dropped
 * client-side by isOccupiedNow.
 */
export function subscribeToSpots(
  onUpdate: (spots: ParkingSpot[]) => void,
  onError?: (err: Error) => void,
): () => void {
  const q = query(
    collection(db, 'spots'),
    where('occupiedUntil', '>', Timestamp.now()),
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
 * Security rules only accept this when the spot is free, already held by this
 * user, or its previous hold has expired.
 */
export async function markSpotOccupied(
  spotId: string,
  userId: string,
  occupiedUntil: Date,
): Promise<void> {
  // setDoc merge creates the doc when the spot only exists in memory (OSM or a
  // community pin) so parking does not fail with "no document to update".
  await setDoc(doc(db, 'spots', spotId), {
    occupied: true,
    occupiedSince: serverTimestamp(),
    occupiedBy: userId,
    occupiedUntil: Timestamp.fromDate(occupiedUntil),
    feeRequired: false,
  }, { merge: true });
}

/** Rejected by security rules unless this user holds the spot or the hold expired. */
export async function markSpotFree(spotId: string): Promise<void> {
  await setDoc(doc(db, 'spots', spotId), {
    occupied: false,
    occupiedSince: null,
    occupiedBy: null,
    occupiedUntil: null,
    feeRequired: false,
  }, { merge: true });
}

/**
 * One doc per parked user under spotOccupants/{spotId}/users/{uid}. Rules only
 * let a user write their own doc, so nobody can inflate or zero another lot's
 * count the way a shared counter would allow.
 */
export async function joinSpotOccupants(
  spotId: string,
  userId: string,
  until: Date,
): Promise<void> {
  await setDoc(doc(db, 'spotOccupants', spotId, 'users', userId), {
    startedAt: serverTimestamp(),
    until: Timestamp.fromDate(until),
  });
}

export async function leaveSpotOccupants(spotId: string, userId: string): Promise<void> {
  await deleteDoc(doc(db, 'spotOccupants', spotId, 'users', userId));
}

/** Live count of unexpired occupants at a spot. */
export function subscribeToSpotOccupantCount(
  spotId: string,
  onUpdate: (activeCount: number) => void,
): () => void {
  return onSnapshot(
    collection(db, 'spotOccupants', spotId, 'users'),
    (snapshot) => {
      const now = Date.now();
      const active = snapshot.docs.filter(d => {
        const until = d.data().until;
        return until instanceof Timestamp && until.toMillis() > now;
      });
      onUpdate(active.length);
    },
    () => onUpdate(0),
  );
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

function sessionFromDoc(id: string, data: DocumentData): ParkingSession {
  return {
    id,
    spotId: data.spotId,
    userId: data.userId,
    lat: data.lat,
    lng: data.lng,
    startTime: data.startTime instanceof Timestamp ? data.startTime.toDate() : new Date(),
    endTime: data.endTime instanceof Timestamp ? data.endTime.toDate() : null,
    active: Boolean(data.active),
    timerMinutes: data.timerMinutes ?? undefined,
    warnMinutes: data.warnMinutes ?? 10,
    spotType: data.spotType ?? 'street',
    spotCity: data.spotCity ?? 'Unknown',
    hitLimit: data.hitLimit ?? false,
  };
}

const HISTORY_LIMIT = 50;
const READ_TIMEOUT_MS = 8_000;

/** Firestore keeps retrying when the API is disabled; screens must not spin forever. */
function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), READ_TIMEOUT_MS);
    promise.then(
      value => { clearTimeout(timer); resolve(value); },
      err => { clearTimeout(timer); reject(err); },
    );
  });
}

/** Equality-only filters are served by single-field indexes, no composite needed. */
export async function getActiveSession(userId: string): Promise<ParkingSession | null> {
  const q = query(
    collection(db, 'sessions'),
    where('userId', '==', userId),
    where('active', '==', true),
    limit(1),
  );
  const snap = await withTimeout(getDocs(q), 'Active session');
  if (snap.empty) return null;
  const d = snap.docs[0];
  return sessionFromDoc(d.id, d.data());
}

function isMissingIndexError(err: unknown): boolean {
  return (err as { code?: string } | null)?.code === 'failed-precondition';
}

/**
 * Uses the userId + startTime index from firestore.indexes.json. Until that
 * index is deployed, falls back to loading every session for the user.
 */
export async function getSessionHistory(userId: string): Promise<ParkingSession[]> {
  let sessions: ParkingSession[];
  try {
    const q = query(
      collection(db, 'sessions'),
      where('userId', '==', userId),
      orderBy('startTime', 'desc'),
      // +1 so an active session in the window does not shorten the list
      limit(HISTORY_LIMIT + 1),
    );
    const snap = await withTimeout(getDocs(q), 'Session history');
    sessions = snap.docs.map(d => sessionFromDoc(d.id, d.data()));
  } catch (err) {
    if (!isMissingIndexError(err)) throw err;
    console.warn('sessions index missing; deploy firestore.indexes.json');
    const snap = await withTimeout(
      getDocs(query(collection(db, 'sessions'), where('userId', '==', userId))),
      'Session history',
    );
    sessions = snap.docs.map(d => sessionFromDoc(d.id, d.data()));
  }
  return sessions
    .filter(session => !session.active)
    .sort((a, b) => b.startTime.getTime() - a.startTime.getTime())
    .slice(0, HISTORY_LIMIT);
}

/** Total sessions this user has started, including an active one. */
export async function countUserSessions(userId: string): Promise<number> {
  const snap = await withTimeout(
    getCountFromServer(query(collection(db, 'sessions'), where('userId', '==', userId))),
    'Session count',
  );
  return snap.data().count;
}

// ─── Occupancy reports ────────────────────────────────────────────────────────

/**
 * Submit a crowd-sourced "this spot is taken" report.
 * One doc per user per spot; reporting again refreshes the timestamp.
 * firestore.rules requires this exact doc ID format.
 */
export async function submitOccupancyReport(
  spotId: string,
  userId: string,
): Promise<void> {
  const docId = `${userId}_${spotId}`;
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

  return onSnapshot(
    q,
    (snapshot: QuerySnapshot) => {
      const counts: Record<string, number> = {};
      snapshot.docs.forEach(d => {
        const spotId = d.data().spotId as string;
        counts[spotId] = (counts[spotId] ?? 0) + 1;
      });
      onUpdate(counts);
    },
    (err) => {
      console.warn('Occupancy reports unavailable:', err);
      onUpdate({});
    },
  );
}

// ─── User-submitted spots ─────────────────────────────────────────────────────

export type StreetColor = 'free' | 'noParking' | 'paid';

/**
 * "Wrong colour?" — a driver says a street line is wrong, like SpotAngels'
 * "Suggest an edit". Stored for review; the bundled dataset is rebuilt from it.
 */
export async function submitMapCorrection(correction: {
  userId: string;
  kind: string;
  road: string | null;
  lat: number;
  lng: number;
  shouldBe: StreetColor;
}): Promise<void> {
  await addDoc(collection(db, 'mapCorrections'), {
    ...correction,
    createdAt: serverTimestamp(),
  });
}

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