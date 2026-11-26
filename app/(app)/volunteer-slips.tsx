import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Banner, Button, EmptyState } from "@/components";
import { SlipImage } from "@/components/SlipImage";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { errorText } from "@/lib/errors";
import type { Id } from "@/convex/_generated/dataModel";

type QueueItem = {
  requestId: Id<"requests">;
  bloodGroup: string;
  component: string;
  unitsNeeded: number;
  hospitalName: string;
  createdAt: number;
};

/**
 * SCR-V04 — Slip checks (F-706, if-time; behind features.slips,
 * volunteers only). Queue of pending slips, oldest first; the photo
 * itself comes from the audited GET /slip/:requestId route with a
 * watermark and no download path. Reject needs a VAL-18 reason.
 */
export default function VolunteerSlips() {
  const { t } = useTranslation();
  const appConfig = useQuery(refs.appConfig, isAuthConfigured ? {} : "skip");
  const enabled = appConfig?.features?.slips === true;
  const queue = useQuery(refs.slipsQueue, enabled ? {} : "skip") as QueueItem[] | undefined;
  const review = useMutation(refs.slipsReview);
  const [selected, setSelected] = useState<QueueItem | null>(null);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!enabled) return null; // feature off → inert

  const decide = (decision: "approve" | "reject") => {
    if (!selected) return;
    if (decision === "reject" && (reason.trim().length < 5 || reason.trim().length > 200)) {
      setError(t("validation.val18.message"));
      return;
    }
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        await review({
          requestId: selected.requestId,
          decision,
          reason: reason.trim() || undefined,
        });
        setSelected(null);
        setReason("");
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
        {t("slips.title")}
      </Text>
      {error ? <Banner kind="error" icon="⚠" text={error} /> : null}

      {selected ? (
        <View style={styles.card}>
          <Text style={styles.bodyStrong}>
            {selected.bloodGroup} •{" "}
            {t(selected.component === "platelets" ? "blood.platelets" : "blood.wholeBlood")} •{" "}
            {t("units", { count: selected.unitsNeeded })}
          </Text>
          <Text style={styles.body}>{selected.hospitalName}</Text>
          <SlipImage requestId={selected.requestId} watermark />
          <TextInput
            style={styles.input}
            value={reason}
            onChangeText={setReason}
            placeholder={t("validation.val18.message")}
            accessibilityLabel={t("validation.val18.message")}
          />
          <Button label={t("slips.approve")} loading={busy} onPress={() => decide("approve")} />
          <Button
            label={t("slips.reject")}
            variant="danger"
            loading={busy}
            onPress={() => decide("reject")}
          />
          <Button label={t("common.back")} variant="ghost" onPress={() => setSelected(null)} />
        </View>
      ) : queue && queue.length === 0 ? (
        <EmptyState icon="🩸" title={t("slips.empty")} />
      ) : (
        (queue ?? []).map((item) => (
          <Pressable
            key={item.requestId}
            accessibilityRole="button"
            onPress={() => setSelected(item)}
            style={styles.card}
          >
            <Text style={styles.bodyStrong}>
              {item.bloodGroup} •{" "}
              {t(item.component === "platelets" ? "blood.platelets" : "blood.wholeBlood")} •{" "}
              {t("units", { count: item.unitsNeeded })}
            </Text>
            <Text style={styles.body}>{item.hospitalName}</Text>
          </Pressable>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  bodyStrong: { ...typography.body, color: colors.text.primary, fontWeight: "700" },
  card: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.card,
    padding: spacing.md,
    gap: spacing.sm,
  },
  input: {
    ...typography.body,
    color: colors.text.primary,
    borderWidth: 1,
    borderColor: colors.border.input,
    borderRadius: radius.input,
    padding: spacing.md,
    minHeight: 52,
  },
});
