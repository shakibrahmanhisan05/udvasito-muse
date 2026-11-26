import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { ChipRow, ErrorState } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";

/**
 * SCR-D05 — Alert & privacy settings (specs §3.3). Core controls
 * (platelets, call mode, volunteer-call opt-in, hide profile, last
 * donation) save immediately via donors.updateSettings. The F-308
 * alert-limit controls (daily cap, quiet hours + urgent override,
 * verified-only, travel range) render only while
 * `features.alertLimits` is on — the server refuses them otherwise.
 * Gender/area editing stays in the donor-setup flow: the gender picker
 * labels are still unkeyed in specs (the P1 gap), so everyone keeps
 * the conservative interval until member 3 keys them.
 */

function ToggleRow(props: {
  label: string;
  value: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: props.value }}
      accessibilityLabel={props.label}
      onPress={() => props.onChange(!props.value)}
      style={styles.toggleRow}
    >
      <Text style={styles.body}>{props.label}</Text>
      <View style={[styles.pill, props.value ? styles.pillOn : styles.pillOff]}>
        <View style={[styles.knob, props.value ? styles.knobOn : styles.knobOff]} />
      </View>
    </Pressable>
  );
}

const RARE_GROUPS = ["O-", "A-", "B-", "AB-"];
const DATE_PLACEHOLDER = "YYYY-MM-DD";
/** F-307 opt-in label — unkeyed in specs §4 (P7 gap list); wording from US-D02. */
const EMAIL_COPY_LABEL = "Email me a copy of alerts";

