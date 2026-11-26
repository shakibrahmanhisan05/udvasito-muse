import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import {
  Banner,
  Button,
  ChipRow,
  FieldLabel,
  PlacePickers,
  type PlaceSelection,
} from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { errorText } from "@/lib/errors";

const GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const DATE_PLACEHOLDER = "YYYY-MM-DD";

function CheckRow(props: {
  checked: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: props.checked }}
      accessibilityLabel={props.label}
      onPress={props.onToggle}
      style={styles.checkRow}
    >
      <View style={[styles.checkbox, props.checked && styles.checkboxChecked]}>
        {props.checked ? <Text style={styles.checkmark}>✓</Text> : null}
      </View>
      <Text style={styles.checkLabel}>{props.label}</Text>
    </Pressable>
  );
}

/**
 * SCR-D02 — Donor setup, 4 steps (F-401…F-404): group → where/travel →
 * history (+ platelets) → health checklist, number-sharing and health-data
 * consent. Gender option labels are unkeyed in specs (I18N-GAPS, DEP-08),
 * so P1 stores gender as "unspecified" — the conservative 120-day interval
 * (PRD §5.1) — and shows donor.setup.genderWhy; the picker ships with the
 * team's keys.
 */
export default function DonorSetup() {
  const { t } = useTranslation();
  const router = useRouter();
  const appConfig = useQuery(refs.appConfig, isAuthConfigured ? {} : "skip");
  const mine = useQuery(refs.donorsGetMine, isAuthConfigured ? {} : "skip");
  const upsert = useMutation(refs.donorsUpsert);
  const [step, setStep] = useState(1);
  const [group, setGroup] = useState<string | null>(null);
  const [unknownGroup, setUnknownGroup] = useState(false);
  const [place, setPlace] = useState<PlaceSelection>({
    divisionId: null,
    districtId: null,
    upazilaId: null,
  });
  const [travelRange, setTravelRange] = useState<"thana" | "district">("district");
  const [institution, setInstitution] = useState("");
  const [neverDonated, setNeverDonated] = useState(true);
  const [lastDate, setLastDate] = useState("");
  const [lastType, setLastType] = useState<"whole_blood" | "platelets">("whole_blood");
  const [platelets, setPlatelets] = useState(false);
  const [checks, setChecks] = useState({ weight: false, health: false, screening: false });
  const [donorCalls, setDonorCalls] = useState(false);
  const [healthConsent, setHealthConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (done) {
    return (
      <View style={styles.wrap}>
        <Banner kind="success" icon="✓" text={t("donor.setup.done")} />
        <Button label={t("common.done")} onPress={() => router.replace("/(app)/donor")} />
      </View>
    );
  }

  const finish = () => {
    if (!group && !unknownGroup) return;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        await upsert({
          bloodGroup: (unknownGroup ? "unknown" : group) as never,
          gender: "unspecified",
          divisionId: place.divisionId ?? undefined,
          districtId: place.districtId ?? undefined,
          upazilaId: place.upazilaId ?? undefined,
          institution: institution.trim() || undefined,
          travelRange,
          neverDonated,
          lastDonationDate: neverDonated ? undefined : lastDate.trim(),
          lastDonationType: neverDonated ? undefined : lastType,
          plateletOptIn: platelets,
          callMode: donorCalls ? "donor_calls" : "mutual",
          checklist: checks,
          healthConsentVersion: appConfig?.consentVersion ?? "2026-11-28-pilot",
        });
        setDone(true);
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
        {t("donor.setup.title")}
      </Text>
      <Text style={styles.help}>{t("donor.setup.step", { n: step })}</Text>
      {error ? <Banner kind="error" icon="⚠" text={error} /> : null}
      {mine?.donor ? <Text style={styles.help}>{t("donor.setup.title")}</Text> : null}

      {step === 1 ? (
        <>
          <FieldLabel>{t("donor.setup.groupTitle")}</FieldLabel>
          <ChipRow
            accessibilityLabel={t("donor.setup.groupTitle")}
            options={GROUPS.map((g) => ({ value: g, label: g }))}
            value={group}
            onChange={(v) => {
              setGroup(v);
              setUnknownGroup(false);
            }}
          />
          <CheckRow
            checked={unknownGroup}
            onToggle={() => {
              setUnknownGroup((v) => !v);
              setGroup(null);
            }}
            label={t("blood.notSure")}
          />
          {unknownGroup ? <Text style={styles.help}>{t("donor.setup.unknownGroup")}</Text> : null}
          <Button
            label={t("common.continue")}
            disabled={!group && !unknownGroup}
            onPress={() => setStep(2)}
          />
        </>
      ) : null}

      {step === 2 ? (
        <>
          <FieldLabel>{t("donor.setup.whereTitle")}</FieldLabel>
          <PlacePickers value={place} onChange={setPlace} />
          <FieldLabel>{t("donor.setup.travel")}</FieldLabel>
          <ChipRow
            accessibilityLabel={t("donor.setup.travel")}
            options={[
              { value: "thana", label: t("donor.setup.travelThana") },
              { value: "district", label: t("donor.setup.travelDistrict") },
            ]}
            value={travelRange}
            onChange={(v) => setTravelRange(v as "thana" | "district")}
          />
          <TextInput
            style={styles.input}
            value={institution}
            onChangeText={setInstitution}
            placeholder={t("donor.setup.institution")}
            accessibilityLabel={t("donor.setup.institution")}
          />
          <Button
            label={t("common.continue")}
            disabled={!place.divisionId || !place.districtId || !place.upazilaId}
            onPress={() => setStep(3)}
          />
          <Button label={t("common.back")} variant="ghost" onPress={() => setStep(1)} />
        </>
      ) : null}

      {step === 3 ? (
        <>
          <FieldLabel>{t("donor.setup.historyTitle")}</FieldLabel>
          <Text style={styles.help}>{t("donor.setup.genderWhy")}</Text>
          <CheckRow
            checked={neverDonated}
            onToggle={() => setNeverDonated((v) => !v)}
            label={t("donor.setup.never")}
          />
          {!neverDonated ? (
            <>
              <TextInput
                style={styles.input}
                value={lastDate}
                onChangeText={setLastDate}
                placeholder={DATE_PLACEHOLDER}
                accessibilityLabel={t("donor.setup.historyTitle")}
                keyboardType="numbers-and-punctuation"
              />
              <ChipRow
                accessibilityLabel={t("request.whatNeeded")}
                options={[
                  { value: "whole_blood", label: t("blood.wholeBlood") },
                  { value: "platelets", label: t("blood.platelets") },
                ]}
                value={lastType}
                onChange={(v) => setLastType(v as "whole_blood" | "platelets")}
              />
            </>
          ) : null}
          <CheckRow
            checked={platelets}
            onToggle={() => setPlatelets((v) => !v)}
            label={t("donor.setup.platelets")}
          />
          <Text style={styles.help}>{t("donor.setup.plateletsInfo")}</Text>
          <Button label={t("common.continue")} onPress={() => setStep(4)} />
          <Button label={t("common.back")} variant="ghost" onPress={() => setStep(2)} />
        </>
      ) : null}

      {step === 4 ? (
        <>
          <CheckRow
            checked={checks.weight}
            onToggle={() => setChecks((c) => ({ ...c, weight: !c.weight }))}
            label={t("donor.setup.check50kg")}
          />
          <CheckRow
            checked={checks.health}
            onToggle={() => setChecks((c) => ({ ...c, health: !c.health }))}
            label={t("donor.setup.checkHealth")}
          />
          <CheckRow
            checked={checks.screening}
            onToggle={() => setChecks((c) => ({ ...c, screening: !c.screening }))}
            label={t("donor.setup.checkScreening")}
          />
          <FieldLabel>{t("donor.setup.privacyTitle")}</FieldLabel>
          <Text style={styles.body}>{t("donor.setup.privacyBody")}</Text>
          <CheckRow
            checked={donorCalls}
            onToggle={() => setDonorCalls((v) => !v)}
            label={t("donor.setup.callMode")}
          />
          <CheckRow
            checked={healthConsent}
            onToggle={() => setHealthConsent((v) => !v)}
            label={t("donor.setup.consentHealth")}
          />
          <Button
            label={t("donor.setup.finish")}
            loading={busy}
            disabled={
              !checks.weight || !checks.health || !checks.screening || !healthConsent
            }
            onPress={finish}
          />
          <Button label={t("common.back")} variant="ghost" onPress={() => setStep(3)} />
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
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
  checkRow: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-start", minHeight: 48 },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border.input,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  checkboxChecked: { backgroundColor: colors.brand.primary, borderColor: colors.brand.primary },
  checkmark: { color: "#fff", fontWeight: "700" },
  checkLabel: { ...typography.body, color: colors.text.primary, flex: 1 },
});
