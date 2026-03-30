import Constants from 'expo-constants';

const MAPBOX_TOKEN =
  (Constants.expoConfig?.extra?.mapboxAccessToken as string) ?? '';

const GEOCODING_BASE = 'https://api.mapbox.com/geocoding/v5/mapbox.places';

// Ottawa / Gatineau region proximity hint so results are biased locally
const PROXIMITY = '-75.6972,45.4215'; // Ottawa city centre

export interface GeocodingResult {
  placeName: string;
  latitude: number;
  longitude: number;
  /** True when the result is likely a business/POI rather than a pure address */
  isBusiness: boolean;
  /** Short display name (first part before the first comma) */
  shortName: string;
  /** Mapbox feature type, e.g. "poi", "address", "neighborhood" */
  featureType: string;
}

/**
 * Geocode a free-text query using the Mapbox Geocoding API.
 * Returns the top result, or null if nothing was found.
 */
export async function geocodeAddress(
  query: string,
): Promise<GeocodingResult | null> {
  if (!query.trim()) return null;

  const url =
    `${GEOCODING_BASE}/${encodeURIComponent(query)}.json` +
    `?access_token=${MAPBOX_TOKEN}` +
    `&country=ca` +
    `&bbox=-76.3548,45.2520,-75.2467,45.5505` + // Ottawa + Gatineau combined bbox
    `&proximity=${PROXIMITY}` +
    `&limit=1` +
    `&language=en,fr`;

  const response = await fetch(url);
  if (!response.ok) throw new Error(`Geocoding error: ${response.status}`);

  const json = await response.json();
  const features: GeocodingFeature[] = json.features ?? [];
  if (features.length === 0) return null;

  const feature = features[0];
  const [lng, lat] = feature.center;
  const placeTypes: string[] = feature.place_type ?? [];
  const featureType = placeTypes[0] ?? 'address';
  const isBusiness = placeTypes.includes('poi');

  const shortName = (feature.text ?? feature.place_name ?? query).split(',')[0].trim();

  return {
    placeName: feature.place_name ?? query,
    latitude: lat,
    longitude: lng,
    isBusiness,
    shortName,
    featureType,
  };
}

/**
 * Forward-geocode and return multiple suggestions (for autocomplete use).
 * Returns up to 5 results.
 */
export async function geocodeSuggestions(
  query: string,
): Promise<GeocodingResult[]> {
  if (!query.trim() || query.trim().length < 3) return [];

  const url =
    `${GEOCODING_BASE}/${encodeURIComponent(query)}.json` +
    `?access_token=${MAPBOX_TOKEN}` +
    `&country=ca` +
    `&bbox=-76.3548,45.2520,-75.2467,45.5505` +
    `&proximity=${PROXIMITY}` +
    `&limit=5` +
    `&language=en,fr`;

  const response = await fetch(url);
  if (!response.ok) return [];

  const json = await response.json();
  const features: GeocodingFeature[] = json.features ?? [];

  return features.map(feature => {
    const [lng, lat] = feature.center;
    const placeTypes: string[] = feature.place_type ?? [];
    const featureType = placeTypes[0] ?? 'address';
    const isBusiness = placeTypes.includes('poi');
    const shortName = (feature.text ?? feature.place_name ?? query).split(',')[0].trim();

    return {
      placeName: feature.place_name ?? query,
      latitude: lat,
      longitude: lng,
      isBusiness,
      shortName,
      featureType,
    };
  });
}

// ─── Internal Mapbox Feature type ─────────────────────────────────────────────

interface GeocodingFeature {
  id: string;
  type: 'Feature';
  place_type: string[];
  text: string;
  place_name: string;
  center: [number, number]; // [lng, lat]
  properties?: Record<string, unknown>;
}
