import React, { useEffect, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Banner, Button } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { errorText } from "@/lib/errors";

const DATE_PLACEHOLDER = "YYYY-MM-DD";
const PHONE_PLACEHOLDER = "01XXXXXXXXX";
/** F-708: a campaign code from a QR/link is kept locally so it
 *  survives the sign-in round trip and is still attributed when the
 *  profile is completed (the server validates it either way). */
const CAMPAIGN_KEY = "udvasito.campaignCode";

/**
 * SCR-O03 — Onboarding (F-103): name, date of birth (18+ gate), mobile
 * number. Campaign code arrives as ?c= (link attribution, stored only when
 * it matches an active campaign — server-side).
 */
export default function Onboarding() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const params = useLocalSearchParams<{ c?: string }>();
  const appConfig = useQuery(refs.appConfig, isAuthConfigured ? {} : "skip");
  const complete = useMutation(refs.completeOnboarding);
  const [name, setName] = useState("");
  const [dob, setDob] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [underage, setUnderage] = useState(false);

  useEffect(() => {
    if (typeof params.c === "string" && params.c) {
      void AsyncStorage.setItem(CAMPAIGN_KEY, params.c);
    }
  }, [params.c]);

  const submit = () => {
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const storedCampaign =
          typeof params.c === "string" && params.c
            ? params.c
            : ((await AsyncStorage.getItem(CAMPAIGN_KEY)) ?? undefined);
        const result = await complete({
          name: name.trim(),
          dateOfBirth: dob.trim(),
          phone: phone.trim(),
          language: i18n.language === "bn" ? "bn" : "en",
          consentVersion: appConfig?.consentVersion ?? "2026-11-28-pilot",
          consentAcceptedAt: Date.now(),
          campaignCode: storedCampaign,
        });
        if (result.result === "underage") {
          setUnderage(true);
          return;
        }
        void AsyncStorage.removeItem(CAMPAIGN_KEY);
        router.replace("/(onboarding)/verify-phone");
      } catch (e) {
        setError(errorText(t, e));
      } finally {
        setBusy(false);
      }
    })();
  };

  if (underage) {
    return (
      <View style={styles.wrap}>
        <Text accessibilityRole="header" style={styles.title}>
          {t("onboarding.title")}
        </Text>
        <Banner kind="error" icon="⚠" text={t("onboarding.underage")} />
        <Button
          label={t("common.back")}
          variant="secondary"
          onPress={() => router.replace("/(onboarding)/welcome")}
        />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("onboarding.title")}
      </Text>
      <Text style={styles.body}>{t("onboarding.body")}</Text>
      {error ? <Banner kind="error" icon="⚠" text={error} /> : null}
      <Text style={styles.label}>{t("onboarding.name")}</Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        accessibilityLabel={t("onboarding.name")}
        autoComplete="name"
      />
      <Text style={styles.label}>{t("onboarding.dob")}</Text>
      <TextInput
        style={styles.input}
        value={dob}
        onChangeText={setDob}
        placeholder={DATE_PLACEHOLDER}
        accessibilityLabel={t("onboarding.dob")}
        accessibilityHint={t("onboarding.dobHelp")}
        keyboardType="numbers-and-punctuation"
      />
      <Text style={styles.help}>{t("onboarding.dobHelp")}</Text>
      <Text style={styles.label}>{t("onboarding.phone")}</Text>
      <TextInput
        style={styles.input}
        value={phone}
        onChangeText={setPhone}
        placeholder={PHONE_PLACEHOLDER}
        accessibilityLabel={t("onboarding.phone")}
        accessibilityHint={t("onboarding.phoneHelp")}
        keyboardType="phone-pad"
        autoComplete="tel"
      />
      <Text style={styles.help}>{t("onboarding.phoneHelp")}</Text>
      <Button
        label={t("common.continue")}
        loading={busy}
        disabled={!name.trim() || !dob.trim() || !phone.trim()}
        onPress={submit}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  label: { ...typography.bodyStrong, color: colors.text.primary, marginTop: spacing.sm },
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
});
