import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Banner, Button, ChipRow, EmptyState, Sheet } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { outbox } from "@/lib/outbox";
import { formatTime } from "@/lib/format";

/** SCR-M04 — My requests (list only in P1; detail is SCR-M03). */

/** F-211 family-claim button — unkeyed in specs §4 (P7 gap list). */
const CLAIM_LABEL = "This is my family's request";
export default function Requests() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bn" ? "bn" : "en";
  const router = useRouter();
  const appConfig = useQuery(refs.appConfig, isAuthConfigured ? {} : "skip");
  const [tab, setTab] = useState<"active" | "closed">("active");
  // F-210 repeat: the closed request being repeated + its adjustments.
  const repeat = useMutation(refs.requestsRepeat);
  const [repeatFor, setRepeatFor] = useState<{ id: string; units: number } | null>(null);
  const [repeatUnits, setRepeatUnits] = useState(1);
  const [repeatWhen, setRepeatWhen] = useState<"now" | "today" | "tomorrow">("tomorrow");
  const [repeatBusy, setRepeatBusy] = useState(false);
  // F-211: requests a volunteer posted for this family (matched by
  // the family's verified number) can be claimed from here.
  const claimable = useQuery(refs.requestsClaimableByMe, isAuthConfigured ? {} : "skip") as
    | { requestId: string; bloodGroup: string; hospitalName: string }[]
    | undefined;
  const claim = useMutation(refs.requestsClaimAsFamily);
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
      {(claimable ?? []).map((c) => (
        <View key={c.requestId} style={styles.card}>
          <Text style={styles.body}>
            {c.bloodGroup} • {c.hospitalName}
          </Text>
          <Text style={styles.help}>{t("volunteerPost.label")}</Text>
          <Button
            label={CLAIM_LABEL}
            variant="secondary"
            onPress={() =>
              void claim({ requestId: c.requestId as never }).catch(() => undefined)
            }
          />
        </View>
      ))}
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
        <View key={request._id} style={styles.cardWrap}>
          <Pressable
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
          {tab === "closed" &&
          appConfig?.features?.repeatRequest === true &&
          request.closeReason !== "merged" ? (
            <Button
              label={t("requests.again")}
              variant="secondary"
              onPress={() => {
                setRepeatFor({ id: request._id as string, units: request.unitsNeeded });
                setRepeatUnits(request.unitsNeeded);
                setRepeatWhen("tomorrow");
              }}
            />
          ) : null}
        </View>
      ))}
      <Sheet
        visible={repeatFor !== null}
        title={t("requests.again")}
        onClose={() => setRepeatFor(null)}
      >
        <Text style={styles.body}>{t("request.units")}</Text>
        <ChipRow
          accessibilityLabel={t("request.units")}
          options={[1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) }))}
          value={String(repeatUnits)}
          onChange={(v) => setRepeatUnits(Number(v))}
        />
        <Text style={styles.body}>{t("request.when")}</Text>
        <ChipRow
          accessibilityLabel={t("request.when")}
          options={[
            { value: "now", label: t("urgency.now") },
            { value: "today", label: t("urgency.today") },
            { value: "tomorrow", label: t("urgency.tomorrow") },
          ]}
          value={repeatWhen}
          onChange={(v) => setRepeatWhen(v as "now" | "today" | "tomorrow")}
        />
        <Button
          label={t("requests.again")}
          loading={repeatBusy}
          onPress={() => {
            if (!repeatFor) return;
            setRepeatBusy(true);
            void (async () => {
              try {
                const neededBy =
                  repeatWhen === "now"
                    ? Date.now() + 30 * 60_000
                    : repeatWhen === "today"
                      ? Date.now() + 6 * 3_600_000
                      : Date.now() + 24 * 3_600_000;
                const out = (await repeat({
                  fromId: repeatFor.id as never,
                  neededBy,
                  unitsNeeded: repeatUnits,
                })) as { requestId: string };
                setRepeatFor(null);
                router.push({ pathname: "/(app)/request-live", params: { id: out.requestId } });
              } finally {
                setRepeatBusy(false);
              }
            })();
          }}
        />
        <Button label={t("common.cancel")} variant="ghost" onPress={() => setRepeatFor(null)} />
      </Sheet>
      <View />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  cardWrap: { gap: spacing.sm },
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
