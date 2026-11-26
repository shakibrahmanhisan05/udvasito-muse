import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useAction, useQuery } from "convex/react";
import { Banner, Button } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { errorText } from "@/lib/errors";

/**
 * SCR-M08 — "Can I donate?" (F-604, if-time; behind
 * features.assistant). Banner, suggested-question chips (from the
 * approved FAQ), a simple chat list and the VAL-21 input. Answers
 * are FAQ entries verbatim (assistant.ask is FAQ-bound server-side);
 * each answer cites its FAQ question and carries the
 * not-medical-advice line. The "From FAQ:" prefix is unkeyed in
 * specs §4 — const below, flagged in the P7 gap list.
 */
const FROM_FAQ = "From FAQ:";

type Turn = {
  question: string;
  mode: "faq" | "doctor" | "nomatch" | "limit";
  answer?: string;
  faqQuestion?: string;
  limit?: number;
};

export default function Assistant() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bn" ? "bn" : "en";
  const appConfig = useQuery(refs.appConfig, isAuthConfigured ? {} : "skip");
  const enabled = appConfig?.features?.assistant === true;
  const faq = useQuery(refs.assistantFaqList, enabled ? { lang } : "skip") as
    | { id: string; question: string; answer: string }[]
    | undefined;
  const ask = useAction(refs.assistantAsk);
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!enabled) return null; // feature off → inert

  const send = (raw: string) => {
    const question = raw.trim();
    if (question.length < 3 || question.length > 300) {
      setError(t("validation.val21"));
      return;
    }
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const result = (await ask({ question, lang })) as {
          mode: Turn["mode"];
          answer?: string;
          faqId?: string;
          limit?: number;
        };
        const faqQuestion = result.faqId
          ? faq?.find((f) => f.id === result.faqId)?.question
          : undefined;
        setTurns((prev) => [
          ...prev,
          {
            question,
            mode: result.mode,
            answer: result.answer,
            faqQuestion,
            limit: result.limit,
          },
        ]);
        setInput("");
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
        {t("assistant.title")}
      </Text>
      <Banner kind="info" icon="ℹ" text={t("assistant.banner")} />
      {error ? <Banner kind="error" icon="⚠" text={error} /> : null}

      {faq && faq.length > 0 ? (
        <View style={styles.chips}>
          {faq.slice(0, 5).map((f) => (
            <Pressable
              key={f.id}
              accessibilityRole="button"
              onPress={() => send(f.question)}
              style={styles.chip}
            >
              <Text style={styles.chipText}>{f.question}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      {turns.map((turn, i) => (
        <View key={i} style={styles.card}>
          <Text style={styles.question}>{turn.question}</Text>
          {turn.mode === "faq" ? (
            <>
              <Text style={styles.body}>{turn.answer}</Text>
              {turn.faqQuestion ? (
                <Text style={styles.help}>
                  {FROM_FAQ} {turn.faqQuestion}
                </Text>
              ) : null}
              <Text style={styles.help}>{t("common.notMedicalAdvice")}</Text>
            </>
          ) : turn.mode === "doctor" ? (
            <Text style={styles.body}>{t("assistant.askDoctor")}</Text>
          ) : turn.mode === "limit" ? (
            <Text style={styles.body}>
              {t("assistant.limit", { n: turn.limit ?? 10 })}
            </Text>
          ) : (
            <Text style={styles.body}>{t("assistant.noMatch")}</Text>
          )}
        </View>
      ))}

      <TextInput
        style={styles.input}
        value={input}
        onChangeText={setInput}
        placeholder={t("assistant.title")}
        accessibilityLabel={t("assistant.title")}
        maxLength={300}
      />
      <Button
        label={t("assistant.title")}
        onPress={() => send(input)}
        disabled={busy}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  question: { ...typography.body, color: colors.text.primary, fontWeight: "700" },
  help: { ...typography.small, color: colors.text.muted },
  card: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.card,
    padding: spacing.md,
    gap: spacing.sm,
  },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  chipText: { ...typography.small, color: colors.text.primary },
  input: {
    ...typography.body,
    color: colors.text.primary,
    borderWidth: 1,
    borderColor: colors.border.input,
    borderRadius: radius.input,
    padding: spacing.md,
    minHeight: 52,
  },
});
