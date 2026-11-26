import React from "react";
import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { colors, radius, touch, typography } from "../theme/tokens";

/** CMP-Button (specs §1.3.5): primary / secondary / ghost / danger. */
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";

export function Button(props: {
  label: string;
  onPress?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  loading?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}) {
  const variant = props.variant ?? "primary";
  const disabled = props.disabled || props.loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.accessibilityLabel ?? props.label}
      accessibilityState={{ disabled: Boolean(disabled), busy: Boolean(props.loading) }}
      testID={props.testID}
      disabled={disabled}
      onPress={props.onPress}
      style={({ pressed }) => [
        styles.base,
        variant === "primary" && { backgroundColor: pressed ? colors.brand.primaryPressed : colors.brand.primary },
        variant === "secondary" && styles.secondary,
        variant === "ghost" && styles.ghost,
        variant === "danger" && styles.danger,
        disabled && styles.disabled,
      ]}
    >
      {props.loading ? (
        <ActivityIndicator color={variant === "primary" ? "#fff" : colors.brand.primary} />
      ) : null}
      <Text
        style={[
          styles.label,
          variant === "primary" && { color: "#fff" },
          variant === "secondary" && { color: colors.brand.navy },
          variant === "ghost" && { color: colors.brand.primary },
          variant === "danger" && { color: colors.brand.primary },
        ]}
        maxFontSizeMultiplier={2}
      >
        {props.label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: touch.buttonHeight,
    borderRadius: radius.input,
    paddingHorizontal: 16,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  secondary: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.brand.navy },
  ghost: { backgroundColor: "transparent" },
  danger: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.brand.primary },
  disabled: { opacity: 0.4 },
  label: { ...typography.bodyStrong },
});
