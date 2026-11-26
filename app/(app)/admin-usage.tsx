import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Linking, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Banner, Button } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { errorText } from "@/lib/errors";

type UsageRow = {
  service: string;
  used: number | null;
  limit: number | null;
  unit: string;
  pct: number | null;
  status: "ok" | "warn" | "critical" | null;
  source: string;
  dashboardUrl: string | null;
  note: string | null;
};
type UsageData = {
  day: string;
  warnPct: number;
  criticalPct: number;
  rows: UsageRow[];
  degradationOrder: string[];
  corePathProtected: boolean;
};

/**
 * SCR-A08/A13 — Usage monitor (F-911). Measured rows show live
 * numbers; dashboard rows link out to the provider (specs: "else a
 * link to the provider dashboard"); manual rows accept the number a
 * human read off that dashboard (service + metric + value, saved via
 * the keyed common.save). Warning banners use the keyed S-30 strings
 * admin.usageWarn / admin.usageCritical.
 */
export default function AdminUsage() {
  const { t } = useTranslation();
  const data = useQuery(refs.usageGet, isAuthConfigured ? {} : "skip") as UsageData | undefined;
  const setManual = useMutation(refs.usageSetManualEntry);
  const [service, setService] = useState("");
  const [metric, setMetric] = useState("");
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const degradation = (data?.degradationOrder ?? []).join(" → ");
  const worst = data?.rows.some((r) => r.status === "critical")
    ? "critical"
    : data?.rows.some((r) => r.status === "warn")
      ? "warn"
      : null;

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("admin.usage")}
      </Text>
      {error ? <Banner kind="error" icon="⚠" text={error} /> : null}
      {done ? <Banner kind="success" icon="✓" text={t("common.done")} /> : null}
      {worst === "critical" ? (
        <Banner kind="error" icon="⚠" text={t("admin.usageCritical")} />
      ) : worst === "warn" ? (
        <Banner kind="warning" icon="⚠" text={t("admin.usageWarn")} />
      ) : null}
      {(data?.rows ?? []).map((row) => (
        <View key={row.service} style={styles.card}>
          <Text style={styles.bodyStrong}>{row.service}</Text>
          <Text style={styles.body}>
            {row.used ?? ""}
            {row.limit !== null ? ` / ${row.limit}` : ""} {row.unit}
            {row.pct !== null ? ` • ${row.pct}%` : ""}
          </Text>
          <Text style={styles.help}>
            {row.source}
            {row.status ? ` • ${row.status}` : ""}
          </Text>
          {row.note ? <Text style={styles.help}>{row.note}</Text> : null}
          {row.dashboardUrl ? (
            <Button
              label={row.dashboardUrl}
              variant="ghost"
              onPress={() => void Linking.openURL(row.dashboardUrl!)}
            />
          ) : null}
        </View>
      ))}
      <View style={styles.card}>
        <TextInput
          style={styles.input}
          value={service}
          onChangeText={setService}
        />
        <TextInput
          style={styles.input}
          value={metric}
          onChangeText={setMetric}
        />
        <TextInput
          style={styles.input}
          value={value}
          onChangeText={setValue}
          keyboardType="numeric"
        />
        <Button
          label={t("common.save")}
          disabled={!service.trim() || !metric.trim() || !(Number(value) >= 0)}
          onPress={() => {
            setError(null);
            setDone(false);
            void setManual({ service: service.trim(), metric: metric.trim(), value: Number(value) })
              .then(() => setDone(true))
              .catch((e) => setError(errorText(t, e)));
          }}
        />
      </View>
      {data ? (
        <Text style={styles.help}>
          {data.day} • {degradation}
        </Text>
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
