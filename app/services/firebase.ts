import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import {
  getAuth,
  signInAnonymously,
  Auth,
  User,
  onAuthStateChanged,
} from 'firebase/auth';
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
} from 'firebase/firestore';
import Constants from 'expo-constants';
import { ParkingSpot, ParkingSession, UserSpotSubmission, SpotType } from '../types';

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
if (getApps().length === 0) {
  app = initializeApp(firebaseConfig);
} else {
  app = getApps()[0];
}

export const auth: Auth = getAuth(app);
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
  });
  return ref.id;
}

export async function endSession(sessionId: string): Promise<void> {
  await updateDoc(doc(db, 'sessions', sessionId), {
    endTime: serverTimestamp(),
    active: false,
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
  };
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

export async function upsertOsmSpot(spot: Omit<ParkingSpot, 'id'>): Promise<void> {
  await setDoc(
    doc(db, 'spots', `osm_${spot.lat}_${spot.lng}`),
    {
      ...spot,
      occupiedSince: spot.occupiedSince ? Timestamp.fromDate(spot.occupiedSince) : null,
    },
    { merge: true },
  );
}
