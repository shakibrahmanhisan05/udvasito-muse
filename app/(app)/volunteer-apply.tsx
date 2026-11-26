import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Banner, Button } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { errorText } from "@/lib/errors";
import type { Id } from "@/convex/_generated/dataModel";

type PlaceRow = {
  _id: Id<"places">;
  nameEn: string;
  nameBn: string;
  lat: number;
  lng: number;
};

/**
 * SCR-V01 — Become a volunteer (F-701). Pick the areas you can cover,
 * say why (VAL-16: 10–300 chars), submit. An admin reviews the
 * application; the status shows here until then.
 */
export default function VolunteerApply() {
  const { t } = useTranslation();
  const router = useRouter();
  const appConfig = useQuery(refs.appConfig, isAuthConfigured ? {} : "skip");
  const mine = useQuery(refs.volunteersGetMine, isAuthConfigured ? {} : "skip");
  const apply = useMutation(refs.volunteersApply);
  const [divisionId, setDivisionId] = useState<Id<"places"> | null>(null);
  const [districtId, setDistrictId] = useState<Id<"places"> | null>(null);
  const [upazilaIds, setUpazilaIds] = useState<Id<"places">[]>([]);
  const [motivation, setMotivation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const divisions = useQuery(
    refs.placesList,
    isAuthConfigured ? { level: "division" as const } : "skip",
  ) as PlaceRow[] | undefined;
  const districts = useQuery(
    refs.placesList,
    isAuthConfigured && divisionId
      ? { level: "district" as const, parentId: divisionId }
      : "skip",
  ) as PlaceRow[] | undefined;
  const upazilas = useQuery(
    refs.placesList,
    isAuthConfigured && districtId
      ? { level: "upazila" as const, parentId: districtId }
      : "skip",
  ) as PlaceRow[] | undefined;

  if (mine) {
    return (
      <ScrollView contentContainerStyle={styles.wrap}>
        <Text accessibilityRole="header" style={styles.title}>
          {t("volunteer.apply.title")}
        </Text>
        {mine.status === "pending" ? (
          <Banner kind="info" icon="ℹ" text={t("volunteer.apply.pending")} />
        ) : null}
        {mine.status === "rejected" ? (
          <Banner
            kind="error"
            icon="⚠"
            text={t("volunteer.apply.rejected", { reason: mine.reviewReason ?? "" })}
          />
        ) : null}
        {mine.status === "approved" ? (
          <Button
            label={t("volunteer.title")}
            onPress={() => router.push("/(app)/volunteer")}
          />
        ) : null}
      </ScrollView>
    );
  }

  const submit = () => {
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        await apply({
          upazilaIds,
          districtIds: districtId ? [districtId] : [],
          motivation: motivation.trim(),
          consentVersion: appConfig?.consentVersion ?? "2026-11-28-pilot",
        });
      } catch (e) {
        setError(errorText(t, e));
      } finally {
        setBusy(false);
      }
    })();
  };

  const chip = (
    id: Id<"places">,
    label: string,
    selected: boolean,
    onPress: () => void,
  ) => (
    <TouchableOpacity
      key={id}
      style={[styles.chip, selected ? styles.chipOn : null]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
    >
      <Text style={selected ? styles.chipTextOn : styles.chipText}>{label}</Text>
    </TouchableOpacity>
  );

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("volunteer.apply.title")}
      </Text>
      <Text style={styles.body}>{t("volunteer.apply.body")}</Text>
      {error ? <Banner kind="error" icon="⚠" text={error} /> : null}

      <Text style={styles.label}>{t("volunteer.apply.areas")}</Text>
      <View style={styles.chips}>
        {(divisions ?? []).map((d) =>
          chip(d._id, d.nameEn, divisionId === d._id, () => {
            setDivisionId(d._id);
            setDistrictId(null);
            setUpazilaIds([]);
          }),
        )}
      </View>
      {divisionId ? (
        <View style={styles.chips}>
          {(districts ?? []).map((d) =>
            chip(d._id, d.nameEn, districtId === d._id, () => {
              setDistrictId(d._id);
              setUpazilaIds([]);
            }),
          )}
        </View>
      ) : null}
      {districtId ? (
        <View style={styles.chips}>
          {(upazilas ?? []).map((u) =>
            chip(u._id, u.nameEn, upazilaIds.includes(u._id), () =>
              setUpazilaIds((prev) =>
                prev.includes(u._id)
                  ? prev.filter((x) => x !== u._id)
                  : [...prev, u._id],
              ),
            ),
          )}
        </View>
      ) : null}

      <Text style={styles.label}>{t("volunteer.apply.why")}</Text>
      <TextInput
        style={[styles.input, styles.multiline]}
        value={motivation}
        onChangeText={setMotivation}
        accessibilityLabel={t("volunteer.apply.why")}
        multiline
        maxLength={300}
      />
      <Button
        label={t("volunteer.apply.submit")}
        onPress={submit}
        disabled={busy || upazilaIds.length === 0 || motivation.trim().length < 10}
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  label: { ...typography.bodyStrong, color: colors.text.primary },
  input: {
    borderWidth: 1,
    borderColor: colors.border.input,
    borderRadius: radius.input,
    padding: spacing.md,
    backgroundColor: colors.bg.surface,
    color: colors.text.primary,
  },
  multiline: { minHeight: 96, textAlignVertical: "top" },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border.input,
    borderRadius: radius.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    backgroundColor: colors.bg.surface,
  },
  chipOn: { backgroundColor: colors.brand.primary, borderColor: colors.brand.primary },
  chipText: { ...typography.body, color: colors.text.primary },
  chipTextOn: { ...typography.body, color: "#FFFFFF" },
});
