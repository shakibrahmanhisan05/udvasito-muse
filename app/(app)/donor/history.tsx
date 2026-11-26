import React from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "convex/react";
import { EmptyState } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";

/**
 * SCR-D06 — Donation history & badges (specs §3.3, F-506/D12, switch
 * `donorHistory`). Lists the donor's own confirmed donations, the
 * total, milestone badges (1/5/10/25) and the next eligible date.
 * The empty-state line is the specs §3.3 SCR-D06 prose verbatim.
 * Badge labels are unkeyed in specs — flagged in P7-REPORT.
 */

const EMPTY_LINE = {
  en: "Your confirmed donations will appear here.",
  bn: "আপনার নিশ্চিত রক্তদান এখানে দেখাবে।",
} as const;

const BADGE_LABEL = "Donations badge"; // unkeyed — specs name the milestones only
const TITLE = { en: "Donation history", bn: "রক্তদানের ইতিহাস" } as const; // unkeyed screen name

export default function DonorHistory() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bn" ? "bn" : "en";
  const history = useQuery(refs.donorsHistory, isAuthConfigured ? {} : "skip");

  const fmt = (ms: number) =>
    new Intl.DateTimeFormat(lang === "bn" ? "bn-BD" : "en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "Asia/Dhaka",
    }).format(new Date(ms));

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {`${TITLE[lang]} · ${history?.total ?? 0}`}
      </Text>
      {history && history.total > 0 ? (
        <>
          <View style={styles.card}>
            <View style={styles.row}>
              {[1, 5, 10, 25].map((m) => (
                <View
                  key={m}
                  style={[styles.badge, history.badges.includes(m) ? styles.badgeOn : styles.badgeOff]}
                  accessibilityLabel={`${BADGE_LABEL} ${m}`}
                >
                  <Text style={[styles.badgeText, history.badges.includes(m) ? styles.badgeTextOn : null]}>{m}</Text>
                </View>
              ))}
            </View>
            {history.nextEligibleAt ? (
              <Text style={styles.body}>
                {t("donor.eligibleAgain", {
                  date: fmt(history.nextEligibleAt),
                })}
              </Text>
            ) : (
              <Text style={styles.body}>{t("donor.eligibleNow")}</Text>
            )}
          </View>
          {history.donations.map(
            (d: { date: number; hospitalName: string; group: string; component: string }, i: number) => (
            <View key={`${d.date}-${i}`} style={styles.card}>
              <Text style={styles.body}>
                {`${d.group} · ${d.component === "platelets" ? t("blood.platelets") : t("blood.wholeBlood")}`}
              </Text>
              <Text style={styles.help}>
                {`${d.hospitalName} · ${fmt(d.date)}`}
              </Text>
            </View>
          ))}
        </>
      ) : history ? (
        <EmptyState icon="🩸" title={EMPTY_LINE[lang]} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  help: { ...typography.small, color: colors.text.muted },
  card: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: spacing.md,
    gap: spacing.sm,
  },
  row: { flexDirection: "row", gap: spacing.sm },
  badge: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  badgeOn: { backgroundColor: colors.brand.primary, borderColor: colors.brand.primary },
  badgeOff: { backgroundColor: colors.bg.surface, borderColor: colors.border.subtle },
  badgeText: { ...typography.body, color: colors.text.primary, fontWeight: "700" },
  badgeTextOn: { color: "#FFFFFF" },
});
