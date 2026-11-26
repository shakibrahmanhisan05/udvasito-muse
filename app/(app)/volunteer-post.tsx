import React, { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Banner, Button, ChipRow, FieldLabel, PlacePickers, useToast, type PlaceSelection,
} from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { errorText } from "@/lib/errors";
import { parseIntake, type IntakeFields } from "@/convex/rules/intakeParser";
import { extractContactPhone } from "@/convex/rules/redaction";
import type { Id } from "@/convex/_generated/dataModel";

const GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const PHONE_PLACEHOLDER = "01XXXXXXXXX";
const MINUS = "\u2212";
const PLUS = "+";

function dhakaEndOfToday(): number {
  const dhakaDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
  return Date.parse(`${dhakaDate}T23:59:00+06:00`);
}

/**
 * SCR-V05 — Post for a family (F-211, if-time; behind
 * features.volunteerPost, volunteers only). Same intake + redaction
 * as SCR-M02: paste a public post, the rules parser (on-device
 * first, server action for gaps) fills the form, the contact number
 * comes from the post and stays editable (VAL-03). The request is
 * created with source "volunteer_paste" and an unverified contact;
 * the family can claim it later with that verified number.
 */
export default function VolunteerPost() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bn" ? "bn" : "en";
  const router = useRouter();
  const toast = useToast();
  const appConfig = useQuery(refs.appConfig, isAuthConfigured ? {} : "skip");
  const me = useQuery(refs.me, isAuthConfigured ? {} : "skip");
  const create = useMutation(refs.requestsCreate);
  const parseAction = useAction(refs.intakeParse);
  const refData = useQuery(refs.intakeRefData, isAuthConfigured ? {} : "skip");

  const [paste, setPaste] = useState("");
  const [filling, setFilling] = useState(false);
  const [aiAssisted, setAiAssisted] = useState(false);
  const [group, setGroup] = useState<string | null>(null);
  const [component, setComponent] = useState<"whole_blood" | "platelets">("whole_blood");
  const [isDengue, setIsDengue] = useState(false);
  const [units, setUnits] = useState(1);
  const [hospitalText, setHospitalText] = useState("");
  const [hospitalId, setHospitalId] = useState<Id<"hospitals"> | null>(null);
  const [notInList, setNotInList] = useState(false);
  const [place, setPlace] = useState<PlaceSelection>({ divisionId: null, districtId: null, upazilaId: null });
  const [placeText, setPlaceText] = useState("");
  const [when, setWhen] = useState<"now" | "today" | "tomorrow">("today");
  const [contactPhone, setContactPhone] = useState("");
  const [patientName, setPatientName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientIdRef = useRef<string | null>(null);
  const clientId = () => {
    clientIdRef.current ??= `vpost-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return clientIdRef.current;
  };

  const enabled = appConfig?.features?.volunteerPost === true;
  const isVolunteer =
    me?.role === "volunteer" || me?.role === "admin" || me?.role === "superadmin";

  const searchResults = useQuery(
    refs.hospitalsSearch,
    isAuthConfigured && !hospitalId && hospitalText.trim().length >= 2
      ? { text: hospitalText.trim() }
      : "skip",
  ) as { _id: Id<"hospitals">; nameEn: string }[] | undefined;

  const applyFields = (fields: Partial<IntakeFields> & { neededBy?: number | null }) => {
    if (fields.bloodGroup) setGroup(fields.bloodGroup);
    if (fields.component) setComponent(fields.component);
    if (fields.isDengue != null) setIsDengue(Boolean(fields.isDengue));
    if (fields.units) setUnits(fields.units);
    if (fields.hospitalId) {
      const h = refData?.hospitals.find((x: { _id: string }) => x._id === fields.hospitalId);
      if (h) {
        setHospitalId(h._id as Id<"hospitals">);
        setHospitalText(lang === "bn" ? h.nameBn : h.nameEn);
        setNotInList(false);
      }
    }
  };

  const fill = () => {
    const text = paste.trim();
    if (text.length < 5) return;
    setFilling(true);
    const phone = extractContactPhone(text);
    if (phone) setContactPhone(phone);
    const local = refData ? parseIntake(text, lang, refData).fields : null;
    if (local?.bloodGroup && local?.units && local?.hospitalId) {
      applyFields(local);
      setFilling(false);
      return;
    }
    void (async () => {
      try {
        const res = (await parseAction({ text, source: "paste", lang, clientId: clientId() })) as {
          fields: Partial<IntakeFields> & { neededBy?: number | null };
          aiUsed: boolean;
          extractedPhone?: string;
        };
        applyFields(res.fields);
        if (res.extractedPhone) setContactPhone(res.extractedPhone);
        if (res.aiUsed) setAiAssisted(true);
      } catch {
        if (local) applyFields(local);
      } finally {
        setFilling(false);
      }
    })();
  };

  const neededBy = (): number => {
    switch (when) {
      case "now":
        return Date.now() + 30 * 60_000;
      case "tomorrow":
        return dhakaEndOfToday() + 24 * 3_600_000;
      default:
        return dhakaEndOfToday();
    }
  };

  const canSubmit = Boolean(
    group &&
      (hospitalId !== null ||
        (notInList && place.divisionId && place.districtId && place.upazilaId && placeText.trim().length >= 3)) &&
      contactPhone.trim().length >= 11,
  );

  const submit = () => {
    if (!group || !canSubmit) return;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        const result = await create({
          clientId: clientId(),
          bloodGroup: group as never,
          component,
          isDengue,
          unitsNeeded: units,
          hospitalId: hospitalId ?? undefined,
          divisionId: place.divisionId ?? undefined,
          districtId: place.districtId ?? undefined,
          upazilaId: place.upazilaId ?? undefined,
          placeText: notInList ? placeText.trim() : undefined,
          neededBy: neededBy(),
          contactPhone: contactPhone.trim(),
          patientName: patientName.trim() || undefined,
          source: "volunteer_paste",
          aiAssisted,
          lang,
        });
        if (result.existing) toast.show(t("request.duplicate"));
        router.replace({ pathname: "/(app)/request-live", params: { id: result.requestId } });
      } catch (e) {
        setError(errorText(t, e));
      } finally {
        setBusy(false);
      }
    })();
  };

  const componentOptions = useMemo(
    () => [
      { value: "whole_blood", label: t("blood.wholeBlood") },
      { value: "platelets", label: t("blood.platelets") },
    ],
    [t],
  );

  if (!enabled || !isVolunteer) return null; // off or not a volunteer → inert

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("volunteerPost.label")}
      </Text>
      <Banner kind="info" icon="ℹ" text={t("volunteerPost.sourceNote")} />
      {error ? <Banner kind="error" icon="⚠" text={error} /> : null}

      <FieldLabel>{t("request.writeLabel")}</FieldLabel>
      <TextInput
        style={[styles.input, styles.textarea]}
        value={paste}
        onChangeText={setPaste}
        multiline
        placeholder={t("request.writePlaceholder")}
        accessibilityLabel={t("request.writeLabel")}
      />
      <Button label={t("request.fillForm")} variant="secondary" onPress={fill} loading={filling} />

      <FieldLabel>{t("request.bloodGroup")}</FieldLabel>
      <ChipRow options={GROUPS.map((g) => ({ value: g, label: g }))} value={group} onChange={setGroup} accessibilityLabel={t("request.bloodGroup")} />
      <FieldLabel>{t("request.whatNeeded")}</FieldLabel>
      <ChipRow
        accessibilityLabel={t("request.whatNeeded")}
        options={componentOptions}
        value={component}
        onChange={(v) => setComponent(v as "whole_blood" | "platelets")}
      />
      <View style={styles.checkRow}>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: isDengue }}
          onPress={() => {
            setIsDengue((v) => !v);
            if (!isDengue) setComponent("platelets");
          }}
          style={[styles.checkbox, isDengue && styles.checkboxChecked]}
        >
          {isDengue ? <Text style={styles.checkmark}>✓</Text> : null}
        </Pressable>
        <Text style={styles.body}>{t("request.dengue")}</Text>
      </View>

      <FieldLabel>{t("request.units")}</FieldLabel>
      <View style={styles.stepper}>
        <Button label={MINUS} variant="secondary" onPress={() => setUnits((u) => Math.max(1, u - 1))} />
        <Text style={styles.unitsText}>{units}</Text>
        <Button label={PLUS} variant="secondary" onPress={() => setUnits((u) => Math.min(10, u + 1))} />
      </View>

      {!notInList ? (
        <>
          <FieldLabel>{t("request.where")}</FieldLabel>
          <TextInput
            style={styles.input}
            value={hospitalText}
            onChangeText={(v) => {
              setHospitalText(v);
              setHospitalId(null);
            }}
            placeholder={t("request.searchHospital")}
            accessibilityLabel={t("request.searchHospital")}
          />
          {(searchResults ?? []).map((h) => (
            <Pressable
              key={h._id}
              accessibilityRole="button"
              onPress={() => {
                setHospitalId(h._id);
                setHospitalText(h.nameEn);
              }}
              style={styles.resultRow}
            >
              <Text style={styles.body}>{h.nameEn}</Text>
            </Pressable>
          ))}
          <Button label={t("request.notInList")} variant="ghost" onPress={() => setNotInList(true)} />
        </>
      ) : (
        <>
          <PlacePickers value={place} onChange={setPlace} />
          <TextInput
            style={styles.input}
            value={placeText}
            onChangeText={setPlaceText}
            placeholder={t("request.where")}
            accessibilityLabel={t("request.where")}
          />
        </>
      )}

      <FieldLabel>{t("request.when")}</FieldLabel>
      <ChipRow
        accessibilityLabel={t("request.when")}
        options={[
          { value: "now", label: t("urgency.now") },
          { value: "today", label: t("urgency.today") },
          { value: "tomorrow", label: t("urgency.tomorrow") },
        ]}
        value={when}
        onChange={(v) => setWhen(v as "now" | "today" | "tomorrow")}
      />

      <FieldLabel>{t("request.contact")}</FieldLabel>
      <TextInput
        style={styles.input}
        value={contactPhone}
        onChangeText={setContactPhone}
        placeholder={PHONE_PLACEHOLDER}
        keyboardType="phone-pad"
        accessibilityLabel={t("request.contact")}
      />
      <FieldLabel>{t("request.patientName")}</FieldLabel>
      <TextInput
        style={styles.input}
        value={patientName}
        onChangeText={setPatientName}
        accessibilityLabel={t("request.patientName")}
      />

      <Button label={t("request.post")} onPress={submit} loading={busy} disabled={!canSubmit} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  input: {
    ...typography.body,
    color: colors.text.primary,
    borderWidth: 1,
    borderColor: colors.border.input,
    borderRadius: radius.input,
    padding: spacing.md,
    minHeight: 52,
    backgroundColor: colors.bg.surface,
  },
  textarea: { minHeight: 96, textAlignVertical: "top" },
  stepper: { flexDirection: "row", alignItems: "center", gap: spacing.lg },
  unitsText: { ...typography.heading, color: colors.text.primary },
  checkRow: { flexDirection: "row", gap: spacing.sm, alignItems: "center", minHeight: 48 },
  checkbox: {
    width: 28,
    height: 28,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border.input,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxChecked: { backgroundColor: colors.brand.primary, borderColor: colors.brand.primary },
  checkmark: { color: "#fff", fontWeight: "700" },
  resultRow: { paddingVertical: spacing.sm },
});
