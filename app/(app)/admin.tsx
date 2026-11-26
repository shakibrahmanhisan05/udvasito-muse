import React from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Banner, Button } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";

type Speed = {
  medianFirstWaveMs: number | null;
  medianFirstAcceptMs: number | null;
  wavedRequests: number;
  acceptedRequests: number;
};
type DashboardData = {
  liveNow: {
    openRequests: number;
    coveredRequests: number;
    waitingOver15Min: number;
    volunteersOnDuty: number;
  };
  bloodPool: Record<string, { live: number; availableNow: number }>;
  donorsLive: number;
  speed: { last7Days: Speed; last30Days: Speed };
  funnel: {
    published: number;
    donorsNotified: number;
    alertOpened: number;
    donorAccepted: number;
    contactShared: number;
    reportedByRequester: number;
    confirmedByDonor: number;
    confirmationResponseRate: number | null;
    donationsConfirmedRequests: number;
  };
  participation: {
    registrationsByDay: { day: string; count: number }[];
    newDonors30Days: number;
    campaignSignups: { code: string; count: number }[];
    availabilityFreshnessPct: number | null;
  };
  volunteerCoverage: { byHour: number[]; gapHours: number[]; uncoveredSlots: number; days: number };
  alerts: { openModerationItems: number };
  updatedAt: number;
};

const GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

function minutes(ms: number | null): string {
  if (ms === null) return "—";
  const m = ms / 60_000;
  return m < 1 ? `${Math.round(ms / 1000)}s` : `${Math.round(m * 10) / 10} min`;
}

/**
 * SCR-A01 — Live dashboard (F-901). Reads the statsSnapshots admin
 * snapshot (recomputed by cron every 5 minutes); charts are plain
 * Views — no chart library (roadmap §2.5). Practice data is excluded
 * server-side. Copy gaps (I18N-GAPS §4): the "Stats are being
 * prepared" banner and most row labels are unkeyed in specs, so rows
 * lean on the keyed section headings + raw values.
 */
