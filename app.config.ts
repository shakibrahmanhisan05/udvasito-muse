import type { ExpoConfig } from "expo/config";

// App identity is fixed by specs.md §1.2.1 — changing package/scheme after the
// first native build means a new app. Do not change without a new ADR.
const config: ExpoConfig = {
  name: "UDVASITO",
  slug: "udvasito",
  version: "0.1.0",
  orientation: "portrait",
  icon: "./assets/icon.png",
  scheme: "udvasito",
  userInterfaceStyle: "light",
  runtimeVersion: { policy: "fingerprint" },
  updates: { fallbackToCacheTimeout: 0 },
  assetBundlePatterns: ["**/*"],
  ios: {
    supportsTablet: true,
    bundleIdentifier: "org.udvasito.app",
    // No native iOS build in v1 (PRD §8) — the web app/PWA serves iPhone users.
  },
  android: {
    package: "org.udvasito.app",
    adaptiveIcon: {
      foregroundImage: "./assets/adaptive-icon.png",
      backgroundColor: "#C1121F",
    },
    permissions: [
      "android.permission.POST_NOTIFICATIONS",
      "android.permission.RECORD_AUDIO",
      "android.permission.ACCESS_COARSE_LOCATION",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.CAMERA",
      "android.permission.INTERNET",
    ],
  },
  web: {
    bundler: "metro",
    output: "single",
    favicon: "./public/favicon.png",
  },
  plugins: [
    "expo-router",
    "expo-font",
    "expo-localization",
    "expo-secure-store",
    [
      "expo-splash-screen",
      {
        image: "./assets/splash-icon.png",
        imageWidth: 200,
        resizeMode: "contain",
        backgroundColor: "#FFFFFF",
      },
    ],
    [
      "expo-notifications",
      {
        icon: "./assets/notification-icon.png",
        color: "#C1121F",
        defaultChannel: "blood-requests",
      },
    ],
    "expo-image-picker",
    "expo-location",
    "@sentry/react-native",
  ],
  experiments: { typedRoutes: true },
  extra: {
    // Populated by EAS (eas init) during RB-7 — human step, see docs/dev/P0-REPORT.md.
    eas: {},
  },
};

export default config;
