import React, { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Button, LanguageToggle } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { authClient, isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";

/**
 * SCR-M06 — Settings (P1 minimal): language (synced to the profile),
 * phone display with the change note, legal pages, sign out. Donor alert
 * settings live on SCR-D05 (P2); My Data is P5.
 */
export default function Settings() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const me = useQuery(refs.me, isAuthConfigured ? {} : "skip");
  const updateLanguage = useMutation(refs.updateLanguage);
  const session = authClient.useSession();
  const currentLang = i18n.language === "bn" ? "bn" : "en";

  // Keep the profile language (used for push/SMS copy) in sync with the UI.
  useEffect(() => {
    if (isAuthConfigured && session.data && me && me.language !== currentLang) {
      void updateLanguage({ language: currentLang }).catch(() => {});
    }
  }, [currentLang, me, session.data, updateLanguage]);

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("settings.title")}
      </Text>
      <View style={styles.card}>
        <LanguageToggle />
        {me ? (
          <>
            <Text style={styles.body}>{me.name}</Text>
            <Text style={styles.body}>{me.phone}</Text>
            <Text style={styles.help}>{t("settings.phoneChangeNote")}</Text>
          </>
        ) : null}
      </View>
      <View style={styles.card}>
        <Button
          label={t("welcome.privacy")}
          variant="secondary"
          onPress={() => router.push("/(onboarding)/privacy")}
        />
        <Button
          label={t("welcome.terms")}
          variant="secondary"
          onPress={() => router.push("/(onboarding)/terms")}
        />
      </View>
      {isAuthConfigured && session.data ? (
        <Button
          label={t("settings.signOut")}
          variant="danger"
          onPress={() => void authClient.signOut()}
        />
      ) : null}
      <Text style={styles.help}>{t("common.notBloodBank")}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  help: { ...typography.small, color: colors.text.muted },
  card: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
});
