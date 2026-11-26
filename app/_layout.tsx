import React, { useEffect, useMemo, useState } from "react";
import { Slot, useRouter, useSegments } from "expo-router";
import { Platform, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import * as Notifications from "expo-notifications";
import {
  useFonts,
  NotoSans_400Regular,
  NotoSans_600SemiBold,
  NotoSans_700Bold,
} from "@expo-google-fonts/noto-sans";
import {
  NotoSansBengali_400Regular,
  NotoSansBengali_600SemiBold,
  NotoSansBengali_700Bold,
} from "@expo-google-fonts/noto-sans-bengali";
import { ConvexReactClient, useMutation, useQuery } from "convex/react";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import Constants from "expo-constants";
import { initI18n } from "@/lib/i18n";
import { initSentry } from "@/lib/sentry";
import { getLocalConsent } from "@/lib/consent";
import { FALLBACK_APP_CONFIG, isVersionBelow } from "@/lib/appConfig";
import { authClient, convexUrl, isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { deviceLabel, getExpoPushToken, getWebPushSubscription } from "@/lib/push";
import { outbox } from "@/lib/outbox";
import { OfflineBanner, ToastProvider } from "@/components";
import type { Id } from "@/convex/_generated/dataModel";

export { ErrorBoundary } from "expo-router";

void SplashScreen.preventAutoHideAsync();
initSentry();

/**
 * Root layout — providers + global gates G1–G7 (specs §1.5), in order.
 * G1 (version), G2 (fonts/i18n), G3 (consent) and G4 (session) run in
 * useGates below. G5 (onboarding complete) and G6 (account status) run in
 * ProfileGate against profiles.me (P1). G7 (role) shapes tab visibility in
 * the (app) layout. Sign-in stays honest: until GOOGLE_CLIENT_SECRET is set
 * in Convex env, no session can exist and G4 keeps signed-in routes closed.
 */
function useGates(fontsLoaded: boolean) {
  const segments = useSegments();
  const router = useRouter();
  const session = authClient.useSession();
  const [consentOk, setConsentOk] = useState<boolean | null>(null);

  useEffect(() => {
    void (async () => {
      const local = await getLocalConsent();
      setConsentOk(Boolean(local && local.consentVersion === FALLBACK_APP_CONFIG.consentVersion));
    })();
  }, [segments]);

  // Web Push service worker (public/service-worker.js) — web only.
  useEffect(() => {
    if (Platform.OS === "web" && typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/service-worker.js").catch(() => {
        // Push is an enhancement; the app works without it (specs §6.8).
      });
    }
  }, []);

  useEffect(() => {
    if (!fontsLoaded || consentOk === null) return;
    const group = segments[0];
    const inApp = group === "(app)";
    const route = segments[segments.length - 1];

    // G1 — version gate (native; web always serves the latest build).
    const version = Constants.expoConfig?.version ?? FALLBACK_APP_CONFIG.minimumAppVersion;
    if (isVersionBelow(version, FALLBACK_APP_CONFIG.minimumAppVersion) && route !== "update-required") {
      router.replace("/(onboarding)/update-required");
      return;
    }
    // G3 — consent gate: action routes need consent for the current version.
    if (!consentOk && inApp) {
      router.replace("/(onboarding)/welcome");
      return;
    }
    // G4 — session gate (only meaningful once the backend is configured).
    if (isAuthConfigured && inApp && !session.isPending && !session.data) {
      router.replace("/(onboarding)/sign-in");
      return;
    }
  }, [fontsLoaded, consentOk, segments, session.isPending, session.data, router]);

  return { ready: fontsLoaded && consentOk !== null };
}

