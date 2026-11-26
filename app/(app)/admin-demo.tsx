import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Switch, Text, TextInput, View } from "react-native";
import { useAction, useMutation, useQuery } from "convex/react";
import { Banner, Button } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { errorText } from "@/lib/errors";
import type { Id } from "@/convex/_generated/dataModel";

type DemoStatus = {
  enabled: boolean;
  accounts: {
    profileId: Id<"profiles">;
    practiceId: string;
    name: string;
    role: string;
    donorGroup: string | null;
    phoneStatus: "verified" | "not_signed_in" | "not_verified";
    lastActiveAt: number;
  }[];
  hospital: { hospitalId: Id<"hospitals">; nameEn: string; nameBn: string } | null;
  funnel: {
    published: number;
    donorsNotified: number;
    alertOpened: number;
    donorAccepted: number;
    contactShared: number;
    confirmedByDonor: number;
  };
};

const ROLES = ["member", "volunteer", "admin"] as const;
// Specs §3.6 (SCR-A09) prose action labels without i18n keys
// (I18N-GAPS §4), pending member 3's key review.
const CREATE_LABEL = "Create";
const NEW_PIN_LABEL = "New PIN";
const REMOVE_LABEL = "Remove";
const RESET_LABEL = "Reset practice data";
const GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"] as const;

/**
 * SCR-A09 — Practice area controls (F-912, D-R4): on/off switch,
 * practice accounts (Create shows the Practice ID + PIN exactly
 * once — keyed admin.practicePinOnce), practice hospital, one-click
 * reset of practice data only, and the practice funnel, labelled
 * with the keyed admin.demoNote so it is never confused with real
 * numbers. The action labels Create / New PIN / Remove / Reset are
 * specs §3.6 prose without i18n keys (I18N-GAPS §4) and render
 * verbatim from specs, like the SCR-A03 decision labels.
 */
export default function AdminDemo() {
  const { t } = useTranslation();
  const status = useQuery(refs.demoStatus, isAuthConfigured ? {} : "skip") as
    | DemoStatus
    | undefined;
  const setEnabled = useMutation(refs.demoSetEnabled);
  const reset = useMutation(refs.demoReset);
  const createAccount = useAction(refs.demoCreateAccount);
  const newPin = useAction(refs.demoNewPin);
  const removeAccount = useAction(refs.demoRemoveAccount);
  const [name, setName] = useState("");
  const [role, setRole] = useState<(typeof ROLES)[number]>("member");
  const [donorGroup, setDonorGroup] = useState<string | null>(null);
  const [issued, setIssued] = useState<{ practiceId: string; pin: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const me = useQuery(refs.me, isAuthConfigured ? {} : "skip");
  const isSuperadmin = me?.role === "superadmin";

  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    setDone(false);
    void fn()
      .then(() => setDone(true))
      .catch((e) => setError(errorText(t, e)));
  };

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("admin.demo")}
      </Text>
      <Text style={styles.body}>{t("admin.demoNote")}</Text>
      {error ? <Banner kind="error" icon="⚠" text={error} /> : null}
      {done ? <Banner kind="success" icon="✓" text={t("common.done")} /> : null}
      {status ? (
        <View style={styles.card}>
          <View style={styles.rowBetween}>
            <Text style={styles.bodyStrong}>{t("admin.demo")}</Text>
            <Switch
              value={status.enabled}
              onValueChange={(enabled) => run(() => setEnabled({ enabled }))}
              accessibilityLabel={t("admin.demo")}
            />
          </View>
          {status.hospital ? (
            <Text style={styles.body}>
              {status.hospital.nameEn} • {status.hospital.nameBn}
            </Text>
          ) : null}
        </View>
      ) : null}

      {issued ? (
        <View style={styles.card}>
          <Text style={styles.bigNumber}>
            {issued.practiceId} • {issued.pin}
          </Text>
          <Text style={styles.body}>{t("admin.practicePinOnce")}</Text>
          <Button label={t("common.done")} onPress={() => setIssued(null)} />
        </View>
      ) : null}

      {isSuperadmin ? (
        <View style={styles.card}>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
          />
          <View style={styles.row}>
            {ROLES.map((r) => (
              <Button
                key={r}
                label={r}
                variant={role === r ? "primary" : "secondary"}
                onPress={() => setRole(r)}
              />
            ))}
          </View>
          <View style={styles.row}>
            {GROUPS.map((g) => (
              <Button
                key={g}
                label={g}
                variant={donorGroup === g ? "primary" : "secondary"}
                onPress={() => setDonorGroup(donorGroup === g ? null : g)}
              />
            ))}
          </View>
          <Button
            label={CREATE_LABEL}
            disabled={name.trim().length < 2}
            onPress={() => {
              setError(null);
              void createAccount({
                name: name.trim(),
                role,
                donorGroup: donorGroup ?? undefined,
              })
                .then((result) => {
                  setIssued(result as { practiceId: string; pin: string });
                  setName("");
                })
                .catch((e) => setError(errorText(t, e)));
            }}
          />
        </View>
      ) : null}

      {(status?.accounts ?? []).map((account) => (
        <View key={account.profileId} style={styles.card}>
          <Text style={styles.bodyStrong}>
            {account.practiceId} • {account.name}
          </Text>
          <Text style={styles.help}>
            {account.role}
            {account.donorGroup ? ` • ${account.donorGroup}` : ""} • {account.phoneStatus} •{" "}
            {new Date(account.lastActiveAt).toLocaleString()}
          </Text>
          {isSuperadmin ? (
            <View style={styles.row}>
              <Button
                label={NEW_PIN_LABEL}
                variant="secondary"
                onPress={() => {
                  setError(null);
                  void newPin({ profileId: account.profileId })
                    .then((result) => setIssued(result as { practiceId: string; pin: string }))
                    .catch((e) => setError(errorText(t, e)));
                }}
              />
              <Button
                label={REMOVE_LABEL}
                variant="danger"
                onPress={() => run(() => removeAccount({ profileId: account.profileId }))}
              />
            </View>
          ) : null}
        </View>
      ))}

      {status ? (
        <View style={styles.card}>
          <Text style={styles.heading}>{t("admin.funnel")}</Text>
          <Text style={styles.body}>
            {status.funnel.published} • {status.funnel.donorsNotified} •{" "}
            {status.funnel.alertOpened} • {status.funnel.donorAccepted} •{" "}
            {status.funnel.contactShared} • {status.funnel.confirmedByDonor}
          </Text>
          <Button
            label={RESET_LABEL}
            variant="danger"
            onPress={() => {
              if (!confirmReset) {
                setConfirmReset(true);
                return;
              }
              setConfirmReset(false);
              run(() => reset({}));
            }}
          />
          {confirmReset ? (
            <Button label={t("common.cancel")} variant="ghost" onPress={() => setConfirmReset(false)} />
          ) : null}
        </View>
      ) : null}
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
  bigNumber: { ...typography.title, color: colors.text.primary },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  rowBetween: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
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
