/**
 * Business Parking Service
 *
 * Looks up whether a business (identified by its geocoded name) has an
 * associated parking lot in the `businessParking` Firestore collection.
 *
 * Document schema for `businessParking/{id}`:
 *   name        string   — canonical business name (lower-cased for matching)
 *   spotId      string   — Firestore spot document ID
 *   capacity    number   — max number of parking spaces (used to compute occupancy %)
 *
 * The occupancy count comes from the `sessions` collection: active sessions
 * whose spotId matches.
 */

import {
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
} from 'firebase/firestore';
import { db } from './firebase';

export interface BusinessParkingRecord {
  id: string;
  name: string;
  spotId: string;
  capacity: number;
}

/**
 * Look up a business by name.
 * Matches on a lower-cased `nameLower` field stored in Firestore.
 * Returns the first match, or null.
 */
export async function getBusinessParking(
  businessName: string,
): Promise<BusinessParkingRecord | null> {
  const nameLower = businessName.toLowerCase().trim();

  // Try exact match first
  const exactQ = query(
    collection(db, 'businessParking'),
    where('nameLower', '==', nameLower),
  );
  const exactSnap = await getDocs(exactQ);
  if (!exactSnap.empty) {
    const d = exactSnap.docs[0];
    const data = d.data();
    return {
      id: d.id,
      name: data.name as string,
      spotId: data.spotId as string,
      capacity: (data.capacity as number) ?? 20,
    };
  }

  // Try prefix/contains match using a range query on nameLower
  // (Firestore doesn't support full-text search, so we do a starts-with)
  const prefixQ = query(
    collection(db, 'businessParking'),
    where('nameLower', '>=', nameLower),
    where('nameLower', '<', nameLower + '\uf8ff'),
  );
  const prefixSnap = await getDocs(prefixQ);
  if (!prefixSnap.empty) {
    const d = prefixSnap.docs[0];
    const data = d.data();
    return {
      id: d.id,
      name: data.name as string,
      spotId: data.spotId as string,
      capacity: (data.capacity as number) ?? 20,
    };
  }

  return null;
}

/**
 * Subscribe to the live occupancy count for a given spotId.
 * Counts active parking sessions at that spot.
 * Returns an unsubscribe function.
 */
export function subscribeToLotOccupancy(
  spotId: string,
  onUpdate: (activeCount: number) => void,
): () => void {
  const q = query(
    collection(db, 'sessions'),
    where('spotId', '==', spotId),
    where('active', '==', true),
  );

  return onSnapshot(q, snapshot => {
    onUpdate(snapshot.size);
  });
}
