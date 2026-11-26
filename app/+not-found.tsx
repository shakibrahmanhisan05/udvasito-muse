import React from "react";
import { useTranslation } from "react-i18next";
import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, typography } from "@/theme/tokens";

/** SCR-P09 — 404. */
export default function NotFound() {
  const { t } = useTranslation();
  return (
    <View style={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("notFound.title")}
      </Text>
      <Text style={styles.body}>{t("notFound.body")}</Text>
      <Link href="/(app)/home" style={styles.link}>
        {t("notFound.home")}
      </Link>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg.app },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.muted },
  link: { ...typography.bodyStrong, color: colors.brand.primary, minHeight: 48 },
});
