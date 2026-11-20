import type { GeoPoint } from '@sibimate/shared';
import * as Location from 'expo-location';

/** In development only: a fixed point for when the device gives none, such as the web build. */
function devLocation(): GeoPoint | null {
  const [lat, lng] = (process.env.EXPO_PUBLIC_DEV_LOCATION ?? '').split(',').map(Number);
  return __DEV__ && Number.isFinite(lat) && Number.isFinite(lng) ? { lat: lat!, lng: lng! } : null;
}

/** The phone's current position, or null when permission is refused or no fix arrives. */
export async function getCurrentPoint(): Promise<GeoPoint | null> {
  try {
    const { granted } = await Location.requestForegroundPermissionsAsync();
    if (granted) {
      const position = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 10_000)),
      ]);
      if (position) {
        return { lat: position.coords.latitude, lng: position.coords.longitude };
      }
    }
  } catch {
    // Falls through to the development point, or to null.
  }
  return devLocation();
}

/** Metres between two points, along the earth's surface. */
export function distanceBetween(a: GeoPoint, b: GeoPoint): number {
  const rad = (degrees: number) => (degrees * Math.PI) / 180;
  const h =
    Math.sin(rad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(rad(b.lng - a.lng) / 2) ** 2;
  return Math.round(2 * 6_371_000 * Math.asin(Math.sqrt(h)));
}

export const formatDistance = (metres: number) =>
  metres < 1000 ? `${Math.max(50, Math.round(metres / 50) * 50)} m` : `${(metres / 1000).toFixed(1)} km`;
