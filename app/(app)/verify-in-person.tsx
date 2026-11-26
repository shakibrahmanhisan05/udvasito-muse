import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Banner, Button } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { errorText } from "@/lib/errors";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * SCR-V06 — Verify someone in person (F-204 verifier side). The lookup
 * payload is minimised by the server: first name + last 4 digits only —
 * the verifier never receives the full number (tested, P1-G9).
 */
export default function VerifyInPerson() {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [submittedCode, setSubmittedCode] = useState<string | null>(null);
  const lookup = useQuery(
    refs.pvLookupInPerson,
    isAuthConfigured && submittedCode ? { code: submittedCode } : "skip",
  );
  const confirm = useMutation(refs.pvConfirmInPerson);
  const [done, setDone] = useState<"done" | "failed" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const doConfirm = (matches: boolean, verificationId: Id<"phoneVerifications">) => {
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const result = await confirm({ verificationId, matches });
        setDone(result.verified ? "done" : "failed");
      } catch (e) {
        setError(errorText(t, e));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("verifyInPerson.title")}
      </Text>
      <Text style={styles.body}>{t("verifyInPerson.body")}</Text>
      {error ? <Banner kind="error" icon="⚠" text={error} /> : null}
      {done === "done" && lookup ? (
        <Banner kind="success" icon="✓" text={t("verifyInPerson.done", { name: lookup.firstName })} />
      ) : null}
      {done === "failed" ? (
        <Banner kind="error" icon="⚠" text={t("verifyInPerson.failed")} />
      ) : null}

      <Text style={styles.label}>{t("verifyInPerson.code")}</Text>
      <TextInput
        style={styles.input}
        value={code}
        onChangeText={(v) => {
          const next = v.toUpperCase();
          setCode(next);
          setDone(null);
          // Lookup runs as soon as a complete code is entered.
          setSubmittedCode(next.trim().length === 6 ? next.trim() : null);
        }}
        accessibilityLabel={t("verifyInPerson.code")}
        autoCapitalize="characters"
        maxLength={6}
      />

      {lookup ? (
        <View style={styles.card}>
          <Text style={styles.body}>
            {t("verifyInPerson.check", { name: lookup.firstName, last4: lookup.phoneLast4 })}
          </Text>
          <Text style={styles.help}>{t("verifyInPerson.deleteCall")}</Text>
          <Button
            label={t("verifyInPerson.matches")}
            loading={busy}
            onPress={() => doConfirm(true, lookup.verificationId)}
          />
          <Button
            label={t("verifyInPerson.noMatch")}
            variant="danger"
            loading={busy}
            onPress={() => doConfirm(false, lookup.verificationId)}
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
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
