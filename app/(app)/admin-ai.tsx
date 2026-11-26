import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Switch, Text, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Banner } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { errorText } from "@/lib/errors";

type AiStatus = {
  features: {
    feature: string;
    enabled: boolean;
    callsToday: number;
    failuresToday: number;
    lastError: string | null;
  }[];
  models: { lite: string; flash: string };
  unconfigured: boolean;
  usage: {
    lite: { calls: number; limit: number; pct: number };
    flash: { calls: number; limit: number; pct: number };
    rpmLimit: number;
  };
  fallback80Active: boolean;
  retentionDays: number;
};
type LogRow = {
  aiCallId: string;
  createdAt: number;
  feature: string;
  model: string;
  ok: boolean;
  error: string | null;
  isDemo: boolean;
  inputPreview: string;
  outputPreview: string | null;
};

/**
 * SCR-A07 — AI controls & log (F-902). The switches write the same
 * ai.features settings the backend reads, so a feature turned off
 * here degrades to the rules-only path immediately; when off, the
 * keyed admin.aiOff line says so. The log shows the redacted inputs
 * and outputs (200-char previews; full rows live server-side under
 * S-36 retention). Practice calls are badged with the keyed
 * common.demo marker — they share the same quota.
 */
export default function AdminAi() {
  const { t } = useTranslation();
  const status = useQuery(refs.aiStatus, isAuthConfigured ? {} : "skip") as AiStatus | undefined;
  const log = useQuery(
    refs.aiLog,
    isAuthConfigured ? { paginationOpts: { numItems: 50, cursor: null } } : "skip",
  ) as { page: LogRow[] } | undefined;
  const setFeature = useMutation(refs.aiSetFeature);
  const [error, setError] = useState<string | null>(null);

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("admin.ai")}
      </Text>
      {error ? <Banner kind="error" icon="⚠" text={error} /> : null}
      {status?.unconfigured ? (
        <Banner kind="warning" icon="⚠" text={t("admin.aiOff")} />
      ) : null}
      {status ? (
        <View style={styles.card}>
          <Text style={styles.body}>
            {`${status.models.lite || ""} • ${status.usage.lite.calls}/${status.usage.lite.limit} • ${Math.round(status.usage.lite.pct)}%`}
          </Text>
          <Text style={styles.body}>
            {`${status.models.flash || ""} • ${status.usage.flash.calls}/${status.usage.flash.limit} • ${Math.round(status.usage.flash.pct)}%`}
          </Text>
          {status.fallback80Active ? (
            <Banner kind="warning" icon="⚠" text={t("admin.usageWarn")} />
          ) : null}
          <Text style={styles.help}>{status.retentionDays}</Text>
        </View>
      ) : null}
      {(status?.features ?? []).map((feature) => (
        <View key={feature.feature} style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.bodyStrong}>{feature.feature}</Text>
            <Switch
              value={feature.enabled}
              onValueChange={(enabled) => {
                setError(null);
                void setFeature({ feature: feature.feature, enabled }).catch((e) =>
                  setError(errorText(t, e)),
                );
              }}
              accessibilityLabel={feature.feature}
            />
          </View>
          {!feature.enabled ? <Text style={styles.help}>{t("admin.aiOff")}</Text> : null}
          <Text style={styles.help}>
            {feature.callsToday} • {feature.failuresToday}
            {feature.lastError ? ` • ${feature.lastError}` : ""}
          </Text>
        </View>
      ))}
      {(log?.page ?? []).map((row) => (
        <View key={row.aiCallId} style={styles.card}>
          <Text style={styles.bodyStrong}>
            {row.feature} • {row.model} • {row.ok ? "✓" : (row.error ?? "")}
            {row.isDemo ? ` • ${t("common.demo")}` : ""}
          </Text>
          <Text style={styles.help}>{new Date(row.createdAt).toLocaleString()}</Text>
          <Text style={styles.body}>{row.inputPreview}</Text>
          {row.outputPreview ? <Text style={styles.help}>{row.outputPreview}</Text> : null}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  bodyStrong: { ...typography.bodyStrong, color: colors.text.primary },
  help: { ...typography.small, color: colors.text.muted },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  card: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
});
