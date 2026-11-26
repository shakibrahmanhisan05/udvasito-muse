import React, { useEffect, useMemo, useState } from "react";
import { Slot, useRouter, useSegments } from "expo-router";
import { Platform, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
import { useFonts } from "expo-font";
// Per-weight subpath imports (P6 perf): importing the package roots
// registers EVERY weight/italic as a bundled asset (27 TTFs ≈ 17 MB
// in the web export); the subpaths register only the 6 fonts used.
import { NotoSans_400Regular } from "@expo-google-fonts/noto-sans/400Regular";
import { NotoSans_600SemiBold } from "@expo-google-fonts/noto-sans/600SemiBold";
import { NotoSans_700Bold } from "@expo-google-fonts/noto-sans/700Bold";
import { NotoSansBengali_400Regular } from "@expo-google-fonts/noto-sans-bengali/400Regular";
import { NotoSansBengali_600SemiBold } from "@expo-google-fonts/noto-sans-bengali/600SemiBold";
import { NotoSansBengali_700Bold } from "@expo-google-fonts/noto-sans-bengali/700Bold";
import { ConvexReactClient, useMutation, useQuery } from "convex/react";
import { ConvexBetterAuthProvider } from "@convex-dev/better-auth/react";
import Constants from "expo-constants";
import { initI18n } from "@/lib/i18n";
import { getLocalConsent, consentSatisfies } from "@/lib/consent";
import { FALLBACK_APP_CONFIG, isVersionBelow } from "@/lib/appConfig";
import { authClient, convexUrl, isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { outbox } from "@/lib/outbox";
// Direct file imports (not the "@/components" barrel): the barrel pulls
// Markdown/PlacePickers and their data into every importer's chunk; the
// root shell needs only these two (P7/X03 bundle budget).
import { OfflineBanner } from "@/components/OfflineBanner";
import { ToastProvider } from "@/components/Toast";
import type { Id } from "@/convex/_generated/dataModel";

export { ErrorBoundary } from "expo-router";

void SplashScreen.preventAutoHideAsync();
// Sentry is initialised lazily from RootLayout's first effect (dynamic
// import): @sentry/react-native's web graph (browser SDK + replay +
// feedback) is ~90% of this chunk's pre-split weight and is never needed
// to render the first screen. The scrubber configuration is unchanged —
// it lives in lib/sentry and applies from the moment init runs.

/**
 * Root layout — providers + global gates G1–G7 (specs §1.5), in order.
 * G1 (version), G2 (fonts/i18n), G3 (consent) and G4 (session) run in
 * useGates below. G5 (onboarding complete) and G6 (account status) run in
 * ProfileGate against profiles.me (P1). G7 (role) shapes tab visibility in
 * the (app) layout. Sign-in stays honest: until GOOGLE_CLIENT_SECRET is set
 * in Convex env, no session can exist and G4 keeps signed-in routes closed.
 */
function useGates(
  fontsLoaded: boolean,
  appConfig: { consentVersion: string } | undefined,
) {
  const segments = useSegments();
  const router = useRouter();
  const session = authClient.useSession();
  // G3 compares the local record against the CURRENT consent version
  // from the server (public.appConfig → settings.consentVersion), not
  // the compiled-in fallback: when the team advances the version after
  // the law review (DEP-02), every older local record stops satisfying
  // the gate and the member re-consents once. The fallback applies
  // only while the backend is unreachable/unconfigured; for signed-in
  // members ProfileGate's server-side needsConsent is the backstop.
  // The appConfig query itself runs in ConfiguredShell — INSIDE the
  // Convex provider. (It used to run here, but useGates is called from
  // components that also render outside the provider, and Convex hooks
  // throw "Could not find Convex client!" without a context — even
  // with "skip". That crashed the first production web build at boot.)
  const [localVersion, setLocalVersion] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      const local = await getLocalConsent();
      setLocalVersion(local?.consentVersion ?? null);
    })();
  }, [segments]);

  const currentVersion = appConfig?.consentVersion ?? FALLBACK_APP_CONFIG.consentVersion;
  const consentOk =
    localVersion !== undefined && consentSatisfies(localVersion, currentVersion);

  // Web Push service worker (public/service-worker.js) — web only.
  useEffect(() => {
    if (Platform.OS === "web" && typeof navigator !== "undefined" && "serviceWorker" in navigator) {
      void navigator.serviceWorker.register("/service-worker.js").catch(() => {
        // Push is an enhancement; the app works without it (specs §6.8).
      });
    }
  }, []);

  useEffect(() => {
    if (!fontsLoaded || localVersion === undefined) return;
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
  }, [fontsLoaded, consentOk, localVersion, segments, session.isPending, session.data, router]);

  return { ready: fontsLoaded && localVersion !== undefined };
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
      // lib/push (expo-notifications) loads lazily: push registration is
      // a signed-in enhancement, never part of the first-screen shell.
      const { getExpoPushToken, getWebPushSubscription } = await import("@/lib/push");
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
        // push.registerExpoToken validates exactly {token} (specs §6.4) —
        // extra args fail Convex validation and the catch below would
        // swallow it, silently losing every Android token (P4 review F1).
        await register({ token }).catch(() => {
          // Push is an enhancement; failure never blocks the app.
        });
      }
    })();
  }, [session.data, register, registerWeb]);

  useEffect(() => {
    if (Platform.OS === "web") return;
    let remove: (() => void) | undefined;
    let cancelled = false;
    void import("expo-notifications").then((Notifications) => {
      if (cancelled) return;
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
      remove = () => sub.remove();
    });
    return () => {
      cancelled = true;
      remove?.();
    };
  }, [markOpened]);
  return null;
}

