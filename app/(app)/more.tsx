import React from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { Button, LanguageToggle } from "@/components";
import { colors, spacing, typography } from "@/theme/tokens";
import { authClient, isAuthConfigured } from "@/lib/auth-client";

/** SCR-M10 — More menu (P0 subset: language, sign out, about line). */
export default function More() {
  const { t } = useTranslation();
  const session = authClient.useSession();
  return (
    <View style={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("nav.more")}
      </Text>
      <LanguageToggle />
      <Text style={styles.body}>{t("common.notBloodBank")}</Text>
      {isAuthConfigured && session.data ? (
        <Button
          label={t("common.signOut")}
          variant="danger"
          onPress={() => void authClient.signOut()}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg.app, padding: spacing.lg, gap: spacing.lg },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.muted },
});
