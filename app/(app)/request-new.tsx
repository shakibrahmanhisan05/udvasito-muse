import React, { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import {
  Banner,
  Button,
  ChipRow,
  FieldLabel,
  PlacePickers,
  useToast,
  type PlaceSelection,
} from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { errorText } from "@/lib/errors";
import { getCurrentCoordsOnce } from "@/lib/geo";
import { haversineKm } from "@/convex/rules/ranking";
import type { Id } from "@/convex/_generated/dataModel";

const GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];
const DATE_PLACEHOLDER = "YYYY-MM-DD";
const MINUS = "\u2212";
const PLUS = "+";

/** Dhaka end-of-day (UTC+6, no DST) as a timestamp. */
function dhakaEndOfToday(): number {
  const dhakaDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date());
  return Date.parse(`${dhakaDate}T23:59:00+06:00`);
}

/**
 * SCR-M02 — Request blood, form path (F-301). Voice/AI/paste paths are P2.
 * Hospital search + "use my location" nearest (haversine) + "not in the
 * list" free-text path with place pickers. Server re-validates everything.
 */
export default function RequestNew() {
  const { t } = useTranslation();
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ dengue?: string }>();
  const me = useQuery(refs.me, isAuthConfigured ? {} : "skip");
  const create = useMutation(refs.requestsCreate);

  const [group, setGroup] = useState<string | null>(null);
  const [component, setComponent] = useState<"whole_blood" | "platelets">(
    params.dengue === "1" ? "platelets" : "whole_blood",
  );
  const [isDengue, setIsDengue] = useState(params.dengue === "1");
  const [units, setUnits] = useState(1);
  const [hospitalText, setHospitalText] = useState("");
  const [hospitalId, setHospitalId] = useState<Id<"hospitals"> | null>(null);
  const [notInList, setNotInList] = useState(false);
  const [place, setPlace] = useState<PlaceSelection>({
    divisionId: null,
    districtId: null,
    upazilaId: null,
  });
  const [placeText, setPlaceText] = useState("");
  const [when, setWhen] = useState<"now" | "today" | "tomorrow" | "pick">("today");
  const [pickDate, setPickDate] = useState("");
  const [contactPhone, setContactPhone] = useState<string | null>(null);
  const [patientName, setPatientName] = useState("");
  const [ward, setWard] = useState("");
  const [note, setNote] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clientIdRef = useRef<string | null>(null);
  const clientId = () => {
    clientIdRef.current ??= `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return clientIdRef.current;
  };

  type HospitalRow = { _id: Id<"hospitals">; nameEn: string; lat: number; lng: number };
  const searchResults = useQuery(
    refs.hospitalsSearch,
    isAuthConfigured && !hospitalId && hospitalText.trim().length >= 2
      ? { text: hospitalText.trim() }
      : "skip",
  ) as HospitalRow[] | undefined;
  const allHospitals = useQuery(
    refs.hospitalsList,
    isAuthConfigured && coords ? {} : "skip",
  ) as HospitalRow[] | undefined;
  const nearest = useMemo(() => {
    if (!coords || !allHospitals) return [];
    return allHospitals
      .map((h) => ({ ...h, km: haversineKm(coords, { lat: h.lat, lng: h.lng }) }))
      .sort((a, b) => a.km - b.km)
      .slice(0, 3);
  }, [coords, allHospitals]);

  const neededBy = (): number => {
    switch (when) {
      case "now":
        return Date.now() + 30 * 60_000;
      case "today":
        return dhakaEndOfToday();
      case "tomorrow":
        return Date.now() + 24 * 3_600_000;
      case "pick":
        return Date.parse(`${pickDate}T12:00:00+06:00`) || Date.now() + 24 * 3_600_000;
    }
  };

  const phone = contactPhone ?? me?.phone ?? "";
  const canSubmit =
    Boolean(group) &&
    (hospitalId !== null ||
      (notInList && place.divisionId && place.districtId && place.upazilaId && placeText.trim().length >= 3)) &&
    phone.trim().length >= 11;

  const submit = () => {
    if (!group) return;
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
          contactPhone: phone.trim(),
          patientName: patientName.trim() || undefined,
          ward: ward.trim() || undefined,
          note: note.trim() || undefined,
          source: "form",
          aiAssisted: false,
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

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("request.new")}
      </Text>
      {error ? <Banner kind="error" icon="⚠" text={error} /> : null}

      <FieldLabel>{t("request.bloodGroup")}</FieldLabel>
      <ChipRow
        accessibilityLabel={t("request.bloodGroup")}
        options={[
          ...GROUPS.map((g) => ({ value: g, label: g })),
          { value: "any", label: t("blood.any") },
          { value: "not_sure", label: t("blood.notSure") },
        ]}
        value={group}
        onChange={setGroup}
      />
      {group === "not_sure" ? <Text style={styles.help}>{t("request.notSureNote")}</Text> : null}

      <FieldLabel>{t("request.whatNeeded")}</FieldLabel>
      <ChipRow
        accessibilityLabel={t("request.whatNeeded")}
        options={[
          { value: "whole_blood", label: t("blood.wholeBlood") },
          { value: "platelets", label: t("blood.platelets") },
        ]}
        value={component}
        onChange={(v) => setComponent(v as "whole_blood" | "platelets")}
      />
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: isDengue }}
        onPress={() => {
          setIsDengue((v) => !v);
          if (!isDengue) setComponent("platelets");
        }}
        style={styles.checkRow}
      >
        <View style={[styles.checkbox, isDengue && styles.checkboxChecked]}>
          {isDengue ? <Text style={styles.checkmark}>✓</Text> : null}
        </View>
        <Text style={styles.body}>{t("request.dengue")}</Text>
      </Pressable>

      <FieldLabel>{t("request.units")}</FieldLabel>
      <View style={styles.stepper}>
        <Button label={MINUS} variant="secondary" onPress={() => setUnits((u) => Math.max(1, u - 1))} />
        <Text style={styles.unitsText}>{t(units === 1 ? "units_one" : "units_other", { count: units })}</Text>
        <Button
          label={PLUS}
          variant="secondary"
          onPress={() => setUnits((u) => Math.min(component === "platelets" ? 4 : 10, u + 1))}
        />
      </View>

      <FieldLabel>{t("request.where")}</FieldLabel>
      {!notInList ? (
        <>
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
          <Button
            label={t("request.useLocation")}
            variant="secondary"
            onPress={() => {
              void (async () => {
                const found = await getCurrentCoordsOnce();
                if (found) setCoords(found);
              })();
            }}
          />
          {nearest.length > 0 ? (
            <>
              <Text style={styles.help}>{t("request.nearestHospitals")}</Text>
              {nearest.map((h) => (
                <Pressable
                  key={h._id}
                  accessibilityRole="button"
                  onPress={() => {
                    setHospitalId(h._id);
                    setHospitalText(h.nameEn);
                  }}
                  style={styles.resultRow}
                >
                  <Text style={styles.body}>
                    {h.nameEn} • {t("alert.distance", { km: h.km.toFixed(1) })}
                  </Text>
                </Pressable>
              ))}
            </>
          ) : null}
          <Button label={t("request.notInList")} variant="ghost" onPress={() => setNotInList(true)} />
        </>
      ) : (
        <>
          <PlacePickers value={place} onChange={setPlace} />
          <TextInput
            style={styles.input}
            value={placeText}
            onChangeText={setPlaceText}
            placeholder={t("request.searchHospital")}
            accessibilityLabel={t("request.searchHospital")}
          />
          <Button label={t("request.searchHospital")} variant="ghost" onPress={() => setNotInList(false)} />
        </>
      )}

      <FieldLabel>{t("request.when")}</FieldLabel>
      <ChipRow
        accessibilityLabel={t("request.when")}
        options={[
          { value: "now", label: t("urgency.now") },
          { value: "today", label: t("urgency.today") },
          { value: "tomorrow", label: t("urgency.tomorrow") },
          { value: "pick", label: t("urgency.pick") },
        ]}
        value={when}
        onChange={(v) => setWhen(v as typeof when)}
      />
      {when === "pick" ? (
        <TextInput
          style={styles.input}
          value={pickDate}
          onChangeText={setPickDate}
          placeholder={DATE_PLACEHOLDER}
          accessibilityLabel={t("urgency.pick")}
          keyboardType="numbers-and-punctuation"
        />
      ) : null}

      <FieldLabel>{t("request.contact")}</FieldLabel>
      <TextInput
        style={styles.input}
        value={phone}
        onChangeText={setContactPhone}
        accessibilityLabel={t("request.contact")}
        accessibilityHint={t("request.contactHelp")}
        keyboardType="phone-pad"
      />
      <Text style={styles.help}>{t("request.contactHelp")}</Text>

      <FieldLabel>{t("request.more")}</FieldLabel>
      <TextInput
        style={styles.input}
        value={patientName}
        onChangeText={setPatientName}
        placeholder={t("request.patientName")}
        accessibilityLabel={t("request.patientName")}
      />
      <TextInput
        style={styles.input}
        value={ward}
        onChangeText={setWard}
        placeholder={t("request.ward")}
        accessibilityLabel={t("request.ward")}
      />
      <TextInput
        style={styles.input}
        value={note}
        onChangeText={setNote}
        placeholder={t("request.writeLabel")}
        accessibilityLabel={t("request.writeLabel")}
        maxLength={300}
      />

      <Button label={busy ? t("request.posting") : t("request.post")} loading={busy} disabled={!canSubmit} onPress={submit} />
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
  resultRow: {
    minHeight: 48,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    backgroundColor: colors.bg.surface,
    borderRadius: radius.input,
  },
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
});
