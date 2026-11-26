import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Linking, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation } from "convex/react";
import { Button, ErrorState, FieldLabel } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { refs } from "@/lib/refs";

/**
 * SCR-A13 — Import / export (F-905, switch `dataImportExport`).
 * Import pastes a donor CSV (name, phone, bloodGroup, district,
 * upazila, lastDonationDate, consentEvidence) and reports exactly
 * what happened per row — imports create invitations only. Exports:
 * anonymised stats for any admin; personal data is super-admin only
 * (the server refuses and rate-limits) and returns a 24 h link.
 * Chrome is unkeyed in specs §4 — consts, flagged in P7-REPORT.
 */

const TITLE = "Import / export";
const IMPORT_TITLE = "Import donors (CSV)";
const IMPORT_HINT =
  "Columns: name, phone, bloodGroup, district, upazila, lastDonationDate, consentEvidence. Imports create invitations only — nobody becomes a donor from an import.";
const IMPORT_BUTTON = "Import";
const EXPORT_ANON = "Export anonymised stats (CSV)";
const EXPORT_PERSONAL = "Export personal data (CSV, super-admin)";
const OPEN_FILE = "Open the file";

type ImportReport = {
  created: number;
  skipped: number;
  invalid: { row: number; reason: string }[];
};

export default function AdminData() {
  const { t } = useTranslation();
  const importDonors = useMutation(refs.adminDataImportDonors);
  const exportData = useMutation(refs.adminDataExport);
  const [csv, setCsv] = useState("");
  const [report, setReport] = useState<ImportReport | null>(null);
  const [fileUrl, setFileUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch {
      setError(t("errors.generic"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {TITLE}
      </Text>
      <View style={styles.card}>
        <Text style={styles.bodyStrong}>{IMPORT_TITLE}</Text>
        <Text style={styles.help}>{IMPORT_HINT}</Text>
        <FieldLabel>{IMPORT_TITLE}</FieldLabel>
        <TextInput
          style={[styles.input, styles.area]}
          value={csv}
          onChangeText={setCsv}
          multiline
          accessibilityLabel={IMPORT_TITLE}
        />
        <Button
          label={IMPORT_BUTTON}
          loading={busy}
          disabled={csv.trim().length < 10}
          onPress={() =>
            void run(async () => {
              const out = (await importDonors({ csv })) as ImportReport;
              setReport(out);
            })
          }
        />
        {report ? (
          <Text style={styles.body}>
            {`Created ${report.created} • Skipped ${report.skipped} • Invalid ${report.invalid.length}`}
            {report.invalid.length
              ? `\n${report.invalid.map((r) => `Row ${r.row}: ${r.reason}`).join("\n")}`
              : ""}
          </Text>
        ) : null}
      </View>
      <View style={styles.card}>
        <Button
          label={EXPORT_ANON}
          variant="secondary"
          loading={busy}
          onPress={() =>
            void run(async () => {
              const out = (await exportData({ kind: "anon_stats" })) as { url: string | null };
              setFileUrl(out.url);
            })
          }
        />
        <Button
          label={EXPORT_PERSONAL}
          variant="secondary"
          loading={busy}
          onPress={() =>
            void run(async () => {
              const out = (await exportData({ kind: "personal_data" })) as { url: string | null };
              setFileUrl(out.url);
            })
          }
        />
        {fileUrl ? (
          <Button label={OPEN_FILE} onPress={() => void Linking.openURL(fileUrl)} />
        ) : null}
        {error ? <ErrorState message={error} /> : null}
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
  area: { minHeight: 140, textAlignVertical: "top", paddingTop: spacing.md },
});
