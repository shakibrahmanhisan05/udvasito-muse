import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
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
  const appConfig = useQuery(refs.appConfig, isAuthConfigured ? {} : "skip");
  const me = useQuery(refs.me, isAuthConfigured ? {} : "skip");
  const updateLanguage = useMutation(refs.updateLanguage);
  const updateProfile = useMutation(refs.updateProfile);
  const [editName, setEditName] = useState<string | null>(null);
  const [editPhone, setEditPhone] = useState<string | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
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
      {appConfig?.features?.editProfile === true && me ? (
        <View style={styles.card}>
          <TextInput
            style={styles.input}
            value={editName ?? me.name}
            onChangeText={setEditName}
            accessibilityLabel={t("onboarding.name")}
          />
          <TextInput
            style={styles.input}
            value={editPhone ?? me.phone}
            onChangeText={setEditPhone}
            keyboardType="phone-pad"
            accessibilityLabel={t("onboarding.phone")}
          />
          {editError ? <Text style={styles.help}>{editError}</Text> : null}
          <Button
            label={t("common.save")}
            variant="secondary"
            onPress={() => {
              setEditError(null);
              void (async () => {
                try {
                  await updateProfile({
                    ...(editName !== null && editName !== me.name ? { name: editName } : {}),
                    ...(editPhone !== null && editPhone !== me.phone ? { phone: editPhone } : {}),
                  });
                  setEditName(null);
                  setEditPhone(null);
                } catch {
                  setEditError(t("errors.generic"));
                }
              })();
            }}
          />
        </View>
      ) : null}
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
        <Button
          label={t("myData.who")}
          variant="secondary"
          onPress={() => router.push("/(app)/my-data")}
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
  input: {
    borderWidth: 1,
    borderColor: colors.border.input,
    borderRadius: radius.input,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    color: colors.text.primary,
    backgroundColor: colors.bg.app,
  },
  card: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
});
