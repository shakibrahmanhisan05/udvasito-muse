import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Button, ChipRow, ErrorState, FieldLabel, PlacePickers, type PlaceSelection } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * SCR-A11 — Hospitals & blood banks (F-906, switch `directoryUi`).
 * Searchable table + add/edit form per specs §3.5: name EN/BN, type,
 * area pickers, address, blood-bank phone, lat/lng, active. Chrome is
 * unkeyed in specs §4 (flagged in P7-REPORT); field labels reuse the
 * specced form wording as consts.
 */

const TITLE = "Hospital directory";
const ADD = "Add hospital";
const NAME_EN = "Name (English)";
const NAME_BN = "Name (Bangla)";
const ADDRESS = "Address";
const PHONE = "Blood-bank phone";
const LAT = "Latitude";
const LNG = "Longitude";
const ACTIVE = "Active";
const INACTIVE = "Inactive";
const TYPE_LABEL = "Type";
const SEARCH = "Search hospitals";

type Row = {
  _id: Id<"hospitals">;
  nameEn: string;
  nameBn: string;
  type: "hospital" | "blood_bank" | "clinic";
  divisionId: Id<"places">;
  districtId: Id<"places">;
  upazilaId: Id<"places">;
  address: string | null;
  bloodBankPhone: string | null;
  lat: number;
  lng: number;
  active: boolean;
};

export default function AdminDirectory() {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const rows = useQuery(
    refs.adminDirectoryList,
    isAuthConfigured ? { search } : "skip",
  ) as Row[] | undefined;
  const upsert = useMutation(refs.adminDirectoryUpsert);

  const [editing, setEditing] = useState<Row | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [nameEn, setNameEn] = useState("");
  const [nameBn, setNameBn] = useState("");
  const [type, setType] = useState<"hospital" | "blood_bank" | "clinic">("hospital");
  const [place, setPlace] = useState<PlaceSelection>({
    divisionId: null,
    districtId: null,
    upazilaId: null,
  });
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openForm = (row: Row | null) => {
    setEditing(row);
    setNameEn(row?.nameEn ?? "");
    setNameBn(row?.nameBn ?? "");
    setType(row?.type ?? "hospital");
    setPlace({
      divisionId: row?.divisionId ?? null,
      districtId: row?.districtId ?? null,
      upazilaId: row?.upazilaId ?? null,
    });
    setAddress(row?.address ?? "");
    setPhone(row?.bloodBankPhone ?? "");
    setLat(row ? String(row.lat) : "");
    setLng(row ? String(row.lng) : "");
    setActive(row?.active ?? true);
    setError(null);
    setFormOpen(true);
  };

  const canSave =
    nameEn.trim().length >= 2 &&
    nameBn.trim().length >= 2 &&
    place.divisionId !== null &&
    place.districtId !== null &&
    place.upazilaId !== null &&
    Number.isFinite(Number(lat)) &&
    Number.isFinite(Number(lng));

  const save = () => {
    if (!canSave || !place.divisionId || !place.districtId || !place.upazilaId) return;
    setBusy(true);
    setError(null);
    void (async () => {
      try {
        await upsert({
          ...(editing ? { hospitalId: editing._id } : {}),
          nameEn: nameEn.trim(),
          nameBn: nameBn.trim(),
          type,
          divisionId: place.divisionId,
          districtId: place.districtId,
          upazilaId: place.upazilaId,
          address: address.trim() || undefined,
          bloodBankPhone: phone.trim() || undefined,
          lat: Number(lat),
          lng: Number(lng),
          active,
        });
        setFormOpen(false);
      } catch {
        setError(t("errors.generic"));
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {TITLE}
      </Text>
      <TextInput
        style={styles.input}
        value={search}
        onChangeText={setSearch}
        accessibilityLabel={SEARCH}
        placeholder={SEARCH}
      />
      {!formOpen ? (
        <Button label={ADD} variant="secondary" onPress={() => openForm(null)} />
      ) : null}
      {formOpen ? (
        <View style={styles.card}>
          <FieldLabel>{NAME_EN}</FieldLabel>
          <TextInput style={styles.input} value={nameEn} onChangeText={setNameEn} accessibilityLabel={NAME_EN} />
          <FieldLabel>{NAME_BN}</FieldLabel>
          <TextInput style={styles.input} value={nameBn} onChangeText={setNameBn} accessibilityLabel={NAME_BN} />
          <ChipRow
            accessibilityLabel={TYPE_LABEL}
            options={[
              { value: "hospital", label: "Hospital" },
              { value: "blood_bank", label: "Blood bank" },
              { value: "clinic", label: "Clinic" },
            ]}
            value={type}
            onChange={(v) => setType(v as typeof type)}
          />
          <PlacePickers value={place} onChange={setPlace} />
          <FieldLabel>{ADDRESS}</FieldLabel>
          <TextInput style={styles.input} value={address} onChangeText={setAddress} accessibilityLabel={ADDRESS} />
          <FieldLabel>{PHONE}</FieldLabel>
          <TextInput style={styles.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" accessibilityLabel={PHONE} />
          <View style={styles.row}>
            <TextInput style={[styles.input, styles.flex]} value={lat} onChangeText={setLat} keyboardType="numbers-and-punctuation" accessibilityLabel={LAT} placeholder={LAT} />
            <TextInput style={[styles.input, styles.flex]} value={lng} onChangeText={setLng} keyboardType="numbers-and-punctuation" accessibilityLabel={LNG} placeholder={LNG} />
          </View>
          <ChipRow
            accessibilityLabel={ACTIVE}
            options={[
              { value: "active", label: ACTIVE },
              { value: "inactive", label: INACTIVE },
            ]}
            value={active ? "active" : "inactive"}
            onChange={(v) => setActive(v === "active")}
          />
          {error ? <ErrorState message={error} /> : null}
          <Button label={t("common.save")} loading={busy} disabled={!canSave} onPress={save} />
          <Button label={t("common.cancel")} variant="ghost" onPress={() => setFormOpen(false)} />
        </View>
      ) : null}
      {(rows ?? []).map((row) => (
        <View key={row._id} style={styles.card}>
          <Text style={styles.bodyStrong}>{row.nameEn}</Text>
          <Text style={styles.body}>{row.nameBn}</Text>
          <Text style={styles.help}>
            {`${row.type} • ${row.active ? ACTIVE : INACTIVE}${row.bloodBankPhone ? ` • ${row.bloodBankPhone}` : ""}`}
          </Text>
          <Button label={t("common.edit")} variant="secondary" onPress={() => openForm(row)} />
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  bodyStrong: { ...typography.bodyStrong, color: colors.text.primary },
  help: { ...typography.small, color: colors.text.muted },
  card: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.border.input,
    borderRadius: radius.input,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    color: colors.text.primary,
    backgroundColor: colors.bg.app,
  },
  row: { flexDirection: "row", gap: spacing.md },
  flex: { flex: 1 },
});
