import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Banner, Button } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { errorText } from "@/lib/errors";
import type { Id } from "@/convex/_generated/dataModel";

type BoardItem = {
  requestId: Id<"requests">;
  bloodGroup: string;
  unitsNeeded: number;
  unitsConfirmed: number;
  hospitalName: string;
  waitingMin: number;
  claimedByFirstName: string | null;
};

/**
 * SCR-V02 — Volunteer home (F-702/F-703): duty toggle at the top, then
 * the request board for the volunteer's covered areas — worst first,
 * phone-free until a case is opened (SCR-V03). Members who are not
 * volunteers yet get the apply entry (SCR-V01); everyone keeps the
 * in-person verification entry (SCR-V06).
 */
export default function Volunteer() {
  const { t } = useTranslation();
  const router = useRouter();
  const me = useQuery(refs.me, isAuthConfigured ? {} : "skip");
  const board = useQuery(
    refs.volunteersBoard,
    isAuthConfigured && me?.volunteer ? {} : "skip",
  ) as BoardItem[] | undefined;
  const setOnDuty = useMutation(refs.volunteersSetOnDuty);
  const claim = useMutation(refs.volunteersClaim);
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    void fn().catch((e) => setError(errorText(t, e)));
  };

  const onDuty = me?.volunteer?.onDuty ?? false;
  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("volunteer.title")}
      </Text>
      {error ? <Banner kind="error" icon="⚠" text={error} /> : null}

      {me?.volunteer ? (
        <>
          <View style={styles.card}>
            <View style={styles.row}>
              <Text style={styles.body}>{t("volunteer.onDuty")}</Text>
              <Switch
                value={onDuty}
                onValueChange={(v) => run(() => setOnDuty({ onDuty: v }))}
                accessibilityLabel={t("volunteer.onDuty")}
              />
            </View>
            <Text style={styles.help}>{t("volunteer.dutyNote")}</Text>
          </View>

          <Text accessibilityRole="header" style={styles.heading}>
            {t("volunteer.board")}
          </Text>
          {board && board.length === 0 ? (
            <Text style={styles.body}>{t("volunteer.boardEmpty")}</Text>
          ) : null}
          {(board ?? []).map((item) => (
            <View key={item.requestId} style={styles.card}>
              <TouchableOpacity
                accessibilityRole="button"
                onPress={() =>
                  router.push({
                    pathname: "/(app)/volunteer-request",
                    params: { id: item.requestId },
                  })
                }
              >
              <Text style={styles.bodyStrong}>
                {item.bloodGroup} •{" "}
                {t(item.unitsNeeded === 1 ? "units_one" : "units_other", {
                  count: item.unitsNeeded,
                })}
              </Text>
              <Text style={styles.body}>{item.hospitalName}</Text>
              <Text style={styles.help}>
                {t("volunteer.waiting", { min: item.waitingMin })}
              </Text>
              <Text style={styles.help}>
                {item.claimedByFirstName
                  ? t("volunteer.claimedBy", { name: item.claimedByFirstName })
                  : t("volunteer.unclaimed")}
              </Text>
              </TouchableOpacity>
              {!item.claimedByFirstName ? (
                <Button
                  label={t("volunteer.claim")}
                  variant="secondary"
                  onPress={() => run(() => claim({ requestId: item.requestId }))}
                />
              ) : null}
            </View>
          ))}
        </>
      ) : (
        <View style={styles.card}>
          <Text style={styles.body}>{t("volunteer.apply.body")}</Text>
          <Button
            label={t("volunteer.apply.title")}
            onPress={() => router.push("/(app)/volunteer-apply")}
          />
        </View>
      )}

      <View style={styles.card}>
        <Button
          label={t("verifyInPerson.title")}
          variant="secondary"
          onPress={() => router.push("/(app)/verify-in-person")}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  heading: { ...typography.heading, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  bodyStrong: { ...typography.bodyStrong, color: colors.text.primary },
  help: { ...typography.small, color: colors.text.muted },
  row: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  card: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
});
