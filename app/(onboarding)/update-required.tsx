import React from "react";
import { useTranslation } from "react-i18next";
import { Linking, StyleSheet, Text, View } from "react-native";
import { Button } from "@/components";
import { colors, spacing, typography } from "@/theme/tokens";
import { FALLBACK_APP_CONFIG } from "@/lib/appConfig";

/** SCR-O05 — Update required (gate G1). */
export default function UpdateRequired() {
  const { t } = useTranslation();
  return (
    <View style={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("update.title")}
      </Text>
      <Text style={styles.body}>{t("update.body")}</Text>
      {FALLBACK_APP_CONFIG.apkUrl ? (
        <Button
          label={t("update.download")}
          onPress={() => void Linking.openURL(FALLBACK_APP_CONFIG.apkUrl)}
        />
      ) : null}
      <Button
        label={t("update.useWeb")}
        variant="secondary"
        onPress={() => void Linking.openURL("https://udvasito.vercel.app")}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg.app },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
});
