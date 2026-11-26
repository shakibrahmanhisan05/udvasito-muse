import React from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "convex/react";
import { Banner, Button, EmptyState, LanguageToggle } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";

/**
 * SCR-M01 — Home (role-aware, P1 minimal): request CTA, verify banner, my
 * active request card, alerts waiting count, become-a-donor CTA, volunteer
 * on-duty chip. Everything shown works (§1.9).
 */
export default function Home() {
  const { t } = useTranslation();
  const router = useRouter();
  const me = useQuery(refs.me, isAuthConfigured ? {} : "skip");
  const mine = useQuery(
    refs.requestsListMine,
    isAuthConfigured && me
      ? { status: "active", paginationOpts: { numItems: 1, cursor: null } }
      : "skip",
  );
  const inbox = useQuery(refs.responsesInbox, isAuthConfigured && me?.donor ? {} : "skip");
  const activeRequest = mine?.page[0];
  const waiting = inbox?.needsAnswer.length ?? 0;

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <View style={styles.header}>
        <Text accessibilityRole="header" style={styles.title}>
          {t("home.title")}
        </Text>
        <LanguageToggle />
      </View>

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("home.needBlood")}</Text>
        <Button
          label={t("home.needBloodCta")}
          onPress={() => router.push("/(app)/request-new")}
        />
        <Button
          label={t("home.dengueCta")}
          variant="secondary"
          onPress={() => router.push({ pathname: "/(app)/request-new", params: { dengue: "1" } })}
        />
      </View>

      {me && !me.phoneVerified ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/(onboarding)/verify-phone")}
        >
          <Banner kind="warning" icon="⚠" text={t("home.verifyBanner")} />
        </Pressable>
      ) : null}

      {activeRequest ? (
        <Pressable
          accessibilityRole="button"
          onPress={() =>
            router.push({ pathname: "/(app)/request-live", params: { id: activeRequest._id } })
          }
          style={styles.card}
        >
          <Text style={styles.cardTitle}>{t("home.myRequest")}</Text>
          <Text style={styles.body}>
            {t("home.covered", {
              confirmed: activeRequest.unitsConfirmed,
              needed: activeRequest.unitsNeeded,
            })}
          </Text>
        </Pressable>
      ) : null}

      {me?.donor && waiting > 0 ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => router.push("/(app)/alerts")}
          style={styles.card}
        >
          <Text style={styles.cardTitle}>{t("home.requestsForMe")}</Text>
          <Text style={styles.body}>{t("home.requestsForMeCount", { count: waiting })}</Text>
        </Pressable>
      ) : null}

      {me && !me.donor ? (
        <View style={styles.card}>
          <Button
            label={t("home.becomeDonor")}
            variant="secondary"
            onPress={() => router.push("/(app)/donor-setup")}
          />
        </View>
      ) : null}

      {me?.volunteer?.onDuty ? (
        <Banner kind="success" icon="✓" text={t("home.onDuty")} />
      ) : null}

      {!activeRequest && waiting === 0 ? (
        <EmptyState icon="🩸" title={t("home.empty")} body={t("common.tagline")} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg.app, flexGrow: 1 },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { ...typography.title, color: colors.text.primary },
  card: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardTitle: { ...typography.heading, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
});
