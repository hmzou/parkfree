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
  timeRestrictions: string | null;
  seasonalBan: boolean;
  occupied: boolean;
  occupiedSince: Date | null;
  occupiedBy: string | null;
  city: City;
  verified?: boolean;
  notes?: string;
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
}

export interface UserSpotSubmission {
  submittedBy: string;
  lat: number;
  lng: number;
  type: SpotType;
  notes: string;
  timeRestrictions: string | null;
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
