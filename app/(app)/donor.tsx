import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "convex/react";
import { Banner, Button } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { formatTimeDhaka } from "@/lib/geo";

/**
 * SCR-D01 — Donor tab (P1 minimal): intro when not a donor yet; otherwise
 * the live/not-live state with reasons, and the route to alerts + setup.
 * Availability controls (SCR-D05) arrive in P2.
 */
export default function Donor() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const lang = i18n.language === "bn" ? "bn" : "en";
  const mine = useQuery(refs.donorsGetMine, isAuthConfigured ? {} : "skip");
  const inbox = useQuery(refs.responsesInbox, isAuthConfigured && mine?.donor ? {} : "skip");
  const [now] = useState(() => Date.now());

  if (mine === undefined) return <View style={styles.wrap} />;

  if (!mine || !mine.donor) {
    return (
      <ScrollView contentContainerStyle={styles.wrap}>
        <Text accessibilityRole="header" style={styles.title}>
          {t("donor.intro.title")}
        </Text>
        <View style={styles.card}>
          <Text style={styles.body}>{t("donor.intro.b1")}</Text>
          <Text style={styles.body}>{t("donor.intro.b2")}</Text>
          <Text style={styles.body}>{t("donor.intro.b3")}</Text>
          <Button label={t("donor.intro.cta")} onPress={() => router.push("/(app)/donor-setup")} />
        </View>
      </ScrollView>
    );
  }

  const waiting = inbox?.needsAnswer.length ?? 0;
  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("donor.setup.title")}
      </Text>
      {mine.live ? (
        <Banner kind="success" icon="✓" text={t("donor.eligibleNow")} />
      ) : (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("donor.notLive")}</Text>
          {mine.notLiveReasons.map((reason: string) => (
            <Text key={reason} style={styles.body}>
              {t(`donor.notLive.${reason}`, { defaultValue: reason })}
            </Text>
          ))}
          {mine.eligibleFrom > now ? (
            <Text style={styles.body}>
              {t("donor.eligibleAgain", { date: formatTimeDhaka(mine.eligibleFrom, lang) })}
            </Text>
          ) : null}
        </View>
      )}
      {waiting > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("home.requestsForMe")}</Text>
          <Text style={styles.body}>{t("home.requestsForMeCount", { count: waiting })}</Text>
          <Button label={t("alerts.title")} onPress={() => router.push("/(app)/alerts")} />
        </View>
      ) : null}
      <Button
        label={t("common.edit")}
        variant="secondary"
        onPress={() => router.push("/(app)/donor-setup")}
      />
      <Button
        label={t("alerts.title")}
        variant="ghost"
        onPress={() => router.push("/(app)/alerts")}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  card: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardTitle: { ...typography.heading, color: colors.text.primary },
});
