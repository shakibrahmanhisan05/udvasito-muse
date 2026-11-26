import React from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { useQuery } from "convex/react";
import { ChipRow } from "./Chip";
import { refs } from "@/lib/refs";
import { isAuthConfigured } from "@/lib/auth-client";
import { colors, spacing, typography } from "../theme/tokens";
import type { Id } from "@/convex/_generated/dataModel";

const LEVEL_LABELS = { division: "division", district: "district", upazila: "upazila" } as const;

export type PlaceSelection = {
  divisionId: Id<"places"> | null;
  districtId: Id<"places"> | null;
  upazilaId: Id<"places"> | null;
};

/**
 * Division → district → upazila/thana pickers backed by places.list (§6.2).
 * Labels come from the server (nameBn in Bangla mode, nameEn otherwise).
 */
export function PlacePickers(props: {
  value: PlaceSelection;
  onChange: (next: PlaceSelection) => void;
  showUpazila?: boolean;
}) {
  const { i18n } = useTranslation();
  const lang = i18n.language === "bn" ? "bn" : "en";
  const enabled = isAuthConfigured;
  const divisions = useQuery(refs.placesList, enabled ? { level: "division" } : "skip");
  const districts = useQuery(
    refs.placesList,
    enabled && props.value.divisionId
      ? { level: "district", parentId: props.value.divisionId }
      : "skip",
  );
  const upazilas = useQuery(
    refs.placesList,
    enabled && props.value.districtId && props.showUpazila !== false
      ? { level: "upazila", parentId: props.value.districtId }
      : "skip",
  );
  const toOptions = (rows: { _id: Id<"places">; nameEn: string; nameBn: string }[] | undefined) =>
    (rows ?? []).map((r) => ({ value: r._id as string, label: lang === "bn" ? r.nameBn : r.nameEn }));

  return (
    <View style={styles.wrap}>
      <ChipRow
        accessibilityLabel={LEVEL_LABELS.division}
        options={toOptions(divisions)}
        value={props.value.divisionId as string | null}
        onChange={(v) =>
          props.onChange({ divisionId: v as Id<"places">, districtId: null, upazilaId: null })
        }
      />
      {props.value.divisionId ? (
        <ChipRow
          accessibilityLabel={LEVEL_LABELS.district}
          options={toOptions(districts)}
          value={props.value.districtId as string | null}
          onChange={(v) =>
            props.onChange({ ...props.value, districtId: v as Id<"places">, upazilaId: null })
          }
        />
      ) : null}
      {props.value.districtId && props.showUpazila !== false ? (
        <ChipRow
          accessibilityLabel={LEVEL_LABELS.upazila}
          options={toOptions(upazilas)}
          value={props.value.upazilaId as string | null}
          onChange={(v) => props.onChange({ ...props.value, upazilaId: v as Id<"places"> })}
        />
      ) : null}
    </View>
  );
}

export function FieldLabel(props: { children: string }) {
  return <Text style={styles.label}>{props.children}</Text>;
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.md },
  label: { ...typography.bodyStrong, color: colors.text.primary },
});