/** G5/G6 — profile completeness + account status, from profiles.me. */
function ProfileGate() {
  const segments = useSegments();
  const router = useRouter();
  const session = authClient.useSession();
  const me = useQuery(refs.me, isAuthConfigured && session.data ? {} : "skip");

  useEffect(() => {
    if (!session.data || me === undefined) return;
    const group = segments[0];
    const route = segments[segments.length - 1];
    if (me === null) {
      // Signed in but no profile yet → SCR-O03 (unless already onboarding).
      if (group !== "(onboarding)") router.replace("/(onboarding)/onboarding");
      return;
    }
    if (me.needsConsent) {
      if (route !== "welcome") router.replace("/(onboarding)/welcome");
      return;
    }
    if (me.status !== "active") {
      if (route !== "account-status") router.replace("/(onboarding)/account-status");
    }
  }, [me, session.data, segments, router]);
  return null;
}

/**
 * Offline outbox flush (F-207): on sign-in/app start, post anything
 * queued while offline. The server dedupes by clientId, so flushing
 * is always safe to retry.
 */
function OutboxFlusher() {
  const session = authClient.useSession();
  const create = useMutation(refs.requestsCreate);

  useEffect(() => {
    if (!session.data || !isAuthConfigured) return;
    void outbox
      .flush(async (item) => {
        await create(item.payload as never);
      })
      .catch(() => {
        // Still offline — the queue keeps the items for next time.
      });
  }, [session.data, create]);

  return null;
}

/** Expo Push token registration + notification-opened wiring (§6.8).
 *  On web, registers the browser's Web Push subscription instead (F-303). */
function PushRegistrar() {
  const session = authClient.useSession();
  const register = useMutation(refs.pushRegisterExpoToken);
  const registerWeb = useMutation(refs.pushRegisterWebSubscription);
  const markOpened = useMutation(refs.notificationsMarkOpened);

  useEffect(() => {
    if (!session.data || !isAuthConfigured) return;
    void (async () => {
      if (Platform.OS === "web") {
        const subscription = await getWebPushSubscription();
        if (subscription) {
          await registerWeb(subscription).catch(() => {
            // Push is an enhancement; failure never blocks the app.
          });
        }
        return;
      }
      const token = await getExpoPushToken();
      if (token) {
        await register({
          token,
          platform: Platform.OS === "ios" ? "ios" : "android",
          deviceLabel: deviceLabel(),
        }).catch(() => {
          // Push is an enhancement; failure never blocks the app.
        });
      }
    })();
  }, [session.data, register, registerWeb]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as {
        notificationId?: string;
      };
      if (data?.notificationId) {
        void markOpened({
          notificationId: data.notificationId as Id<"notifications">,
        }).catch(() => {});
      }
    });
    return () => sub.remove();
  }, [markOpened]);
  return null;
}

export default function RootLayout() {
  const [fontsLoaded] = useFonts({
    NotoSans_400Regular,
    NotoSans_600SemiBold,
    NotoSans_700Bold,
    NotoSansBengali_400Regular,
    NotoSansBengali_600SemiBold,
    NotoSansBengali_700Bold,
  });
  const [i18nReady, setI18nReady] = useState(false);

  useEffect(() => {
    void initI18n().then(() => setI18nReady(true));
  }, []);

  const ready = fontsLoaded && i18nReady;
  const gates = useGates(ready);

  useEffect(() => {
    // G2: splash for at most the font/i18n load; system fonts are the fallback.
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  const convex = useMemo(
    () => (isAuthConfigured ? new ConvexReactClient(convexUrl) : null),
    [],
  );

  if (!ready || !gates.ready) {
    // Splash (logo on white) is still up — render nothing behind it.
    return <View style={{ flex: 1, backgroundColor: "#FFFFFF" }} />;
  }

  const tree = (
    <ToastProvider>
      <OfflineBanner />
      <ProfileGate />
      <PushRegistrar />
      <OutboxFlusher />
      <Slot />
    </ToastProvider>
  );
  return convex ? (
    <ConvexBetterAuthProvider client={convex} authClient={authClient}>
      {tree}
    </ConvexBetterAuthProvider>
  ) : (
    tree
  );
}
