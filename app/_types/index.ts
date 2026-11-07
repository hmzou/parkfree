import type { RuleVerdict } from '../_services/parkingRules';

export type SpotSource = 'osm' | 'user';
export type SpotType = 'street' | 'lot' | 'garage';
export type City = 'Ottawa' | 'Gatineau' | 'Unknown';
export type PinStatus = 'available' | 'occupied' | 'time-limited' | 'seasonal-ban';

export interface ParkingSpot {
  id: string;
  source: SpotSource;
  lat: number;
  lng: number;
  type: SpotType;
  feeRequired: boolean;
  /** OSM has no fee tag, so the spot may still be paid */
  feeUnknown?: boolean;
  timeRestrictions: string | null;
  seasonalBan: boolean;
  occupied: boolean;
  occupiedSince: Date | null;
  occupiedBy: string | null;
  occupiedUntil?: Date | null;
  city: City;
  verified?: boolean;
  notes?: string;
  /** City rules in force right now, filled in by useSpots */
  rule?: RuleVerdict;
}

export interface ParkingSession {
  id: string;
  spotId: string;
  userId: string;
  lat: number;
  lng: number;
  startTime: Date;
  endTime: Date | null;
  active: boolean;
  timerMinutes?: number;
  warnMinutes?: number;
  spotType?: string;
  spotCity?: string;
  hitLimit?: boolean;
  /** What the app showed when the user parked, kept as evidence (see ParkingRecord) */
  record?: ParkingRecord;
}

/**
 * Snapshot saved when a session starts, for contesting a ticket: where the car
 * was, which rule the map showed and where that rule came from. Firestore rules
 * make it read-only once written, and the server sets the start and end times.
 */
export interface ParkingRecord {
  /** Street name as shown on the map */
  road: string | null;
  city: string;
  /** Map layer that was tapped: street, permit, paid, free15, or a pin type */
  kind: string;
  /** 'osm' = mapped curb, 'default' = city default rule, 'city' = city meter or permit data */
  basis: string;
  /** The verdict line the user saw, in their language at the time */
  verdict: string;
  /** Latest time the app said the car could stay, ISO 8601; null = no limit */
  leaveBy: string | null;
  /** Posted limit, if mapped */
  maxstay: string | null;
  /** Where the car's position came from */
  positionSource: 'gps' | 'map';
  /** GPS accuracy in metres when positionSource is gps */
  accuracyMeters: number | null;
  /** When the map data was built, ISO 8601 */
  dataAsOf: string | null;
  locale: 'en' | 'fr';
}

export interface UserSpotSubmission {
  submittedBy: string;
  lat: number;
  lng: number;
  type: SpotType;
  notes: string;
  timeRestrictions: string | null;
  city: City;
  createdAt: Date;
  verified: boolean;
}

export interface Coordinate {
  latitude: number;
  longitude: number;
}

export interface TimerState {
  active: boolean;
  durationMinutes: number;
  warnMinutes: number;
  startTime: Date | null;
  elapsedSeconds: number;
  remainingSeconds: number;
  progress: number; // 0..1
  phase: 'green' | 'yellow' | 'red';
}

export interface DirectionsTarget {
  lat: number;
  lng: number;
  label: string;
}

export interface OccupancyReport {
  id: string;
  spotId: string;
  userId: string;
  reportedAt: Date;
}
