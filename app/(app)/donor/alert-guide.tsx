import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useMutation } from "convex/react";
import { Banner, Button } from "@/components";
import { colors, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { errorText } from "@/lib/errors";

/**
 * SCR-D07 — Alert-reliability guide (F-304, D02). Only copy that is
 * keyed in the specs ships here: the notifications step, the battery
 * step, the iPhone Home Screen note (Web Push needs iOS 16.4+ and an
 * installed PWA) and the test alert (push.sendTest, NTF-18).
 * Brand-by-brand steps (Samsung/Xiaomi/…) are member 3's DEP-08 —
 * unkeyed, so they are NOT invented here; they join this screen when
 * the keyed copy lands.
 */
export default function AlertGuide() {
  const { t } = useTranslation();
  const sendTest = useMutation(refs.pushSendTest);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onTest() {
    setBusy(true);
    setError(null);
    try {
      await sendTest({});
      setSent(true);
    } catch (e) {
      setError(errorText(t, e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("alertGuide.title")}
      </Text>
      <View style={styles.card}>
        <Text style={styles.body}>{t("alertGuide.notifications")}</Text>
        <Text style={styles.body}>{t("alertGuide.battery")}</Text>
        <Text style={styles.body}>{t("alertGuide.ios")}</Text>
      </View>
      {sent ? <Banner kind="success" icon="✓" text={t("alertGuide.testSent")} /> : null}
      {error ? <Banner kind="error" icon="⚠" text={error} /> : null}
      <Button
        label={t("alertGuide.test")}
        onPress={() => void onTest()}
        disabled={!isAuthConfigured || busy}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  card: {
    backgroundColor: colors.bg.surface,
    borderRadius: 12,
    padding: spacing.lg,
    gap: spacing.md,
  },
});
