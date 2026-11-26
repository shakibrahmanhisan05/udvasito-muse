import React from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "convex/react";
import { Button, LanguageToggle } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { authClient, isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";

/** SCR-M10 — More menu (P1): settings, donor, verify-in-person for
 * volunteers/admins, legal, download, sign out. Later phases add the
 * assistant, learn and volunteer-apply entries with their screens. */
// Specs §3.6 prose screen names without i18n keys (I18N-GAPS §4),
// pending member 3's key review.
const MODERATION_QUEUE = "Moderation queue";
const AUDIT_LOG = "Audit log";

export default function More() {
  const { t } = useTranslation();
  const router = useRouter();
  const session = authClient.useSession();
  const me = useQuery(refs.me, isAuthConfigured ? {} : "skip");
  const canVerify =
    me?.role === "volunteer" || me?.role === "admin" || me?.role === "superadmin";

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("nav.more")}
      </Text>
      <View style={styles.card}>
        <Button
          label={t("settings.title")}
          variant="secondary"
          onPress={() => router.push("/(app)/settings")}
        />
        <Button
          label={t("donor.setup.title")}
          variant="secondary"
          onPress={() => router.push("/(app)/donor")}
        />
        {canVerify ? (
          <Button
            label={t("verifyInPerson.title")}
            variant="secondary"
            onPress={() => router.push("/(app)/verify-in-person")}
          />
        ) : null}
        {me?.role === "admin" || me?.role === "superadmin" ? (
          <>
            <Button
              label={t("admin.dashboard")}
              variant="secondary"
              onPress={() => router.push("/(app)/admin")}
            />
            <Button
              label={t("admin.people")}
              variant="secondary"
              onPress={() => router.push("/(app)/admin-people")}
            />
            <Button
              label={MODERATION_QUEUE}
              variant="secondary"
              onPress={() => router.push("/(app)/admin-moderation")}
            />
            <Button
              label={AUDIT_LOG}
              variant="secondary"
              onPress={() => router.push("/(app)/admin-audit")}
            />
            <Button
              label={t("admin.ai")}
              variant="secondary"
              onPress={() => router.push("/(app)/admin-ai")}
            />
            <Button
              label={t("admin.usage")}
              variant="secondary"
              onPress={() => router.push("/(app)/admin-usage")}
            />
            <Button
              label={t("admin.demo")}
              variant="secondary"
              onPress={() => router.push("/(app)/admin-demo")}
            />
            <Button
              label={t("settings.title")}
              variant="secondary"
              onPress={() => router.push("/(app)/admin-settings")}
            />
          </>
        ) : null}
        <Button
          label={t("update.download")}
          variant="secondary"
          onPress={() => router.push("/download")}
        />
        <Button
          label={t("welcome.privacy")}
          variant="ghost"
          onPress={() => router.push("/(onboarding)/privacy")}
        />
        <Button
          label={t("welcome.terms")}
          variant="ghost"
          onPress={() => router.push("/(onboarding)/terms")}
        />
      </View>
      <LanguageToggle />
      <Text style={styles.body}>{t("common.notBloodBank")}</Text>
      {isAuthConfigured && session.data ? (
        <Button
          label={t("common.signOut")}
          variant="danger"
          onPress={() => void authClient.signOut()}
        />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.muted },
  card: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
});
