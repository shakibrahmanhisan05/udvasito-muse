import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Button, ErrorState } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";

type SettingRow = {
  key: string;
  value: unknown;
  defaultValue: unknown;
  isDefault: boolean;
  range: [number, number] | null;
  ref: string;
  fixed: boolean;
};

// Specs §5.2 wording for the S-01 guard, without an i18n key
// (I18N-GAPS §4), pending key review.
const FIXED = "fixed";
// F-904 edit chrome — unkeyed in specs §4 (P7 gap list).
const REASON_LABEL = "Reason for the change (required, kept in the audit log)";
const RESET = "Reset to default";
const ON = "On";
const OFF = "Off";

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * SCR-A10 — Rule settings (F-904). Read-only core from P5; the P7
 * if-time editing ships behind `features.settingsEdit`: scalar rows
 * get an inline editor, the two feature-flag objects get per-switch
 * toggles, every change needs a reason and is audited server-side
 * as `setting_changed` (VAL-19 ranges enforced server-side too).
 */
export default function AdminSettings() {
  const { t } = useTranslation();
  const appConfig = useQuery(refs.appConfig, isAuthConfigured ? {} : "skip");
  const rows = useQuery(refs.adminSettingsList, isAuthConfigured ? {} : "skip") as
    | SettingRow[]
    | undefined;
  const update = useMutation(refs.adminSettingsUpdate);
  const editOn = appConfig?.features?.settingsEdit === true;

  const [reason, setReason] = useState("");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const reasonOk = reason.trim().length >= 3;

  const apply = async (key: string, value: unknown) => {
    if (!reasonOk) return;
    setBusyKey(key);
    setError(null);
    try {
      await update({ key, value, reason: reason.trim() });
    } catch {
      setError(t("errors.generic"));
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("settings.title")}
      </Text>
      {editOn ? (
        <View style={styles.card}>
          <Text style={styles.body}>{REASON_LABEL}</Text>
          <TextInput
            style={styles.input}
            value={reason}
            onChangeText={setReason}
            accessibilityLabel={REASON_LABEL}
          />
          {error ? <ErrorState message={error} /> : null}
        </View>
      ) : null}
      {(rows ?? []).map((row) => {
        const isFlags =
          (row.key === "features" || row.key === "ai.features") &&
          row.value !== null &&
          typeof row.value === "object";
        const scalar =
          typeof row.defaultValue === "number" ||
          typeof row.defaultValue === "boolean" ||
          typeof row.defaultValue === "string";
        return (
          <View key={row.key} style={styles.card}>
            <Text style={styles.bodyStrong}>{row.key}</Text>
            <Text style={styles.body}>{formatValue(row.value)}</Text>
            <Text style={styles.help}>
              {row.ref}
              {row.range ? ` • ${row.range[0]}–${row.range[1]}` : ""}
              {row.isDefault ? "" : ` • ≠ ${formatValue(row.defaultValue)}`}
              {row.fixed ? ` • ${FIXED}` : ""}
            </Text>
            {editOn && !row.fixed && isFlags ? (
              <View style={styles.flagList}>
                {Object.entries(row.value as Record<string, boolean>).map(([sub, on]) => (
                  <Pressable
                    key={sub}
                    accessibilityRole="switch"
                    accessibilityState={{ checked: on }}
                    accessibilityLabel={sub}
                    disabled={!reasonOk || busyKey === row.key}
                    onPress={() =>
                      void apply(row.key, {
                        ...(row.value as Record<string, boolean>),
                        [sub]: !on,
                      })
                    }
                    style={styles.flagRow}
                  >
                    <Text style={styles.body}>{sub}</Text>
                    <Text style={styles.bodyStrong}>{on ? ON : OFF}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            {editOn && !row.fixed && scalar ? (
              <>
                {typeof row.defaultValue === "boolean" ? (
                  <Button
                    label={(row.value as boolean) ? OFF : ON}
                    variant="secondary"
                    disabled={!reasonOk}
                    loading={busyKey === row.key}
                    onPress={() => void apply(row.key, !(row.value as boolean))}
                  />
                ) : (
                  <>
                    <TextInput
                      style={styles.input}
                      value={drafts[row.key] ?? formatValue(row.value)}
                      onChangeText={(text) =>
                        setDrafts((d) => ({ ...d, [row.key]: text }))
                      }
                      accessibilityLabel={row.key}
                      keyboardType={
                        typeof row.defaultValue === "number" ? "numbers-and-punctuation" : "default"
                      }
                    />
                    <Button
                      label={t("common.save")}
                      variant="secondary"
                      disabled={!reasonOk}
                      loading={busyKey === row.key}
                      onPress={() => {
                        const raw = drafts[row.key] ?? formatValue(row.value);
                        void apply(
                          row.key,
                          typeof row.defaultValue === "number" ? Number(raw) : raw,
                        );
                      }}
                    />
                  </>
                )}
                {!row.isDefault ? (
                  <Button
                    label={RESET}
                    variant="ghost"
                    disabled={!reasonOk}
                    onPress={() => void apply(row.key, row.defaultValue)}
                  />
                ) : null}
              </>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  bodyStrong: { ...typography.bodyStrong, color: colors.text.primary },
  help: { ...typography.small, color: colors.text.muted },
  card: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border.input,
    borderRadius: radius.input,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    color: colors.text.primary,
    backgroundColor: colors.bg.app,
  },
  flagList: { gap: spacing.sm },
  flagRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: 48,
  },
});
