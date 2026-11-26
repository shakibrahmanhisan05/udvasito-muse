import React, { useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useAction, useConvex, useMutation, useQuery } from "convex/react";
import {
  Banner,
  Button,
  ChipRow,
  FieldLabel,
  PlacePickers,
  Sheet,
  useToast,
  type PlaceSelection,
} from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { errorCode, errorText } from "@/lib/errors";
import { getCurrentCoordsOnce } from "@/lib/geo";
import { haversineKm } from "@/convex/rules/ranking";
import { parseIntake, type IntakeFields } from "@/convex/rules/intakeParser";
import { extractContactPhone } from "@/convex/rules/redaction";
import { isVoiceAvailable, startListening, stopListening, voiceLangFor } from "@/lib/voice";
import { outbox } from "@/lib/outbox";
import { formatCount, formatDateTime } from "@/lib/format";
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
 * SCR-M02 — Request blood (F-301 form + P4 quick intake: F-205 voice,
 * F-206 free-text/paste with rules-first/AI-gap parsing, F-207 offline
 * outbox). Hospital search + "use my location" nearest (haversine) +
 * "not in the list" free-text path with place pickers. Server
 * re-validates everything.
 */
export default function RequestNew() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bn" ? "bn" : "en";
  const router = useRouter();
  const toast = useToast();
  const params = useLocalSearchParams<{ dengue?: string }>();
  const me = useQuery(refs.me, isAuthConfigured ? {} : "skip");
  const create = useMutation(refs.requestsCreate);
  const convex = useConvex();
  const appConfig = useQuery(refs.appConfig, isAuthConfigured ? {} : "skip");
  // F-208 duplicate warning (behind features.duplicateWarning): the
  // match the pre-post check found, and the requester's explicit
  // "post anyway" bypass for this submission.
  const [dupMatch, setDupMatch] = useState<{
    slug: string;
    hospitalName: string;
    createdAt: number;
  } | null>(null);
  const dupBypassRef = useRef(false);

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

  // ── P4: quick intake (F-205 voice, F-206 text/paste, F-207 outbox) ──
  const parseAction = useAction(refs.intakeParse);
  const refData = useQuery(refs.intakeRefData, isAuthConfigured ? {} : "skip");
  const [quickText, setQuickText] = useState("");
  const [filling, setFilling] = useState(false);
  const [listening, setListening] = useState(false);
  const [voiceDown, setVoiceDown] = useState(false);
  const [aiDown, setAiDown] = useState(false);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const [aiFields, setAiFields] = useState<string[]>([]);
  const [queued, setQueued] = useState(false);
  const [intakeSource, setIntakeSource] = useState<"form" | "voice" | "text" | "paste">("form");
  const [aiAssistedFlag, setAiAssistedFlag] = useState(false);
  const voiceOk = useMemo(() => isVoiceAvailable(), []);

  const fieldLabel = (field: string): string =>
    ({
      bloodGroup: t("request.bloodGroup"),
      component: t("request.whatNeeded"),
      units: t("request.units"),
      hospitalId: t("request.where"),
      neededBy: t("request.when"),
      isDengue: t("request.dengue"),
    })[field] ?? field;

  /** The hospital half of a pre-fill: pick the hospital in the form
   *  (the server re-validates; place ids only matter for the
   *  not-in-list path). */
  const applyHospital = (hospitalId: string) => {
    const h = refData?.hospitals.find((x: { _id: string }) => x._id === hospitalId);
    if (!h) return;
    setHospitalId(h._id as Id<"hospitals">);
    setHospitalText(lang === "bn" ? h.nameBn : h.nameEn);
    setNotInList(false);
  };

  const applyUnits = (unitsValue: number, forComponent?: string | null) => {
    const cap = (forComponent ?? component) === "platelets" ? 4 : 10;
    setUnits(Math.min(cap, Math.max(1, unitsValue)));
  };

  /** Pre-fill from the on-device rules parse (F-1103: nothing is
   *  posted by this — the member still presses Post). */
  const applyLocal = (fields: IntakeFields) => {
    if (fields.bloodGroup) setGroup(fields.bloodGroup);
    if (fields.component) setComponent(fields.component);
    if (fields.isDengue) {
      setIsDengue(true);
      setComponent("platelets");
    }
    if (fields.units) applyUnits(fields.units, fields.component);
    if (fields.hospitalId) applyHospital(fields.hospitalId);
    if (fields.neededByKind === "now") setWhen("now");
    else if (fields.neededByKind === "today") setWhen("today");
    else if (fields.neededByKind === "tomorrow") setWhen("tomorrow");
    else if (fields.neededByKind === "datetime") setWhen("pick");
  };

  type ServerFields = {
    bloodGroup?: string | null;
    component?: "whole_blood" | "platelets" | null;
    units?: number | null;
    hospitalId?: string | null;
    neededBy?: { kind: string; atMs?: number } | null;
    isDengue?: boolean | null;
  };

  /** Pre-fill from the server parse (rules + AI gaps merged). */
  const applyServer = (fields: ServerFields) => {
    if (fields.bloodGroup) setGroup(fields.bloodGroup);
    if (fields.component) setComponent(fields.component);
    if (fields.isDengue) {
      setIsDengue(true);
      setComponent("platelets");
    }
    if (fields.units) applyUnits(fields.units, fields.component);
    if (fields.hospitalId) applyHospital(fields.hospitalId);
    if (fields.neededBy) {
      switch (fields.neededBy.kind) {
        case "now":
          setWhen("now");
          break;
        case "today":
        case "today_evening":
          setWhen("today");
          break;
        case "tomorrow":
        case "tomorrow_morning":
        case "tomorrow_evening":
          setWhen("tomorrow");
          break;
        case "datetime":
          setWhen("pick");
          if (fields.neededBy.atMs) {
            setPickDate(
              new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(
                new Date(fields.neededBy.atMs),
              ),
            );
          }
          break;
      }
    }
  };

  /**
   * "Fill the form" (F-206): rules parse on-device first; the server
   * action (rules → redacted Gemini for gaps only) runs only when a
   * required field is still missing. Fields the server found that
   * local rules did not are the AI's — shown as "AI suggested" chips.
   * The contact number comes from regex on the member's own text,
   * never from the AI.
   */
  const fillForm = async () => {
    const text = quickText.trim();
    if (text.length < 5 || filling) return;
    setFilling(true);
    setAiDown(false);
    setAiNote(null);
    setAiFields([]);
    const local: IntakeFields | null = refData
      ? parseIntake(text, lang, refData).fields
      : null;
    const localPhone = extractContactPhone(text);
    if (localPhone) setContactPhone(localPhone);
    if (local?.bloodGroup && local?.units && local?.hospitalId) {
      applyLocal(local);
      setFilling(false);
      return;
    }
    try {
      const res = (await parseAction({ text, clientId: clientId() })) as {
        fields: ServerFields;
        missing: string[];
        aiUsed: boolean;
        aiError?: string;
        extractedPhone?: string;
      };
      applyServer(res.fields);
      if (res.extractedPhone) setContactPhone(res.extractedPhone);
      const localHas = (serverKey: string): boolean => {
        if (!local) return false;
        const localKey = serverKey === "neededBy" ? "neededByKind" : serverKey;
        return local[localKey as keyof IntakeFields] != null;
      };
      const aiKeys = ["bloodGroup", "component", "units", "hospitalId", "neededBy", "isDengue"]
        .filter((k) => {
          const v = res.fields[k as keyof ServerFields];
          return v !== null && v !== undefined && !localHas(k);
        });
      setAiFields(aiKeys.map(fieldLabel));
      if (res.aiUsed) {
        setAiAssistedFlag(true);
        if (aiKeys.length > 0) {
          setAiNote(t("request.aiFilled", { count: aiKeys.length }));
        }
      }
      if (res.aiError) setAiDown(true);
      if (res.missing.length > 0) {
        setAiNote(t("request.aiMissing", { fields: res.missing.map(fieldLabel).join(", ") }));
      }
    } catch {
      // Offline or action unreachable: local rules still fill what
      // they can, the member's text stays in the box (F-902).
      if (local) applyLocal(local);
      setAiDown(true);
    } finally {
      setFilling(false);
    }
  };

  const speak = async () => {
    if (listening) {
      stopListening();
      setListening(false);
      return;
    }
    setVoiceDown(false);
    const ok = await startListening(voiceLangFor(lang), {
      onTranscript: (text) => {
        setQuickText(text);
        setIntakeSource("voice");
      },
      onError: () => setVoiceDown(true),
      onEnd: () => setListening(false),
    });
    if (ok) setListening(true);
    else setVoiceDown(true);
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
      // F-208: warn before posting when a similar request is already
      // open (specs §3.2 SCR-M02). A failed check never blocks posting.
      if (!dupBypassRef.current && appConfig?.features?.duplicateWarning === true) {
        try {
          const result = await convex.query(refs.requestsCheckDuplicate, {
            bloodGroup: group,
            hospitalId: hospitalId ?? undefined,
            upazilaId: place.upazilaId ?? undefined,
            districtId: place.districtId ?? undefined,
          });
          if (result.match) {
            setDupMatch(result.match);
            setBusy(false);
            return;
          }
        } catch {
          // fall through and post
        }
      }
      const args = {
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
        source: intakeSource,
        aiAssisted: aiAssistedFlag,
      };
      try {
        const result = await create(args);
        await outbox.remove(args.clientId).catch(() => {});
        if (result.existing) toast.show(t("request.duplicate"));
        router.replace({ pathname: "/(app)/request-live", params: { id: result.requestId } });
      } catch (e) {
        if (errorCode(e) === null) {
          // No app error code: the post never reached the server
          // (offline). Queue it in the outbox — it posts itself on
          // reconnect and the server dedupes by clientId (F-207).
          await outbox
            .enqueue({ clientId: args.clientId, payload: args, queuedAt: Date.now() })
            .catch(() => {});
          setQueued(true);
        } else {
          setError(errorText(t, e));
        }
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <>
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("request.new")}
      </Text>
      {error ? <Banner kind="error" icon="⚠" text={error} /> : null}
      {queued ? <Banner kind="warning" icon="⏳" text={t("common.waitingNetwork")} /> : null}

      <View style={styles.card}>
        <Text style={styles.cardTitle}>{t("request.quick")}</Text>
        <FieldLabel>{t("request.writeLabel")}</FieldLabel>
        <TextInput
          accessibilityLabel={t("request.writeLabel")}
          style={[styles.input, styles.textarea]}
          value={quickText}
          onChangeText={(text) => {
            setQuickText((prev) => {
              if (intakeSource === "form") {
                setIntakeSource(text.length - prev.length > 25 ? "paste" : "text");
              }
              return text;
            });
          }}
          placeholder={t("request.writePlaceholder")}
          placeholderTextColor={colors.text.muted}
          multiline
        />
        <Text style={styles.help}>{t("request.aiNotice")}</Text>
        <View style={styles.row}>
          {voiceOk ? (
            <Button
              label={listening ? t("request.listening") : t("request.speak")}
              variant="secondary"
              onPress={() => void speak()}
            />
          ) : null}
          <Button
            label={t("request.fillForm")}
            onPress={() => void fillForm()}
            disabled={filling || quickText.trim().length < 5}
            loading={filling}
          />
        </View>
        {listening ? <Text style={styles.help}>{t("request.listening")}</Text> : null}
        {voiceDown ? <Text style={styles.help}>{t("request.voiceUnavailable")}</Text> : null}
        {aiDown ? <Banner kind="warning" icon="⚠" text={t("request.aiUnavailable")} /> : null}
        {aiNote ? <Text style={styles.help}>{aiNote}</Text> : null}
        {aiFields.length > 0 ? (
          <View style={styles.chipWrap}>
            {aiFields.map((label) => (
              <View key={label} style={styles.aiChip}>
                <Text style={styles.aiChipText}>{`${label} · ${t("common.aiSuggested")}`}</Text>
              </View>
            ))}
          </View>
        ) : null}
      </View>

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
        <Text style={styles.unitsText}>{t(units === 1 ? "units_one" : "units_other", { count: formatCount(units, lang) })}</Text>
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
    <Sheet
      visible={dupMatch !== null}
      title={t("request.duplicate.title")}
      onClose={() => setDupMatch(null)}
    >
      <Text style={styles.body}>
        {t("request.duplicate.body", {
          group: group ?? "",
          hospital: dupMatch?.hospitalName ?? "",
          time: dupMatch ? formatDateTime(dupMatch.createdAt, lang) : "",
        })}
      </Text>
      <Button
        label={t("request.duplicate.join")}
        onPress={() => {
          const slug = dupMatch?.slug;
          setDupMatch(null);
          if (slug) router.push({ pathname: "/r/[slug]", params: { slug } });
        }}
      />
      <Button
        label={t("request.duplicate.postAnyway")}
        variant="ghost"
        onPress={() => {
          dupBypassRef.current = true;
          setDupMatch(null);
          submit();
        }}
      />
    </Sheet>
    </>
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
  card: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.card,
    padding: spacing.md,
    gap: spacing.sm,
  },
  cardTitle: { ...typography.heading, color: colors.text.primary },
  textarea: { minHeight: 96, textAlignVertical: "top", paddingVertical: spacing.sm },
  row: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  chipWrap: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  aiChip: {
    backgroundColor: colors.brand.primarySoft,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  aiChipText: { ...typography.small, color: colors.text.primary },
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
