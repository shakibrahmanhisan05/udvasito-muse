import React from "react";
import { useTranslation } from "react-i18next";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "convex/react";
import { Button } from "@/components";
import { colors, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";

/**
 * SCR-P08 — Download page (minimal P1 form). The APK button renders only
 * when public.appConfig.apkUrl is set (GitHub Releases, DEP-04); the full
 * page copy is unkeyed in specs (I18N-GAPS register, DEP-08) so this screen
 * deliberately uses only existing keys until the team supplies them.
 */
export default function Download() {
  const { t } = useTranslation();
  const appConfig = useQuery(refs.appConfig, isAuthConfigured ? {} : "skip");
  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("common.appName")}
      </Text>
      <Text style={styles.body}>{t("common.tagline")}</Text>
      <View style={styles.card}>
        {appConfig?.apkUrl ? (
          <Button
            label={t("update.download")}
            onPress={() => void Linking.openURL(appConfig.apkUrl as string)}
          />
        ) : null}
        <Button
          label={t("update.useWeb")}
          variant="secondary"
          onPress={() => void Linking.openURL("/")}
        />
      </View>
      <Text style={styles.footer}>{t("common.notBloodBank")}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  card: { backgroundColor: colors.bg.surface, borderRadius: 12, padding: spacing.lg, gap: spacing.md },
  footer: { ...typography.small, color: colors.text.muted, textAlign: "center" },
});
