import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Banner, Button, ErrorState, Skeleton } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { errorText } from "@/lib/errors";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * SCR-M09 — "Did the donation happen?" (F-502). One row per confirmed
 * donor: the requester answers about each donor; a donor answers about
 * themselves (only the donor's own "yes" starts their cooldown, F-503).
 * Reached from the NTF-10 notification and from the request screen.
 */
export default function Confirm() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ id: string }>();
  const requestId = params.id as Id<"requests">;
  const data = useQuery(
    refs.responsesGetConfirmations,
    isAuthConfigured && params.id ? { requestId } : "skip",
  );
  const recordOutcome = useMutation(refs.responsesRecordOutcome);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (data === undefined) {
    return (
      <View style={styles.wrap}>
        <Skeleton height={28} width="60%" />
        <Skeleton height={120} />
      </View>
    );
  }
  if (data === null) return <ErrorState />;

  const answer = (responseId: string, outcome: "donated" | "not_donated" | "not_yet") => {
    setBusyId(responseId);
    setError(null);
    void (async () => {
      try {
        await recordOutcome({ responseId: responseId as Id<"responses">, outcome });
      } catch (e) {
        setError(errorText(t, e));
      } finally {
        setBusyId(null);
      }
    })();
  };

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("confirm.title")}
      </Text>
      {error ? <Banner kind="error" icon="⚠" text={error} /> : null}
      {data.rows.map(
        (row: {
          responseId: string;
          donorFirstName: string;
          isMine: boolean;
          myOutcome: string | null;
        }) => (
          <View key={row.responseId} style={styles.card}>
            <Text style={styles.body}>{row.donorFirstName}</Text>
            {row.isMine ? <Text style={styles.help}>{t("confirm.cooldownNote")}</Text> : null}
            {row.myOutcome === "donated" ? (
              <Banner kind="success" icon="✓" text={t("confirm.thanks")} />
            ) : row.myOutcome ? (
              <Text style={styles.body}>{t("confirm.notYet")}</Text>
            ) : (
              <View style={styles.row}>
                <Button
                  label={t("confirm.yes")}
                  loading={busyId === row.responseId}
                  onPress={() => answer(row.responseId, "donated")}
                />
                <Button
                  label={t("confirm.no")}
                  variant="secondary"
                  onPress={() => answer(row.responseId, "not_donated")}
                />
                <Button
                  label={t("confirm.notYet")}
                  variant="ghost"
                  onPress={() => answer(row.responseId, "not_yet")}
                />
              </View>
            )}
          </View>
        ),
      )}
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
  row: { gap: spacing.sm },
});
