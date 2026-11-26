import React from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "convex/react";
import { Banner, Button } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";

/**
 * Volunteer tab (P1 minimal): duty state + the in-person verification
 * entry (SCR-V06). The request board (SCR-V01) arrives in P3.
 */
export default function Volunteer() {
  const { t } = useTranslation();
  const router = useRouter();
  const me = useQuery(refs.me, isAuthConfigured ? {} : "skip");
  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("volunteer.title")}
      </Text>
      {me?.volunteer?.onDuty ? (
        <Banner kind="success" icon="✓" text={t("volunteer.onDuty")} />
      ) : null}
      <Text style={styles.body}>{t("volunteer.dutyNote")}</Text>
      <View style={styles.card}>
        <Button
          label={t("verifyInPerson.title")}
          onPress={() => router.push("/(app)/verify-in-person")}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  card: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
});
