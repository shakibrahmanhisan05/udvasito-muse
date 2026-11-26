import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, typography } from "../theme/tokens";

/** CMP-EmptyState (specs §1.3.5): icon + title + body + optional action. */
export function EmptyState(props: { icon: string; title: string; body?: string }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.icon}>{props.icon}</Text>
      <Text style={styles.title}>{props.title}</Text>
      {props.body ? <Text style={styles.body}>{props.body}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.xl, alignItems: "center", gap: spacing.sm },
  icon: { fontSize: 32 },
  title: { ...typography.heading, color: colors.text.primary, textAlign: "center" },
  body: { ...typography.body, color: colors.text.muted, textAlign: "center" },
});
