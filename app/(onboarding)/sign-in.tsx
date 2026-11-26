import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import { Banner, Button, HelplineButton, Sheet } from "@/components";
import { colors, spacing, typography } from "@/theme/tokens";
import { authClient, isAuthConfigured } from "@/lib/auth-client";
import { useQuery } from "convex/react";
import { refs } from "@/lib/refs";

/** SCR-O02 — Sign in (F-102, ADR-003). Google only in production. */
export default function SignIn() {
  const { t } = useTranslation();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [practiceOpen, setPracticeOpen] = useState(false);
  const appConfig = useQuery(refs.appConfig, isAuthConfigured ? {} : "skip");

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
      {appConfig?.features.practiceAreaEnabled ? (
        <>
          <Button
            label={t("signin.practice")}
            variant="ghost"
            onPress={() => setPracticeOpen(true)}
          />
          <Sheet visible={practiceOpen} title={t("signin.practice")} onClose={() => setPracticeOpen(false)}>
            <Text style={styles.body}>{t("signin.practiceNote")}</Text>
            <Button label={t("common.done")} onPress={() => setPracticeOpen(false)} />
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
});
