import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { StyleSheet, Text, TextInput, View } from "react-native";
import { Banner, Button, HelplineButton, Sheet } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { authClient, isAuthConfigured } from "@/lib/auth-client";
import { useQuery } from "convex/react";
import { refs } from "@/lib/refs";

/**
 * SCR-O02 — Sign in (F-102, ADR-003). Google in production; the
 * practice sheet (D-R4) signs judges/trainers in with a Practice ID +
 * 6-digit PIN, shown only while the practice area is enabled
 * (public.appConfig.practiceAreaEnabled — a top-level field; the P1
 * stub read it under `features`, where it does not exist, so the
 * entry could never appear). The server hook (convex/auth.ts)
 * enforces the area switch and the 5-attempt lock; a 429 from it
 * maps to the keyed signin.practiceLocked copy.
 */
export default function SignIn() {
  const { t } = useTranslation();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [practiceOpen, setPracticeOpen] = useState(false);
  const [practiceId, setPracticeId] = useState("");
  const [pin, setPin] = useState("");
  const [practiceError, setPracticeError] = useState<"locked" | "generic" | null>(null);
  const [practiceBusy, setPracticeBusy] = useState(false);
  const appConfig = useQuery(refs.appConfig, isAuthConfigured ? {} : "skip");

  const practiceSignIn = () => {
    const id = practiceId.trim().toUpperCase();
    if (!/^P-\d{2,3}$/.test(id) || !/^\d{6}$/.test(pin)) {
      setPracticeError("generic");
      return;
    }
    setPracticeBusy(true);
    setPracticeError(null);
    void (async () => {
      try {
        const result = await authClient.signIn.email({
          email: `${id.toLowerCase()}@practice.udvasito.invalid`,
          password: pin,
        });
        if (result.error) {
          setPracticeError(result.error.status === 429 ? "locked" : "generic");
          return;
        }
        setPracticeOpen(false);
        router.replace("/(app)/home");
      } catch {
        setPracticeError("generic");
      } finally {
        setPracticeBusy(false);
      }
    })();
  };

  return (
    <View style={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("signin.title")}
      </Text>
      <Text style={styles.body}>{t("signin.body")}</Text>
      {!isAuthConfigured ? (
        <Banner kind="warning" icon="⚠" text={t("signin.notConfigured")} />
      ) : null}
      {error ? <Banner kind="error" icon="⚠" text={t("signin.error")} /> : null}
      <Button
        label={t("signin.google")}
        loading={busy}
        disabled={!isAuthConfigured}
        onPress={() => {
          setBusy(true);
          setError(false);
          void (async () => {
            try {
              await authClient.signIn.social({
                provider: "google",
                callbackURL: "/home",
              });
              router.replace("/(app)/home");
            } catch {
              setError(true);
            } finally {
              setBusy(false);
            }
          })();
        }}
      />
      <Text style={styles.why}>{t("signin.why")}</Text>
      <HelplineButton label={t("signin.helpline")} />
      {appConfig?.practiceAreaEnabled ? (
        <>
          <Button
            label={t("signin.practice")}
            variant="ghost"
            onPress={() => setPracticeOpen(true)}
          />
          <Sheet visible={practiceOpen} title={t("signin.practice")} onClose={() => setPracticeOpen(false)}>
            <Text style={styles.body}>{t("signin.practiceNote")}</Text>
            {practiceError === "locked" ? (
              <Banner kind="error" icon="⚠" text={t("signin.practiceLocked")} />
            ) : practiceError === "generic" ? (
              <Banner kind="error" icon="⚠" text={t("signin.error")} />
            ) : null}
            <Text style={styles.label}>{t("signin.practiceId")}</Text>
            <TextInput
              style={styles.input}
              value={practiceId}
              onChangeText={setPracticeId}
              autoCapitalize="characters"
              accessibilityLabel={t("signin.practiceId")}
            />
            <Text style={styles.label}>{t("signin.practicePin")}</Text>
            <TextInput
              style={styles.input}
              value={pin}
              onChangeText={setPin}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={6}
              accessibilityLabel={t("signin.practicePin")}
            />
            <Button
              label={t("signin.practice")}
              loading={practiceBusy}
              disabled={!isAuthConfigured}
              onPress={practiceSignIn}
            />
            <Button label={t("common.done")} variant="ghost" onPress={() => setPracticeOpen(false)} />
          </Sheet>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg.app },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  why: { ...typography.small, color: colors.text.muted },
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
});
