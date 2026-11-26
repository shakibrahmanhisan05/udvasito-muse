import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Button } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { APP_LANGUAGES, setLanguage, type AppLanguage } from "@/lib/i18n";
import { setLocalConsent } from "@/lib/consent";
import { FALLBACK_APP_CONFIG } from "@/lib/appConfig";
import { authClient, isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";

/**
 * SCR-O01 — Welcome, language & consent (F-101, F-104).
 *
 * Also the re-consent screen (roadmap P6, D-R5): when the settings
 * consentVersion advances past the version a signed-in member
 * accepted, gates G3/ProfileGate send them here; the Privacy/Terms
 * links show the CURRENT bundled texts (their version header equals
 * the current consentVersion), and Continue records the acceptance
 * server-side via consents.accept (which only accepts the current
 * version) before letting them back in.
 */
export default function Welcome() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const [agreed, setAgreed] = useState(false);
  const lang: AppLanguage = i18n.language === "bn" ? "bn" : "en";
  const appConfig = useQuery(refs.appConfig, isAuthConfigured ? {} : "skip");
  const session = authClient.useSession();
  const me = useQuery(refs.me, isAuthConfigured && session.data ? {} : "skip");
  const acceptConsent = useMutation(refs.acceptConsent);
  const currentVersion = appConfig?.consentVersion ?? FALLBACK_APP_CONFIG.consentVersion;

  const infoRows: { text: string; strong: boolean }[] = [
    { text: t("welcome.terms"), strong: true },
    { text: t("welcome.privacy"), strong: true },
    { text: t("welcome.ai"), strong: false },
    { text: t("welcome.voice"), strong: false },
    { text: t("welcome.permissions"), strong: false },
  ];

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Image
        source={require("../../assets/icon.png")}
        style={styles.logo}
        accessibilityLabel={t("common.appName")}
      />
      <Text accessibilityRole="header" style={styles.appName}>
        {t("common.appName")}
      </Text>
      <Text style={styles.tagline}>{t("common.tagline")}</Text>

      <Text style={styles.sectionTitle}>{t("welcome.chooseLanguage")}</Text>
      <View style={styles.langRow}>
        {APP_LANGUAGES.map((l) => (
          <Pressable
            key={l}
            accessibilityRole="button"
            accessibilityState={{ selected: lang === l }}
            onPress={() => void setLanguage(l)}
            style={[styles.langButton, lang === l && styles.langButtonActive]}
          >
            <Text style={[styles.langLabel, lang === l && styles.langLabelActive]}>
              {l === "bn" ? t("common.languageBn") : t("common.languageEn")}
            </Text>
          </Pressable>
        ))}
      </View>

      <Text style={styles.sectionTitle}>{t("welcome.beforeStart")}</Text>
      <View style={styles.card}>
        {infoRows.map((row, i) => (
          <Text key={i} style={row.strong ? styles.rowTitle : styles.rowBody}>
            {row.text}
          </Text>
        ))}
        <View style={styles.legalRow}>
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push("/(onboarding)/privacy")}
            style={styles.legalLink}
          >
            <Text style={styles.legalText}>{t("welcome.privacy")}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push("/(onboarding)/terms")}
            style={styles.legalLink}
          >
            <Text style={styles.legalText}>{t("welcome.terms")}</Text>
          </Pressable>
        </View>
      </View>

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: agreed }}
        accessibilityLabel={t("welcome.consent")}
        onPress={() => setAgreed((v) => !v)}
        style={styles.consentRow}
      >
        <View style={[styles.checkbox, agreed && styles.checkboxChecked]}>
          {agreed ? <Text style={styles.checkmark}>✓</Text> : null}
        </View>
        <Text style={styles.consentText}>{t("welcome.consent")}</Text>
      </Pressable>

      <Button
        label={t("common.continue")}
        disabled={!agreed}
        onPress={() => {
          void (async () => {
            await setLocalConsent({
              consentVersion: currentVersion,
              acceptedAt: Date.now(),
              lang,
            });
            if (session.data && me) {
              // Signed-in member: record the acceptance server-side
              // (re-consent after a version advance, or first server
              // record). consents.accept rejects any version but the
              // current one; if it raced, ProfileGate brings the
              // member back here with fresh config.
              await acceptConsent({
                kind: "terms_privacy",
                version: currentVersion,
                lang,
              }).catch(() => {});
              router.replace("/(app)/home");
              return;
            }
            router.replace("/(onboarding)/sign-in");
          })();
        }}
      />
      <Text style={styles.footer}>{t("common.notBloodBank")}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg.app, flexGrow: 1 },
  logo: { width: 72, height: 72, alignSelf: "center", borderRadius: 16 },
  appName: { ...typography.display, color: colors.text.primary, textAlign: "center" },
  tagline: { ...typography.body, color: colors.text.muted, textAlign: "center" },
  sectionTitle: { ...typography.heading, color: colors.text.primary, marginTop: spacing.md },
  langRow: { flexDirection: "row", gap: spacing.sm },
  langButton: {
    flex: 1,
    minHeight: 52,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border.input,
    alignItems: "center",
    justifyContent: "center",
  },
  langButtonActive: { backgroundColor: colors.brand.primarySoft, borderColor: colors.brand.primary },
  langLabel: { ...typography.bodyStrong, color: colors.text.primary },
  langLabelActive: { color: colors.brand.primary },
  card: { backgroundColor: colors.bg.surface, borderRadius: radius.card, padding: spacing.lg, gap: spacing.md },
  rowTitle: { ...typography.bodyStrong, color: colors.text.primary },
  rowBody: { ...typography.small, color: colors.text.muted },
  consentRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", minHeight: 48 },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border.input,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  checkboxChecked: { backgroundColor: colors.brand.primary, borderColor: colors.brand.primary },
  checkmark: { color: "#fff", fontWeight: "700" },
  consentText: { ...typography.body, color: colors.text.primary, flex: 1 },
  footer: { ...typography.small, color: colors.text.muted, textAlign: "center" },
  legalRow: { flexDirection: "row", gap: spacing.lg },
  legalLink: { minHeight: 48, justifyContent: "center" },
  legalText: { ...typography.bodyStrong, color: colors.brand.primary },
});
