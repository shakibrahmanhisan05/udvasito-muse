import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, touch, typography } from "../theme/tokens";

/** CMP-Chip row: single-select option chips (≥48dp targets, §1.3.3). */
export function ChipRow(props: {
  options: { value: string; label: string }[];
  value: string | null;
  onChange: (value: string) => void;
  accessibilityLabel: string;
}) {
  return (
    <View style={styles.row} accessibilityLabel={props.accessibilityLabel}>
      {props.options.map((option) => {
        const active = option.value === props.value;
        return (
          <Pressable
            key={option.value}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={option.label}
            onPress={() => props.onChange(option.value)}
            style={[styles.chip, active && styles.chipActive]}
          >
            <Text style={[styles.label, active && styles.labelActive]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    minHeight: touch.min,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.chip,
    borderWidth: 1,
    borderColor: colors.border.input,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.bg.surface,
  },
  chipActive: { backgroundColor: colors.brand.primarySoft, borderColor: colors.brand.primary },
  label: { ...typography.bodyStrong, color: colors.text.primary },
  labelActive: { color: colors.brand.primary },
});