export default function DonorSettings() {
  const { t } = useTranslation();
  const appConfig = useQuery(refs.appConfig, isAuthConfigured ? {} : "skip");
  const mine = useQuery(refs.donorsGetMine, isAuthConfigured ? {} : "skip");
  const update = useMutation(refs.donorsUpdateSettings);
  const [error, setError] = useState<string | null>(null);
  const [lastDate, setLastDate] = useState<string | null>(null);
  const [quietStart, setQuietStart] = useState<string | null>(null);
  const [quietEnd, setQuietEnd] = useState<string | null>(null);

  const donor = mine?.donor ?? null;
  const limitsOn = appConfig?.features?.alertLimits === true;

  const save = async (patch: Record<string, unknown>) => {
    setError(null);
    try {
      await update(patch as never);
    } catch {
      setError(t("errors.generic"));
    }
  };

  if (!isAuthConfigured || mine === undefined) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>{t("donorSettings.title")}</Text>
      </View>
    );
  }
  if (!donor) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.title}>{t("donorSettings.title")}</Text>
        <ErrorState message={t("errors.generic")} />
      </View>
    );
  }

  const cap = donor.alertCapPerDay ?? 3;

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("donorSettings.title")}
      </Text>
      {error ? <ErrorState message={error} /> : null}

      <View style={styles.card}>
        <ToggleRow
          label={t("donor.setup.platelets")}
          value={donor.plateletOptIn === true}
          onChange={(next) => void save({ plateletOptIn: next })}
        />
        <ToggleRow
          label={t("donor.setup.callMode")}
          value={donor.callMode === "donor_calls"}
          onChange={(next) => void save({ callMode: next ? "donor_calls" : "mutual" })}
        />
        <ToggleRow
          label={t("donorSettings.volunteersMayCall")}
          value={donor.volunteersMayCall === true}
          onChange={(next) => void save({ volunteersMayCall: next })}
        />
        {appConfig?.features?.emailAlerts === true ? (
          <ToggleRow
            label={EMAIL_COPY_LABEL}
            value={donor.emailCopyOptIn === true}
            onChange={(next) => void save({ emailCopyOptIn: next })}
          />
        ) : null}
        <ToggleRow
          label={t("donorSettings.hide")}
          value={donor.hidden === true}
          onChange={(next) => void save({ hidden: next })}
        />
        {donor.hidden === true ? <Text style={styles.help}>{t("donorSettings.hideConfirm")}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text style={styles.label}>{t("donor.setup.historyTitle")}</Text>
        <TextInput
          style={styles.input}
          value={lastDate ?? donor.lastDonationDate ?? ""}
          onChangeText={setLastDate}
          onBlur={() => {
            const value = (lastDate ?? "").trim();
            if (/^\d{4}-\d{2}-\d{2}$/.test(value) && value !== donor.lastDonationDate) {
              void save({ lastDonationDate: value });
            }
          }}
          placeholder={DATE_PLACEHOLDER}
          accessibilityLabel={t("donor.setup.historyTitle")}
        />
        <ChipRow
          accessibilityLabel={t("donor.setup.historyTitle")}
          options={[
            { value: "whole_blood", label: t("blood.wholeBlood") },
            { value: "platelets", label: t("blood.platelets") },
          ]}
          value={donor.lastDonationType === "platelets" ? "platelets" : "whole_blood"}
          onChange={(v) => void save({ lastDonationType: v })}
        />
      </View>

      {limitsOn ? (
        <View style={styles.card}>
          <Text style={styles.label}>{t("donorSettings.maxAlerts")}</Text>
          <ChipRow
            accessibilityLabel={t("donorSettings.maxAlerts")}
            options={[1, 2, 3, 5, 10].map((n) => ({ value: String(n), label: String(n) }))}
            value={String(cap)}
            onChange={(v) => void save({ alertCapPerDay: Number(v) })}
          />
          <Text style={styles.label}>{t("donorSettings.quietHours")}</Text>
          <View style={styles.row}>
            <TextInput
              style={[styles.input, styles.timeInput]}
              value={quietStart ?? donor.quietStart}
              onChangeText={setQuietStart}
              onBlur={() => {
                const value = (quietStart ?? "").trim();
                if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value) && value !== donor.quietStart) {
                  void save({ quietStart: value });
                }
              }}
              accessibilityLabel={t("donorSettings.quietHours")}
            />
            <TextInput
              style={[styles.input, styles.timeInput]}
              value={quietEnd ?? donor.quietEnd}
              onChangeText={setQuietEnd}
              onBlur={() => {
                const value = (quietEnd ?? "").trim();
                if (/^([01]\d|2[0-3]):[0-5]\d$/.test(value) && value !== donor.quietEnd) {
                  void save({ quietEnd: value });
                }
              }}
              accessibilityLabel={t("donorSettings.quietHours")}
            />
          </View>
          <ToggleRow
            label={t("donorSettings.urgentOverride")}
            value={donor.urgentOverride !== false}
            onChange={(next) => void save({ urgentOverride: next })}
          />
          <ToggleRow
            label={t("donorSettings.verifiedOnly")}
            value={donor.verifiedRequestsOnly === true}
            onChange={(next) => void save({ verifiedRequestsOnly: next })}
          />
          <Text style={styles.label}>{t("donor.setup.travel")}</Text>
          <ChipRow
            accessibilityLabel={t("donor.setup.travel")}
            options={[
              { value: "thana", label: t("donor.setup.travelThana") },
              { value: "district", label: t("donor.setup.travelDistrict") },
            ]}
            value={donor.travelRange}
            onChange={(v) => void save({ travelRange: v })}
          />
          {RARE_GROUPS.includes(donor.bloodGroup as string) ? (
            <Text style={styles.help}>{t("donorSettings.rareTip")}</Text>
          ) : null}
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary, flex: 1 },
  help: { ...typography.small, color: colors.text.muted },
  label: { ...typography.body, color: colors.text.primary, fontWeight: "600" },
  card: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.border.subtle,
    padding: spacing.md,
    gap: spacing.md,
  },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: 48 },
  pill: { width: 52, height: 30, borderRadius: 15, justifyContent: "center", paddingHorizontal: 3 },
  pillOn: { backgroundColor: colors.brand.primary },
  pillOff: { backgroundColor: colors.border.subtle },
  knob: { width: 24, height: 24, borderRadius: 12, backgroundColor: colors.bg.surface },
  knobOn: { alignSelf: "flex-end" },
  knobOff: { alignSelf: "flex-start" },
  row: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  input: {
    borderWidth: 1,
    borderColor: colors.border.input,
    borderRadius: radius.input,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    color: colors.text.primary,
    backgroundColor: colors.bg.surface,
  },
  timeInput: { flex: 1 },
});
