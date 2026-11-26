import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Linking, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Banner, Button } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { errorText } from "@/lib/errors";

type WhoRow = {
  requestDate: number;
  hospitalName: string;
  viewerFirstName: string;
  viewerRole: string;
  until: number;
};

/**
 * SCR-M07 — Privacy & data (F-603, D07): who has my number (first names
 * + roles only), download my data (own data only, 24 h link), and
 * delete my account (type DELETE / মুছুন; executed by the daily
 * retention job within S-27 days, cancellable until then).
 */
export default function MyData() {
  const { t } = useTranslation();
  const me = useQuery(refs.me, isAuthConfigured ? {} : "skip");
  const who = useQuery(refs.whoHasMyNumber, isAuthConfigured ? {} : "skip") as
    | WhoRow[]
    | undefined;
  const exportMyData = useMutation(refs.exportMyData);
  const requestDeletion = useMutation(refs.requestDeletion);
  const cancelDeletion = useMutation(refs.cancelDeletion);
  const [confirmWord, setConfirmWord] = useState("");
  const [deleteBy, setDeleteBy] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    void fn().catch((e) => setError(errorText(t, e)));
  };
  const deletionPending = me?.status === "deletion_pending";

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("myData.who")}
      </Text>
      {error ? <Banner kind="error" icon="⚠" text={error} /> : null}
      {who && who.length === 0 ? (
        <Text style={styles.body}>{t("myData.whoEmpty")}</Text>
      ) : null}
      {(who ?? []).map((entry, i) => (
        <View key={i} style={styles.card}>
          <Text style={styles.bodyStrong}>
            {entry.viewerFirstName} • {entry.viewerRole}
          </Text>
          <Text style={styles.help}>
            {entry.hospitalName} • {new Date(entry.requestDate).toLocaleDateString()}
          </Text>
        </View>
      ))}

      <View style={styles.card}>
        <Button
          label={t("myData.download")}
          onPress={() =>
            run(async () => {
              const out = await exportMyData({});
              if (out.url) await Linking.openURL(out.url);
            })
          }
        />
      </View>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.heading}>
          {t("myData.delete")}
        </Text>
        <Text style={styles.body}>{t("myData.deleteBody")}</Text>
        {deletionPending || deleteBy ? (
          <>
            <Banner
              kind="info"
              icon="ℹ"
              text={
                deleteBy
                  ? t("accountStatus.deletion_pending.body", {
                      date: new Date(deleteBy).toLocaleDateString(),
                    })
                  : t("myData.deleteBody")
              }
            />
            <Button
              label={t("common.cancel")}
              variant="secondary"
              onPress={() =>
                run(async () => {
                  await cancelDeletion({});
                  setDeleteBy(null);
                })
              }
            />
          </>
        ) : (
          <>
            <Text style={styles.label}>{t("myData.typeToConfirm")}</Text>
            <TextInput
              style={styles.input}
              value={confirmWord}
              onChangeText={setConfirmWord}
              accessibilityLabel={t("myData.typeToConfirm")}
              autoCapitalize="characters"
            />
            <Button
              label={t("myData.delete")}
              disabled={confirmWord !== "DELETE" && confirmWord !== "মুছুন"}
              onPress={() =>
                run(async () => {
                  const out = await requestDeletion({ confirmWord });
                  setDeleteBy(out.deleteBy);
                })
              }
            />
          </>
        )}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  heading: { ...typography.heading, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  bodyStrong: { ...typography.bodyStrong, color: colors.text.primary },
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
