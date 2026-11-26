/**
 * Expo Push registration (specs §6.8, F-602). Android: Expo Push token via
 * expo-notifications. Web: Web Push subscription is handled by the service
 * worker flow (PUSH-WEB, P2); on web this is a no-op so callers can invoke
 * it unconditionally. Real-device delivery can only be verified on hardware
 * (see P1-REPORT unverifiable list).
 */
import { Platform } from "react-native";
import Constants from "expo-constants";
import * as Notifications from "expo-notifications";

export async function getExpoPushToken(): Promise<string | null> {
  if (Platform.OS === "web") return null;
  try {
    const permission = await Notifications.getPermissionsAsync();
    let status = permission.status;
    if (status !== "granted") {
      const requested = await Notifications.requestPermissionsAsync();
      status = requested.status;
    }
    if (status !== "granted") return null;
    const projectId =
      Constants.expoConfig?.extra?.eas?.projectId ??
      (Constants as { easConfig?: { projectId?: string } }).easConfig?.projectId;
    const token = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined,
    );
    return token.data;
  } catch {
    return null;
  }
}

export function deviceLabel(): string {
  return `${Platform.OS} · ${Constants.expoConfig?.name ?? "UDVASITO"}`;
}
