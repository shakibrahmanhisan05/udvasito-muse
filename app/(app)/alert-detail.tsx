import React, { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Banner, Button, ChipRow, ErrorState, SafetyCard, Sheet, Skeleton } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { errorText } from "@/lib/errors";
import { directionsUrl, formatTimeDhaka } from "@/lib/geo";
import type { Id } from "@/convex/_generated/dataModel";

const DECLINE_REASONS = ["busy", "far", "donated", "unwell", "other"] as const;

/**
 * SCR-D04 — Alert detail (F-502…F-504 client side). The requester's number
 * appears ONLY when responses.getForDonor returns it — i.e. after this
 * donor is confirmed and a live reveal entitles them. Accept requires the
 * self-check; call-mode choice implements F-404 at answer time.
 */
export default function AlertDetail() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ id: string }>();
  const lang = i18n.language === "bn" ? "bn" : "en";
  const requestId = params.id as Id<"requests">;
  const data = useQuery(
    refs.responsesGetForDonor,
    isAuthConfigured && params.id ? { requestId } : "skip",
  );
  const markOpened = useMutation(refs.responsesMarkOpened);
  const accept = useMutation(refs.responsesAccept);
  const decline = useMutation(refs.responsesDecline);
  const withdraw = useMutation(refs.responsesWithdraw);
  const answerStillComing = useMutation(refs.responsesAnswerStillComing);
  const [selfCheck, setSelfCheck] = useState(false);
  const [donorCalls, setDonorCalls] = useState(false);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientIdRef = useRef<string | null>(null);
  const clientId = () => {
    clientIdRef.current ??= `acc-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return clientIdRef.current;
  };

  useEffect(() => {
    if (params.id && isAuthConfigured) {
      void markOpened({ requestId }).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  if (data === undefined) {
    return (
      <View style={styles.wrap}>
        <Skeleton height={28} width="60%" />
        <Skeleton height={160} />
      </View>
    );
  }
  if (data === null) return <ErrorState />;

  const state = data.myState;
  const needsAnswer = state === "notified" || state === "opened";

  const doAccept = () => {
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        await accept({
          requestId,
          clientId: clientId(),
          selfCheck: true,
          callMode: donorCalls ? "donor_calls" : "mutual",
        });
      } catch (e) {
        setError(errorText(t, e));
      } finally {
        setBusy(false);
      }
    })();
  };

  const doDecline = (reason: (typeof DECLINE_REASONS)[number]) => {
    setBusy(true);
    void (async () => {
      try {
        await decline({ requestId, reason });
        setDeclineOpen(false);
        router.back();
      } catch (e) {
        setError(errorText(t, e));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("alert.title", {
          group: data.request.bloodGroup,
          component: t(data.request.component === "platelets" ? "blood.platelets" : "blood.wholeBlood"),
        })}
      </Text>
      <Text style={styles.body}>{data.request.hospitalName}</Text>
      <Text style={styles.body}>
        {t("alert.neededBy", { time: formatTimeDhaka(data.request.neededBy, lang) })}
        {data.request.distanceKm !== null
          ? ` • ${t("alert.distance", { km: data.request.distanceKm.toFixed(1) })}`
          : ""}
      </Text>
      {data.trackRecord ? (
        <Text style={styles.help}>
          {t("alert.trackRecord", {
            date: formatTimeDhaka(data.trackRecord.memberSince, lang),
            requests: data.trackRecord.requestsPosted,
            donations: data.trackRecord.donationsConfirmed,
          })}
        </Text>
      ) : null}
      {data.request.verifiedBadge ? (
        <Text style={styles.help}>{t("alert.verified")}</Text>
      ) : null}
      {error ? <Banner kind="error" icon="⚠" text={error} /> : null}

      {state === "confirmed" ? (
        <View style={styles.card}>
          <Banner kind="success" icon="✓" text={t("alert.confirmed")} />
          {data.request.callMode === "donor_calls" ? (
            <Text style={styles.body}>{t("alert.confirmedCallMode")}</Text>
          ) : null}
          <SafetyCard />
          {data.request.patientName ? (
            <Text style={styles.body}>{data.request.patientName}</Text>
          ) : null}
          {data.request.ward ? <Text style={styles.body}>{data.request.ward}</Text> : null}
          {data.requester?.phone ? (
            <Button
              label={`${t("common.call")} ${data.requester.phone}`}
              onPress={() => void Linking.openURL(`tel:${data.requester?.phone}`)}
            />
          ) : null}
          {data.request.hospitalLat !== undefined && data.request.hospitalLng !== undefined ? (
            <Button
              label={t("alert.directions")}
              variant="secondary"
              onPress={() =>
                void Linking.openURL(
                  directionsUrl({
                    lat: data.request.hospitalLat as number,
                    lng: data.request.hospitalLng as number,
                  }),
                )
              }
            />
          ) : null}
        </View>
      ) : null}

      {state === "standby" ? <Banner kind="info" icon="ℹ" text={t("alert.standby")} /> : null}

      {data.myResponse?.stillComingAskedAt && !data.myResponse?.stillComingAnswer ? (
        <View style={styles.card}>
          <Text style={styles.body}>
            {t("alert.stillComing", { hospital: data.request.hospitalName ?? "" })}
          </Text>
          <Button
            label={t("alert.onMyWay")}
            loading={busy}
            onPress={() =>
              void answerStillComing({
                responseId: data.myResponse.responseId,
                answer: "yes",
              }).catch((e: unknown) => setError(errorText(t, e)))
            }
          />
          <Button
            label={t("alert.cantMakeIt")}
            variant="secondary"
            onPress={() =>
              void answerStillComing({
                responseId: data.myResponse.responseId,
                answer: "cant",
              }).catch((e: unknown) => setError(errorText(t, e)))
            }
          />
        </View>
      ) : null}

      {data.myResponse?.state === "confirmed" ? (
        <View style={styles.card}>
          <Button
            label={t("alert.cantMakeIt")}
            variant="secondary"
            onPress={() =>
              void withdraw({ responseId: data.myResponse.responseId }).catch((e: unknown) =>
                setError(errorText(t, e)),
              )
            }
          />
          {data.requester?.authUserId ? (
            <Button
              label={t("report.title")}
              variant="ghost"
              onPress={() =>
                router.push({
                  pathname: "/(app)/report",
                  params: { subject: data.requester.authUserId, requestId },
                })
              }
            />
          ) : null}
        </View>
      ) : null}

      {needsAnswer ? (
        <View style={styles.card}>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: selfCheck }}
            accessibilityLabel={t("alert.selfCheck")}
            onPress={() => setSelfCheck((v) => !v)}
            style={styles.checkRow}
          >
            <View style={[styles.checkbox, selfCheck && styles.checkboxChecked]}>
              {selfCheck ? <Text style={styles.checkmark}>✓</Text> : null}
            </View>
            <Text style={styles.checkLabel}>{t("alert.selfCheck")}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="checkbox"
            accessibilityState={{ checked: donorCalls }}
            accessibilityLabel={t("donor.setup.callMode")}
            onPress={() => setDonorCalls((v) => !v)}
            style={styles.checkRow}
          >
            <View style={[styles.checkbox, donorCalls && styles.checkboxChecked]}>
              {donorCalls ? <Text style={styles.checkmark}>✓</Text> : null}
            </View>
            <Text style={styles.checkLabel}>{t("donor.setup.callMode")}</Text>
          </Pressable>
          <Button label={t("alert.canHelp")} loading={busy} disabled={!selfCheck} onPress={doAccept} />
          <Button label={t("alert.cantHelp")} variant="secondary" onPress={() => setDeclineOpen(true)} />
        </View>
      ) : null}

      <Sheet visible={declineOpen} title={t("alert.declineReason")} onClose={() => setDeclineOpen(false)}>
        <ChipRow
          accessibilityLabel={t("alert.declineReason")}
          options={DECLINE_REASONS.map((r) => ({ value: r, label: t(`alert.reason.${r}`) }))}
          value={null}
          onChange={(v) => doDecline(v as (typeof DECLINE_REASONS)[number])}
        />
        <Button label={t("common.cancel")} variant="ghost" onPress={() => setDeclineOpen(false)} />
      </Sheet>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  help: { ...typography.small, color: colors.text.muted },
  card: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
  checkRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", minHeight: 48 },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border.input,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  checkboxChecked: { backgroundColor: colors.brand.primary, borderColor: colors.brand.primary },
  checkmark: { color: "#fff", fontWeight: "700" },
  checkLabel: { ...typography.body, color: colors.text.primary, flex: 1 },
});
