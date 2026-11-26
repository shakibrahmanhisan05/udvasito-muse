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

// ── Web Push (F-303) ───────────────────────────────────────────────────

export type WebPushSubscriptionData = {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
};

function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bufferToBase64Url(buf: ArrayBuffer | null): string {
  if (!buf) return "";
  const bytes = new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return window.btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Subscribe this browser to Web Push and return the subscription for
 * push.registerWebSubscription — or null when Web Push cannot work
 * here: not web, no service worker/PushManager (e.g. iPhone Safari
 * before "Add to Home Screen", iOS 16.4+), no VAPID public key in the
 * build env, or permission denied. Null is honest: callers show the
 * alert guide's iOS note instead of pretending alerts are on.
 */
export async function getWebPushSubscription(): Promise<WebPushSubscriptionData | null> {
  if (Platform.OS !== "web") return null;
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return null;
    const vapidPublicKey = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidPublicKey) return null;
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return null;
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidPublicKey),
      }));
    return {
      endpoint: subscription.endpoint,
      p256dh: bufferToBase64Url(subscription.getKey("p256dh")),
      auth: bufferToBase64Url(subscription.getKey("auth")),
      userAgent: navigator.userAgent,
    };
  } catch {
    return null;
  }
}
