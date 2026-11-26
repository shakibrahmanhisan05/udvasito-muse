import React, { useEffect, useMemo, useState } from "react";
import { Slot, useRouter, useSegments } from "expo-router";
import { Platform, View } from "react-native";
import * as SplashScreen from "expo-splash-screen";
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
import { ConvexReactClient, ConvexProvider } from "convex/react";
import Constants from "expo-constants";
import { initI18n } from "@/lib/i18n";
import { initSentry } from "@/lib/sentry";
import { getLocalConsent } from "@/lib/consent";
import { FALLBACK_APP_CONFIG, isVersionBelow } from "@/lib/appConfig";
import { authClient, convexUrl, isAuthConfigured } from "@/lib/auth-client";
import { OfflineBanner, ToastProvider } from "@/components";

export { ErrorBoundary } from "expo-router";

void SplashScreen.preventAutoHideAsync();
initSentry();

/**
 * Root layout — providers + global gates G1–G7 (specs §1.5), in order.
 * P0 status: G1 (version), G2 (fonts/i18n) and G3 (consent) are live.
 * G4 (session) is live when the backend is configured. G5 (onboarding
 * complete), G6 (account status) and G7 (role) are skeleton hooks here —
 * they activate with profiles.me wiring in P1, when sign-in first works
 * end to end; their redirect targets (/onboarding, /account-status) are
 * P1 screens (SCR-O03/O06).
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
    const inOnboarding = group === "(onboarding)";
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
    // G5/G6/G7 — skeleton: enforced from P1 via profiles.me (see header).
    void inOnboarding;
  }, [fontsLoaded, consentOk, segments, session.isPending, session.data, router]);

  return { ready: fontsLoaded && consentOk !== null };
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
      <Slot />
    </ToastProvider>
  );
  return convex ? <ConvexProvider client={convex}>{tree}</ConvexProvider> : tree;
}
