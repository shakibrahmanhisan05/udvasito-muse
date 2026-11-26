import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation } from "convex/react";
import { Banner, Button, ChipRow } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { refs } from "@/lib/refs";
import { errorText } from "@/lib/errors";
import type { Id } from "@/convex/_generated/dataModel";

const REASONS = ["fake", "money", "harassment", "other"] as const;

/**
 * SCR-C01 — Report & block (F-801). Opened from the alert detail and the
 * request screen. The server applies the automatic freezes of PRD §5.8;
 * blocking is on by default for money/harassment reports.
 */
export default function Report() {
  const { t } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ subject: string; requestId?: string }>();
  const create = useMutation(refs.reportsCreate);
  const [reason, setReason] = useState<(typeof REASONS)[number] | null>(null);
  const [details, setDetails] = useState("");
  const [block, setBlock] = useState(false);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = () => {
    if (!reason || !params.subject) return;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        await create({
          subjectAuthUserId: params.subject,
          ...(params.requestId ? { requestId: params.requestId as Id<"requests"> } : {}),
          reason,
          ...(details.trim() ? { details: details.trim() } : {}),
          block,
        });
        setSent(true);
      } catch (e) {
        setError(errorText(t, e));
      } finally {
        setBusy(false);
      }
    })();
  };

  if (sent) {
    return (
      <View style={styles.wrap}>
        <Banner kind="success" icon="✓" text={t("report.thanks")} />
        <Button label={t("common.back")} onPress={() => router.back()} />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("report.title")}
      </Text>
      {error ? <Banner kind="error" icon="⚠" text={error} /> : null}
      <ChipRow
        accessibilityLabel={t("report.title")}
        options={REASONS.map((r) => ({ value: r, label: t(`report.${r}`) }))}
        value={reason}
        onChange={(v) => {
          const next = v as (typeof REASONS)[number];
          setReason(next);
          if (next === "money" || next === "harassment") setBlock(true);
        }}
      />
      <TextInput
        style={styles.input}
        accessibilityLabel={t("report.details")}
        placeholder={t("report.details")}
        value={details}
        onChangeText={setDetails}
        multiline
      />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: block }}
        accessibilityLabel={t("report.block")}
        onPress={() => setBlock((v) => !v)}
        style={styles.checkRow}
      >
        <View style={[styles.checkbox, block && styles.checkboxChecked]}>
          {block ? <Text style={styles.checkmark}>✓</Text> : null}
        </View>
        <Text style={styles.checkLabel}>{t("report.block")}</Text>
      </Pressable>
      <Button label={t("report.send")} loading={busy} disabled={!reason} onPress={send} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  input: {
    ...typography.body,
    borderWidth: 1,
    borderColor: colors.border.input,
    borderRadius: radius.card,
    padding: spacing.md,
    minHeight: 80,
    textAlignVertical: "top",
    color: colors.text.primary,
    backgroundColor: colors.bg.surface,
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
