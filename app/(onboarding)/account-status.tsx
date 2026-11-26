import React from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Button, HelplineButton } from "@/components";
import { colors, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { formatTimeDhaka } from "@/lib/geo";

/**
 * SCR-O06 — Account status (gate G6 landing): frozen / suspended / banned /
 * deletion pending / underage. Copy: accountStatus.* (specs §3.2).
 */
export default function AccountStatus() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const me = useQuery(refs.me, isAuthConfigured ? {} : "skip");
  const cancelDeletion = useMutation(refs.cancelDeletion);
  const lang = i18n.language === "bn" ? "bn" : "en";

  if (me === undefined) return <View style={styles.wrap} />;
  if (me === null || me.status === "active") {
    return (
      <View style={styles.wrap}>
        <Button label={t("notFound.home")} onPress={() => router.replace("/(app)/home")} />
      </View>
    );
  }

  const status = me.status;
  const title =
    status === "deletion_pending"
      ? t("accountStatus.deletion_pending.title")
      : t(`accountStatus.${status}.title`);
  const date = me.deletionRequestedAt
    ? formatTimeDhaka(me.deletionRequestedAt + 30 * 86_400_000, lang)
    : "";
  const body =
    status === "deletion_pending"
      ? t("accountStatus.deletion_pending.body", { date })
      : status === "suspended"
        ? t("accountStatus.suspended.body", { reason: "", date: "" })
        : status === "banned"
          ? t("accountStatus.banned.body", { reason: "" })
          : t(`accountStatus.${status}.body`);

  return (
    <View style={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {title}
      </Text>
      <Text style={styles.body}>{body}</Text>
      {status === "deletion_pending" ? (
        <Button
          label={t("common.cancel")}
          onPress={() => {
            void cancelDeletion({}).then(() => router.replace("/(app)/home"));
          }}
        />
      ) : null}
      <HelplineButton />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg.app },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
});