export default function AdminDashboard() {
  const { t } = useTranslation();
  const snapshot = useQuery(refs.statsDashboard, isAuthConfigured ? {} : "skip") as
    | { data: DashboardData; computedAt: number }
    | null
    | undefined;
  const recompute = useMutation(refs.statsRecompute);

  if (snapshot === null) {
    // Snapshot-missing state (unkeyed banner copy — I18N-GAPS §4):
    // offer the recompute action instead of inventing the string.
    return (
      <View style={styles.wrap}>
        <Text accessibilityRole="header" style={styles.title}>
          {t("admin.dashboard")}
        </Text>
        <Button label={t("common.retry")} onPress={() => void recompute({})} />
      </View>
    );
  }
  const d = snapshot?.data;
  const maxPool = d ? Math.max(1, ...GROUPS.map((g) => d.bloodPool[g]?.live ?? 0)) : 1;
  const maxReg = d ? Math.max(1, ...d.participation.registrationsByDay.map((r) => r.count)) : 1;
  const maxCoverage = d ? Math.max(1, ...d.volunteerCoverage.byHour) : 1;
  const funnelStages: [string, number][] = d
    ? [
        ["published", d.funnel.published],
        ["donorsNotified", d.funnel.donorsNotified],
        ["alertOpened", d.funnel.alertOpened],
        ["donorAccepted", d.funnel.donorAccepted],
        ["contactShared", d.funnel.contactShared],
        ["reportedByRequester", d.funnel.reportedByRequester],
        ["confirmedByDonor", d.funnel.confirmedByDonor],
      ]
    : [];

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("admin.dashboard")}
      </Text>
      {snapshot ? (
        <Text style={styles.help}>
          {t("common.lastUpdated", {
            time: new Date(snapshot.computedAt).toLocaleTimeString(),
          })}
        </Text>
      ) : null}
      {d ? (
        <>
          <View style={styles.card}>
            <Text style={styles.heading}>{t("admin.liveNow")}</Text>
            <Text style={styles.bigNumber}>{d.liveNow.openRequests}</Text>
            <Text style={styles.body}>
              {`${t("admin.waiting15")}: ${d.liveNow.waitingOver15Min}`}
            </Text>
            <Text style={styles.body}>
              {`${t("admin.coverage")}: ${d.liveNow.volunteersOnDuty}`}
            </Text>
            {d.alerts.openModerationItems > 0 ? (
              <Banner
                kind="warning"
                icon="⚠"
                text={`${d.alerts.openModerationItems}`}
              />
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.heading}>{t("admin.bloodPool")}</Text>
            {GROUPS.map((group) => (
              <View key={group} style={styles.barRow}>
                <Text style={styles.barLabel}>{group}</Text>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      { width: `${((d.bloodPool[group]?.live ?? 0) / maxPool) * 100}%` },
                    ]}
                  />
                </View>
                <Text style={styles.barValue}>
                  {d.bloodPool[group]?.live ?? 0} • {d.bloodPool[group]?.availableNow ?? 0}
                </Text>
              </View>
            ))}
          </View>

          <View style={styles.card}>
            <Text style={styles.heading}>{t("admin.speed")}</Text>
            <Text style={styles.body}>
              {minutes(d.speed.last30Days.medianFirstWaveMs)} •{" "}
              {minutes(d.speed.last30Days.medianFirstAcceptMs)}
            </Text>
            <Text style={styles.help}>
              {d.speed.last30Days.wavedRequests} • {d.speed.last30Days.acceptedRequests}
            </Text>
          </View>

          <View style={styles.card}>
            <Text style={styles.heading}>{t("admin.funnel")}</Text>
            {funnelStages.map(([stage, count]) => (
              <View key={stage} style={styles.barRow}>
                <Text style={styles.barLabelWide}>{stage}</Text>
                <View style={styles.barTrack}>
                  <View
                    style={[
                      styles.barFill,
                      {
                        width: `${d.funnel.published > 0 ? (count / d.funnel.published) * 100 : 0}%`,
                      },
                    ]}
                  />
                </View>
                <Text style={styles.barValue}>{count}</Text>
              </View>
            ))}
            {d.funnel.confirmationResponseRate !== null ? (
              <Text style={styles.body}>
                {t("admin.responseRate", {
                  pct: Math.round(d.funnel.confirmationResponseRate * 100),
                })}
              </Text>
            ) : null}
          </View>

          <View style={styles.card}>
            {/* 30-day registrations + campaign sign-ups (V07). No keyed
                heading exists for this card (I18N-GAPS §4) — values only. */}
            <Text style={styles.bigNumber}>{d.participation.newDonors30Days}</Text>
            <View style={styles.strip}>
              {d.participation.registrationsByDay.map((row) => (
                <View
                  key={row.day}
                  style={[styles.stripBar, { height: 4 + (row.count / maxReg) * 36 }]}
                />
              ))}
            </View>
            {d.participation.campaignSignups.map((row) => (
              <Text key={row.code} style={styles.body}>
                {row.code} • {row.count}
              </Text>
            ))}
            {d.participation.availabilityFreshnessPct !== null ? (
              <Text style={styles.help}>
                {`${Math.round(d.participation.availabilityFreshnessPct)}%`}
              </Text>
            ) : null}
          </View>

          <View style={styles.card}>
            <Text style={styles.heading}>{t("admin.coverage")}</Text>
            <View style={styles.strip}>
              {d.volunteerCoverage.byHour.map((count, hour) => (
                <View
                  key={hour}
                  style={[
                    styles.stripBar,
                    { height: 4 + (count / maxCoverage) * 36 },
                    count === 0 ? styles.stripBarEmpty : null,
                  ]}
                />
              ))}
            </View>
            <Text style={styles.body}>{d.volunteerCoverage.uncoveredSlots}</Text>
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  heading: { ...typography.heading, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  help: { ...typography.small, color: colors.text.muted },
  bigNumber: { ...typography.title, color: colors.text.primary },
  card: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
  barRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  barLabel: { width: 36, ...typography.bodyStrong, color: colors.text.primary },
  barLabelWide: { width: 120, ...typography.small, color: colors.text.primary },
  barTrack: {
    flex: 1,
    height: 14,
    borderRadius: radius.input,
    backgroundColor: colors.bg.app,
    overflow: "hidden",
  },
  barFill: { height: 14, backgroundColor: colors.brand.primary },
  barValue: { minWidth: 56, textAlign: "right", ...typography.small, color: colors.text.muted },
  strip: { flexDirection: "row", alignItems: "flex-end", gap: 2, height: 44 },
  stripBar: { flex: 1, backgroundColor: colors.brand.primary, borderRadius: 2 },
  stripBarEmpty: { backgroundColor: colors.border.input },
});
