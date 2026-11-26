import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "../theme/tokens";

/** CMP-Banner (specs §1.3.5): info / warning / success / error, icon + text. */
export function Banner(props: {
  kind: "info" | "warning" | "success" | "error";
  text: string;
  icon: string;
}) {
  const palette = {
    info: { bg: colors.bg.surface, fg: colors.status.info },
    warning: { bg: colors.status.warningBg, fg: colors.status.warning },
    success: { bg: colors.status.successBg, fg: colors.status.successText },
    error: { bg: colors.brand.primarySoft, fg: colors.brand.primary },
  }[props.kind];
  return (
    <View accessibilityLiveRegion="polite" style={[styles.row, { backgroundColor: palette.bg }]}>
      <Text style={[styles.icon, { color: palette.fg }]}>{props.icon}</Text>
      <Text style={[styles.text, { color: colors.text.primary }]}>{props.text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.card,
    alignItems: "flex-start",
  },
  icon: { ...typography.body },
  text: { ...typography.body, flex: 1 },
});
