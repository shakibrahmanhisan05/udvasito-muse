/**
 * Location + directions helpers (specs §6.6/§6.7). One-shot location only,
 * with the donor.setup.locationNote promise: used to pick an area / find
 * the nearest hospital, never stored by the client.
 */
import * as Location from "expo-location";

export type Coords = { lat: number; lng: number };

export async function getCurrentCoordsOnce(): Promise<Coords | null> {
  try {
    const permission = await Location.requestForegroundPermissionsAsync();
    if (permission.status !== "granted") return null;
    const position = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    return { lat: position.coords.latitude, lng: position.coords.longitude };
  } catch {
    return null;
  }
}

/** Google Maps directions deep link (works on web + Android). */
export function directionsUrl(coords: Coords): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${coords.lat},${coords.lng}`;
}

/** Dhaka-formatted time for needed-by / track-record lines. */
export function formatTimeDhaka(ms: number, lang: "en" | "bn"): string {
  try {
    return new Intl.DateTimeFormat(lang === "bn" ? "bn-BD" : "en-GB", {
      timeZone: "Asia/Dhaka",
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    }).format(new Date(ms));
  } catch {
    return new Date(ms).toISOString();
  }
}
