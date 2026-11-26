import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "convex/react";
import { Banner, ChipRow, EmptyState } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { outbox } from "@/lib/outbox";
import { formatTime } from "@/lib/format";

/** SCR-M04 — My requests (list only in P1; detail is SCR-M03). */
export default function Requests() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bn" ? "bn" : "en";
  const router = useRouter();
  const [tab, setTab] = useState<"active" | "closed">("active");
  const result = useQuery(
    refs.requestsListMine,
    isAuthConfigured
      ? { status: tab, paginationOpts: { numItems: 20, cursor: null } }
      : "skip",
  );
  // F-1101/X03: cached data is labelled with when it last refreshed,
  // and posts still waiting in the offline outbox are visible here.
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null);
  useEffect(() => {
    if (result === undefined) return;
    // Deferred a microtask: this is a display stamp, not derived state.
    let alive = true;
    void Promise.resolve().then(() => {
      if (alive) setLastUpdatedAt(Date.now());
    });
    return () => {
      alive = false;
    };
  }, [result]);
  const [queuedCount, setQueuedCount] = useState(0);
  useEffect(() => {
    let alive = true;
    void outbox.list().then((items) => {
      if (alive) setQueuedCount(items.length);
    });
    return () => {
      alive = false;
    };
  }, [result]);

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("requests.title")}
      </Text>
      {queuedCount > 0 ? (
        <Banner kind="warning" icon="⏳" text={t("common.offline", { count: queuedCount })} />
      ) : null}
      {lastUpdatedAt ? (
        <Text style={styles.help}>
          {t("common.lastUpdated", { time: formatTime(lastUpdatedAt, lang) })}
        </Text>
      ) : null}
      <ChipRow
        accessibilityLabel={t("requests.title")}
        options={[
          { value: "active", label: t("requests.active") },
          { value: "closed", label: t("requests.closed") },
        ]}
        value={tab}
        onChange={(v) => setTab(v as "active" | "closed")}
      />
      {result && result.page.length === 0 ? (
        <EmptyState icon="🩸" title={t("requests.empty")} />
      ) : null}
      {(result?.page ?? []).map((request: NonNullable<typeof result>["page"][number]) => (
        <Pressable
          key={request._id}
          accessibilityRole="button"
          onPress={() =>
            router.push({ pathname: "/(app)/request-live", params: { id: request._id } })
          }
          style={styles.card}
        >
          <Text style={styles.cardTitle}>
            {request.bloodGroup} • {t(`blood.${request.component === "platelets" ? "platelets" : "wholeBlood"}`)}
          </Text>
          <Text style={styles.body}>
            {request.hospitalName ?? request.placeText ?? ""} •{" "}
            {t(`requestStatus.${request.status === "live" ? "live" : request.status === "covered" ? "covered" : "closed"}`)}
          </Text>
          <Text style={styles.body}>
            {t("home.covered", {
              confirmed: request.unitsConfirmed,
              needed: request.unitsNeeded,
            })}
          </Text>
        </Pressable>
      ))}
      <View />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  card: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTitle: { ...typography.heading, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  help: { ...typography.small, color: colors.text.muted },
});
