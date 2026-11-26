import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams } from "expo-router";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Banner, Button } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { errorText } from "@/lib/errors";
import type { Id } from "@/convex/_generated/dataModel";

type Detail = {
  itemId: Id<"moderationItems">;
  kind: string;
  severity: string;
  status: string;
  subjectName: string | null;
  subjectRole: string | null;
  decision: string | null;
  decisionReason: string | null;
  reports: { reportId: string; reason: string; details: string | null; autoAction: string | null; createdAt: number }[];
  request: {
    bloodGroup: string;
    component: string;
    unitsNeeded: number;
    unitsConfirmed: number;
    hospitalName: string;
    status: string;
    hiddenByModerator: boolean;
  } | null;
  subjectHistory: {
    requests: number;
    responses: number;
    reportsAbout: number;
    revealsAsViewer: number;
    revealsAsSubject: number;
  } | null;
  auditTrail: { action: string; actorRole: string; reason: string | null; createdAt: number }[];
};

const DECISIONS = ["dismiss", "warn", "hide_request", "suspend", "ban", "restore"] as const;
// Specs §3.6 prose without i18n keys (I18N-GAPS §4), pending key review.
const TITLE = "Moderation queue";
const HIDDEN = "hidden";

/**
 * SCR-A03 — Moderation decision (F-803). The reason field reuses the
 * keyed volunteer.revealReason label pattern (a reason is always
 * required, VAL-18); decision button labels are unkeyed in specs
 * (I18N-GAPS §4) so they render the decision values, exactly like
 * SCR-A05 renders role/status values. Suspend asks for days via the
 * same input (1–30, validated server-side).
 */
export default function AdminModerationItem() {
  const { t } = useTranslation();
  const params = useLocalSearchParams<{ id: string }>();
  const itemId = params.id as Id<"moderationItems">;
  const detail = useQuery(
    refs.moderationGet,
    isAuthConfigured && itemId ? { itemId } : "skip",
  ) as Detail | undefined;
  const decide = useMutation(refs.moderationDecide);
  const [reason, setReason] = useState("");
  const [suspendDays, setSuspendDays] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const run = (decision: (typeof DECISIONS)[number]) => {
    setError(null);
    setDone(false);
    void decide({
      itemId,
      decision,
      reason: reason.trim(),
      suspendDays: decision === "suspend" ? Number(suspendDays) : undefined,
    })
      .then(() => setDone(true))
      .catch((e) => setError(errorText(t, e)));
  };

  if (!detail) {
    return (
      <View style={styles.wrap}>
        <Text accessibilityRole="header" style={styles.title}>
          {TITLE}
        </Text>
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {detail.kind} • {detail.severity}
      </Text>
      {error ? <Banner kind="error" icon="⚠" text={error} /> : null}
      {done ? <Banner kind="success" icon="✓" text={t("common.done")} /> : null}
      <View style={styles.card}>
        <Text style={styles.bodyStrong}>{detail.subjectName ?? ""}</Text>
        <Text style={styles.help}>{detail.subjectRole ?? ""}</Text>
        {detail.subjectHistory ? (
          <Text style={styles.body}>
            {detail.subjectHistory.requests} • {detail.subjectHistory.responses} •{" "}
            {detail.subjectHistory.reportsAbout} • {detail.subjectHistory.revealsAsViewer} •{" "}
            {detail.subjectHistory.revealsAsSubject}
          </Text>
        ) : null}
      </View>
      {detail.reports.map((report) => (
        <View key={report.reportId} style={styles.card}>
          <Text style={styles.bodyStrong}>{report.reason}</Text>
          {report.details ? <Text style={styles.body}>{report.details}</Text> : null}
          {report.autoAction ? <Text style={styles.help}>{report.autoAction}</Text> : null}
          <Text style={styles.help}>{new Date(report.createdAt).toLocaleString()}</Text>
        </View>
      ))}
      {detail.request ? (
        <View style={styles.card}>
          <Text style={styles.bodyStrong}>
            {detail.request.bloodGroup} • {detail.request.component}
          </Text>
          <Text style={styles.body}>{detail.request.hospitalName}</Text>
          <Text style={styles.help}>
            {`${detail.request.unitsConfirmed}/${detail.request.unitsNeeded} • ${detail.request.status}`}
            {detail.request.hiddenByModerator ? ` • ${HIDDEN}` : ""}
          </Text>
        </View>
      ) : null}
      {detail.status === "open" ? (
        <View style={styles.card}>
          <Text style={styles.label}>{t("volunteer.revealReason")}</Text>
          <TextInput
            style={styles.input}
            value={reason}
            onChangeText={setReason}
            accessibilityLabel={t("volunteer.revealReason")}
          />
          <TextInput
            style={styles.input}
            value={suspendDays}
            onChangeText={setSuspendDays}
            keyboardType="number-pad"
          />
          {DECISIONS.map((decision) => (
            <Button
              key={decision}
              label={decision}
              variant={decision === "ban" ? "danger" : "secondary"}
              disabled={reason.trim().length < 5}
              onPress={() => run(decision)}
            />
          ))}
        </View>
      ) : (
        <View style={styles.card}>
          <Text style={styles.bodyStrong}>{detail.decision ?? ""}</Text>
          <Text style={styles.body}>{detail.decisionReason ?? ""}</Text>
        </View>
      )}
      {detail.auditTrail.length > 0 ? (
        <View style={styles.card}>
          {detail.auditTrail.map((row, i) => (
            <Text key={i} style={styles.help}>
              {row.action} • {row.actorRole} • {new Date(row.createdAt).toLocaleString()}
              {row.reason ? ` • ${row.reason}` : ""}
            </Text>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  bodyStrong: { ...typography.bodyStrong, color: colors.text.primary },
  help: { ...typography.small, color: colors.text.muted },
  label: { ...typography.bodyStrong, color: colors.text.primary },
  input: {
    minHeight: 52,
    borderWidth: 1,
    borderColor: colors.border.input,
    borderRadius: radius.input,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.bg.surface,
    color: colors.text.primary,
    ...typography.body,
  },
  card: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
});
