import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Banner, Button } from "@/components";
import { colors, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { errorText } from "@/lib/errors";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * SCR-O04 — Verify phone (F-201…F-204). Methods shown come from
 * public.appConfig.verification (admin-controlled). Telegram is the primary
 * ৳0 path; WhatsApp appears only when the team enables it; in-person is
 * always available. Polls phoneVerification.status while waiting.
 */
export default function VerifyPhone() {
  const { t } = useTranslation();
  const router = useRouter();
  const appConfig = useQuery(refs.appConfig, isAuthConfigured ? {} : "skip");
  const me = useQuery(refs.me, isAuthConfigured ? {} : "skip");
  const start = useMutation(refs.pvStart);
  const startInPerson = useMutation(refs.pvStartInPerson);
  const acceptMismatch = useMutation(refs.pvAcceptMismatch);
  const [verificationId, setVerificationId] = useState<Id<"phoneVerifications"> | null>(null);
  const [inPersonCode, setInPersonCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const status = useQuery(
    refs.pvStatus,
    isAuthConfigured && verificationId ? { verificationId } : "skip",
  );

  useEffect(() => {
    if (me?.phoneVerified) router.replace("/(app)/home");
  }, [me?.phoneVerified, router]);

  useEffect(() => {
    if (status?.status === "verified") router.replace("/(app)/home");
  }, [status?.status, router]);

  const begin = (method: "telegram" | "whatsapp") => {
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const result = await start({ method });
        setVerificationId(result.verificationId);
        if (result.deepLink) await Linking.openURL(result.deepLink);
      } catch (e) {
        setError(errorText(t, e));
      } finally {
        setBusy(false);
      }
    })();
  };

  const beginInPerson = () => {
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const result = await startInPerson({});
        setInPersonCode(result.code);
        setVerificationId(result.verificationId);
      } catch (e) {
        setError(errorText(t, e));
      } finally {
        setBusy(false);
      }
    })();
  };

  const verification = appConfig?.verification;

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("verify.title")}
      </Text>
      <Text style={styles.body}>{t("verify.body")}</Text>
      {error ? <Banner kind="error" icon="⚠" text={error} /> : null}

      {status?.status === "mismatch" ? (
        <View style={styles.card}>
          <Text style={styles.cardText}>{t("verify.mismatch")}</Text>
          <Button
            label={t("verify.useVerified")}
            onPress={() => {
              if (!verificationId) return;
              void acceptMismatch({ verificationId }).catch((e: unknown) =>
                setError(errorText(t, e)),
              );
            }}
          />
        </View>
      ) : null}
      {status?.status === "expired" ? (
        <Banner kind="warning" icon="⏰" text={t("verify.expired")} />
      ) : null}
      {verificationId && status?.status === "pending" ? (
        <Banner kind="info" icon="⏳" text={t("verify.waiting")} />
      ) : null}

      {verification?.telegram ? (
        <View style={styles.card}>
          <Button
            label={t("verify.telegram")}
            loading={busy}
            onPress={() => begin("telegram")}
          />
          <Text style={styles.cardText}>{t("verify.telegramSteps")}</Text>
        </View>
      ) : null}

      {verification?.whatsapp ? (
        <View style={styles.card}>
          <Button
            label={t("verify.whatsapp")}
            variant="secondary"
            loading={busy}
            onPress={() => begin("whatsapp")}
          />
          <Text style={styles.cardText}>{t("verify.whatsappSteps")}</Text>
        </View>
      ) : null}

      {verification?.inPerson ? (
        <View style={styles.card}>
          <Button label={t("verify.inPerson")} variant="secondary" loading={busy} onPress={beginInPerson} />
          {inPersonCode ? (
            <>
              <Text style={styles.code}>{t("verify.inPersonCode", { code: inPersonCode })}</Text>
              <Text style={styles.cardText}>{t("verify.inPersonSteps")}</Text>
              <Text style={styles.cardText}>{t("verify.inPersonNotice")}</Text>
            </>
          ) : null}
        </View>
      ) : null}

      <Button
        label={t("verify.later")}
        variant="ghost"
        onPress={() => router.replace("/(app)/home")}
      />
      <Text style={styles.help}>{t("verify.laterNote")}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  help: { ...typography.small, color: colors.text.muted },
  card: {
    backgroundColor: colors.bg.surface,
    borderRadius: 12,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardText: { ...typography.body, color: colors.text.primary },
  code: { ...typography.heading, color: colors.brand.primary },
});
