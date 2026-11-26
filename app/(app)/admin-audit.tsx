import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useQuery } from "convex/react";
import { Button } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";

type AuditRow = {
  auditId: string;
  createdAt: number;
  actorName: string | null;
  actorRole: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
};

/**
 * SCR-A06 — Audit viewer (F-804). Read-only and filterable by action
 * text (the server also filters by actor and date range). The screen
 * title is specs §3.6 prose without an i18n key (I18N-GAPS §4),
 * rendered verbatim; rows render audit data as-is and can never
 * contain phone numbers (§6.9).
 */
// Specs §3.6 prose without an i18n key (I18N-GAPS §4), pending key review.
const TITLE = "Audit log";

export default function AdminAudit() {
  const { t } = useTranslation();
  const [action, setAction] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [page, setPage] = useState(0);
  const result = useQuery(
    refs.auditList,
    isAuthConfigured
      ? {
          action: action.trim() ? action.trim() : undefined,
          paginationOpts: { numItems: 50, cursor },
        }
      : "skip",
  ) as { page: AuditRow[]; isDone: boolean; continueCursor: string } | undefined;

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {TITLE}
      </Text>
      <TextInput
        style={styles.input}
        value={action}
        onChangeText={(value) => {
          setAction(value);
          setCursor(null);
          setPage(0);
        }}
      />
      {(result?.page ?? []).map((row) => (
        <View key={row.auditId} style={styles.card}>
          <Text style={styles.bodyStrong}>{row.action}</Text>
          <Text style={styles.body}>
            {row.actorName ?? row.actorRole} • {row.actorRole}
          </Text>
          <Text style={styles.help}>
            {row.targetType} • {new Date(row.createdAt).toLocaleString()}
          </Text>
          {row.reason ? <Text style={styles.body}>{row.reason}</Text> : null}
        </View>
      ))}
      <View style={styles.row}>
        <Button
          label={t("common.back")}
          variant="secondary"
          disabled={page === 0}
          onPress={() => {
            // Offset cursors are forward-only; going back restarts the
            // list (documented trade-off of the offset-cursor design).
            setCursor(null);
            setPage(0);
          }}
        />
        <Button
          label={t("common.continue")}
          variant="secondary"
          disabled={!result || result.isDone}
          onPress={() => {
            if (result) {
              setCursor(result.continueCursor);
              setPage((p) => p + 1);
            }
          }}
        />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  bodyStrong: { ...typography.bodyStrong, color: colors.text.primary },
  help: { ...typography.small, color: colors.text.muted },
  row: { flexDirection: "row", gap: spacing.md },
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
