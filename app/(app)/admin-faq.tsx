import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Button, ErrorState, FieldLabel } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * SCR-A12 — FAQ management (F-907, switch `faqUi`). List + editor
 * (question/answer EN/BN, tags) with the VAL-24 approval gate: an
 * entry can be approved only when both languages are complete; the
 * server records approver + date. Editing an approved entry returns
 * it to draft (server-side). Chrome is unkeyed in specs §4 — consts,
 * flagged in P7-REPORT.
 */

const TITLE = "FAQ management";
const ADD = "Add entry";
const APPROVE = "Approve";
const TO_DRAFT = "Back to draft";
const DRAFT = "Draft";
const APPROVED = "Approved";
const Q_EN = "Question (English)";
const Q_BN = "Question (Bangla)";
const A_EN = "Answer (English)";
const A_BN = "Answer (Bangla)";
const TAGS = "Tags (comma separated)";
const joinTags = (tags: string[]): string => tags.join(", ");

type Row = {
  _id: Id<"faqEntries">;
  questionEn: string;
  questionBn: string;
  answerEn: string;
  answerBn: string;
  tags: string[];
  status: "draft" | "approved";
  approvedBy: string | null;
  approvedAt: number | null;
};

export default function AdminFaq() {
  const { t } = useTranslation();
  const rows = useQuery(refs.adminFaqList, isAuthConfigured ? {} : "skip") as Row[] | undefined;
  const save = useMutation(refs.adminFaqSave);
  const setStatus = useMutation(refs.adminFaqSetStatus);

  const [editing, setEditing] = useState<Row | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [qEn, setQEn] = useState("");
  const [qBn, setQBn] = useState("");
  const [aEn, setAEn] = useState("");
  const [aBn, setABn] = useState("");
  const [tags, setTags] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openForm = (row: Row | null) => {
    setEditing(row);
    setQEn(row?.questionEn ?? "");
    setQBn(row?.questionBn ?? "");
    setAEn(row?.answerEn ?? "");
    setABn(row?.answerBn ?? "");
    setTags((row?.tags ?? []).join(", "));
    setError(null);
    setFormOpen(true);
  };

  const doSave = () => {
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        await save({
          ...(editing ? { faqId: editing._id } : {}),
          questionEn: qEn,
          questionBn: qBn,
          answerEn: aEn,
          answerBn: aBn,
          tags: tags.split(",").map((x) => x.trim()).filter(Boolean),
        });
        setFormOpen(false);
      } catch {
        setError(t("errors.generic"));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {TITLE}
      </Text>
      {!formOpen ? (
        <Button label={ADD} variant="secondary" onPress={() => openForm(null)} />
      ) : null}
      {formOpen ? (
        <View style={styles.card}>
          <FieldLabel>{Q_EN}</FieldLabel>
          <TextInput style={styles.input} value={qEn} onChangeText={setQEn} accessibilityLabel={Q_EN} />
          <FieldLabel>{Q_BN}</FieldLabel>
          <TextInput style={styles.input} value={qBn} onChangeText={setQBn} accessibilityLabel={Q_BN} />
          <FieldLabel>{A_EN}</FieldLabel>
          <TextInput style={[styles.input, styles.area]} value={aEn} onChangeText={setAEn} multiline accessibilityLabel={A_EN} />
          <FieldLabel>{A_BN}</FieldLabel>
          <TextInput style={[styles.input, styles.area]} value={aBn} onChangeText={setABn} multiline accessibilityLabel={A_BN} />
          <FieldLabel>{TAGS}</FieldLabel>
          <TextInput style={styles.input} value={tags} onChangeText={setTags} accessibilityLabel={TAGS} />
          {error ? <ErrorState message={error} /> : null}
          <Button label={t("common.save")} loading={busy} onPress={doSave} />
          <Button label={t("common.cancel")} variant="ghost" onPress={() => setFormOpen(false)} />
        </View>
      ) : null}
      {(rows ?? []).map((row) => (
        <View key={row._id} style={styles.card}>
          <Text style={styles.bodyStrong}>{row.questionEn}</Text>
          <Text style={styles.body}>{row.questionBn}</Text>
          <Text style={styles.help}>
            {`${row.status === "approved" ? APPROVED : DRAFT}${row.tags.length ? ` • ${joinTags(row.tags)}` : ""}`}
          </Text>
          <Button label={t("common.edit")} variant="secondary" onPress={() => openForm(row)} />
          {row.status === "draft" ? (
            <Button
              label={APPROVE}
              variant="secondary"
              onPress={() => void setStatus({ faqId: row._id, status: "approved" }).catch(() => {})}
            />
          ) : (
            <Button
              label={TO_DRAFT}
              variant="ghost"
              onPress={() => void setStatus({ faqId: row._id, status: "draft" }).catch(() => {})}
            />
          )}
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
  area: { minHeight: 96, textAlignVertical: "top", paddingTop: spacing.md },
});
