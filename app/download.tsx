import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Linking, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "convex/react";
import { Button } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";

/**
 * SCR-P08 — Download (specs §3.7, final form).
 *
 * Android: the big APK button + version + SHA-256 checksum are driven
 * entirely by public.appConfig (apkUrl / latestAppVersion / apkSha256
 * settings, set when the team publishes a GitHub Release — ADR-007);
 * nothing renders until a real release exists. The 4-step install
 * guide, the iPhone "Add to Home Screen" guide and the section titles
 * have no i18n keys in specs (I18N-GAPS #71: the whole page is
 * unkeyed) — held in consts below from SCR-P08's own wording, pending
 * member 3's key review. Desktop: the PWA Install button appears only
 * where the browser offers beforeinstallprompt.
 */
const ANDROID_TITLE = "Android";
const DOWNLOAD_APK = "Download APK";
const VERSION_LABEL = "Version";
const CHECKSUM_LABEL = "SHA-256 checksum";
const INSTALL_STEPS = [
  "Download the APK file.",
  "Open the downloaded file.",
  "If asked, allow installs from this source (your browser).",
  "Tap Install, then open UDVASITO.",
];
const WEB_TITLE = "Web app";
const IPHONE_TITLE = "iPhone";
const IPHONE_STEPS = [
  "Open this page in Safari.",
  "Tap the Share button.",
  "Tap “Add to Home Screen”.",
];
const IPHONE_NOTE =
  "Alerts work on iOS 16.4 and later, after adding UDVASITO to your Home Screen.";
const DESKTOP_TITLE = "Desktop";
const INSTALL_APP = "Install app";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: string }>;
};

function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof window === "undefined") return;
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);
  return deferred;
}

export default function Download() {
  const { t } = useTranslation();
  const appConfig = useQuery(refs.appConfig, isAuthConfigured ? {} : "skip");
  const installPrompt = useInstallPrompt();
  const apkUrl = appConfig?.apkUrl ?? "";
  const apkSha256 = appConfig?.apkSha256 ?? "";

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("common.appName")}
      </Text>
      <Text style={styles.body}>{t("common.tagline")}</Text>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {ANDROID_TITLE}
        </Text>
        {apkUrl ? (
          <>
            <Button
              label={DOWNLOAD_APK}
              onPress={() => void Linking.openURL(apkUrl)}
            />
            {appConfig?.latestAppVersion ? (
              <Text style={styles.body}>
                {`${VERSION_LABEL}: ${appConfig.latestAppVersion}`}
              </Text>
            ) : null}
            {apkSha256 ? (
              <>
                <Text style={styles.label}>{CHECKSUM_LABEL}</Text>
                <Text selectable style={styles.checksum}>
                  {apkSha256}
                </Text>
              </>
            ) : null}
            {INSTALL_STEPS.map((step, i) => (
              <View key={step} style={styles.stepRow}>
                <View style={styles.stepBadge}>
                  <Text style={styles.stepNumber}>{i + 1}</Text>
                </View>
                <Text style={styles.stepText}>{step}</Text>
              </View>
            ))}
          </>
        ) : null}
        <Text style={styles.label}>{WEB_TITLE}</Text>
        <Button
          label={t("update.useWeb")}
          variant="secondary"
          onPress={() => void Linking.openURL("/")}
        />
      </View>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {IPHONE_TITLE}
        </Text>
        {IPHONE_STEPS.map((step, i) => (
          <View key={step} style={styles.stepRow}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepNumber}>{i + 1}</Text>
            </View>
            <Text style={styles.stepText}>{step}</Text>
          </View>
        ))}
        <Text style={styles.body}>{IPHONE_NOTE}</Text>
      </View>

      {installPrompt ? (
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            {DESKTOP_TITLE}
          </Text>
          <Button
            label={INSTALL_APP}
            variant="secondary"
            onPress={() => {
              void installPrompt.prompt();
            }}
          />
        </View>
      ) : null}

      <Text style={styles.footer}>{t("common.notBloodBank")}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  sectionTitle: { ...typography.heading, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  label: { ...typography.bodyStrong, color: colors.text.primary },
  checksum: { ...typography.small, color: colors.text.muted },
  card: {
    backgroundColor: colors.bg.surface, borderRadius: radius.card,
    padding: spacing.lg, gap: spacing.md,
  },
  stepRow: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  stepBadge: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brand.primary,
    alignItems: "center", justifyContent: "center",
  },
  stepNumber: { color: "#fff", fontWeight: "700" },
  stepText: { ...typography.body, color: colors.text.primary, flex: 1 },
  footer: { ...typography.small, color: colors.text.muted, textAlign: "center" },
});