/**
 * Everything that calls Convex hooks lives inside this shell, which only
 * mounts UNDER ConvexBetterAuthProvider. RootLayout cannot call those
 * hooks itself: it renders the provider, so its own body runs outside it
 * (the first production web build crashed at boot for exactly this).
 */
function ConfiguredShell({ ready }: { ready: boolean }) {
  const appConfig = useQuery(refs.appConfig, {});
  const gates = useGates(ready, appConfig);
  if (!gates.ready) {
    // Splash (logo on white) is still up — render nothing behind it.
    return <View style={{ flex: 1, backgroundColor: "#FFFFFF" }} />;
  }
  return (
    <ToastProvider>
      <OfflineBanner />
      <ProfileGate />
      <PushRegistrar />
      <OutboxFlusher />
      <Slot />
    </ToastProvider>
  );
}

/**
 * No backend configured (EXPO_PUBLIC_* unset): the FALLBACK consent
 * version applies by design, and no Convex hook may mount — the member
 * sees the honest "not configured" sign-in state (specs §1.9).
 */
function UnconfiguredShell({ ready }: { ready: boolean }) {
  const gates = useGates(ready, undefined);
  if (!gates.ready) {
    return <View style={{ flex: 1, backgroundColor: "#FFFFFF" }} />;
  }
  return (
    <ToastProvider>
      <OfflineBanner />
      <Slot />
    </ToastProvider>
  );
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

  // Deferred Sentry init (see the note at the top of this file): the
  // dynamic import keeps the SDK out of the shell chunk on web; on
  // native it resolves immediately. No DSN → initSentry is a no-op.
  useEffect(() => {
    void import("@/lib/sentry")
      .then((m) => m.initSentry())
      .catch(() => {
        // Error reporting is an enhancement; never block the app on it.
      });
  }, []);

  const ready = fontsLoaded && i18nReady;

  useEffect(() => {
    // G2: splash for at most the font/i18n load; system fonts are the fallback.
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  const convex = useMemo(
    () => (isAuthConfigured ? new ConvexReactClient(convexUrl) : null),
    [],
  );

  if (!ready) {
    // Splash (logo on white) is still up — render nothing behind it.
    return <View style={{ flex: 1, backgroundColor: "#FFFFFF" }} />;
  }

  return convex ? (
    <ConvexBetterAuthProvider client={convex} authClient={authClient}>
      <ConfiguredShell ready={ready} />
    </ConvexBetterAuthProvider>
  ) : (
    <UnconfiguredShell ready={ready} />
  );
}
