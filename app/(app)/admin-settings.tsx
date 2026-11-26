import React from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "convex/react";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";

type SettingRow = {
  key: string;
  value: unknown;
  defaultValue: unknown;
  isDefault: boolean;
  range: [number, number] | null;
  ref: string;
  fixed: boolean;
};

// Specs §5.2 wording for the S-01 guard, without an i18n key
// (I18N-GAPS §4), pending key review.
const FIXED = "fixed";

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * SCR-A10 (core) — Rule settings, READ-ONLY (F-904 core part).
 * Every §5.2 setting with its current value, validation range and
 * spec reference. Editing is the P7 if-time part and deliberately
 * absent — there is no write control on this screen and no update
 * function on the server. The title reuses the keyed settings.title;
 * per-row labels are the setting keys themselves (data, not copy).
 */
export default function AdminSettings() {
  const { t } = useTranslation();
  const rows = useQuery(refs.adminSettingsList, isAuthConfigured ? {} : "skip") as
    | SettingRow[]
    | undefined;

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("settings.title")}
      </Text>
      {(rows ?? []).map((row) => (
        <View key={row.key} style={styles.card}>
          <Text style={styles.bodyStrong}>{row.key}</Text>
          <Text style={styles.body}>{formatValue(row.value)}</Text>
          <Text style={styles.help}>
            {row.ref}
            {row.range ? ` • ${row.range[0]}–${row.range[1]}` : ""}
            {row.isDefault ? "" : ` • ≠ ${formatValue(row.defaultValue)}`}
            {row.fixed ? ` • ${FIXED}` : ""}
          </Text>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  bodyStrong: { ...typography.bodyStrong, color: colors.text.primary },
  help: { ...typography.small, color: colors.text.muted },
  card: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
});
