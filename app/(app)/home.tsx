import React from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { EmptyState, LanguageToggle } from "@/components";
import { colors, spacing, typography } from "@/theme/tokens";

/**
 * SCR-M01 — Home, P0 empty state. Per build-prompts P0 #10 the empty Home
 * shows ONLY working things (language toggle, sign out in More). The hero,
 * request cards and donor sections arrive with their features in P1+.
 */
export default function Home() {
  const { t } = useTranslation();
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>
          {t("home.title")}
        </Text>
        <LanguageToggle />
      </View>
      <EmptyState icon="🩸" title={t("home.empty")} body={t("common.tagline")} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg.app, padding: spacing.lg, gap: spacing.lg },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { ...typography.title, color: colors.text.primary },
});
