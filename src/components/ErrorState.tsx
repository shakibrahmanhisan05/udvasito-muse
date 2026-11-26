import React from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { colors, spacing, typography } from "../theme/tokens";
import { Button } from "./Button";

/** CMP-ErrorState (specs §1.3.5): errors.generic.title + code message + retry. */
export function ErrorState(props: {
  message?: string;
  onRetry?: () => void;
  small?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.wrap} accessibilityLiveRegion="polite">
      <Text style={styles.title}>{t("errors.generic.title")}</Text>
      {props.message ? <Text style={styles.message}>{props.message}</Text> : null}
      {props.onRetry ? (
        <Button label={t("common.retry")} onPress={props.onRetry} variant="secondary" />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.sm, alignItems: "stretch" },
  title: { ...typography.heading, color: colors.text.primary },
  message: { ...typography.body, color: colors.text.muted },
});
