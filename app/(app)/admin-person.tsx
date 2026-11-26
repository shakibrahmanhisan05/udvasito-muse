import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams } from "expo-router";
import { Linking, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Banner, Button } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { errorText } from "@/lib/errors";
import type { Id } from "@/convex/_generated/dataModel";

type PersonDetail = {
  name: string;
  age: number;
  role: string;
  status: string;
  donor: { bloodGroup: string; live: boolean } | null;
  counts: { requests: number; responses: number; reportsAbout: number };
  consents: { kind: string; version: string; acceptedAt: number }[];
};

const ROLES = ["member", "volunteer", "admin", "superadmin"] as const;
const STATUSES = ["active", "frozen", "suspended", "banned"] as const;
/** Suspend from this screen lasts 7 days (admin console refinement). */
const SUSPEND_DAYS = 7;

/**
 * SCR-A05 — Admin: person detail (F-903/F-805). Age, never date of
 * birth; the phone number appears only through "Reveal number" with a
 * typed reason (audited, S-24 counted). Role/status changes need the
 * same reason and are audit-logged server-side. NOTE: the role/status
 * action labels render the enum values, and the revoke-verification
 * button is omitted — keyed admin copy for these controls is an open
 * i18n gap (see P3-REPORT); the server function is built and tested.
 */
export default function AdminPerson() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const profileId = id as Id<"profiles">;
  const person = useQuery(
    refs.adminPeopleGet,
    isAuthConfigured && id ? { profileId } : "skip",
  ) as PersonDetail | undefined;
  const setRole = useMutation(refs.adminSetRole);
  const setStatus = useMutation(refs.adminSetStatus);
  const revealPhone = useMutation(refs.adminRevealPhone);
  const [reason, setReason] = useState("");
  const [phone, setPhone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    setDone(false);
    void fn()
      .then(() => setDone(true))
      .catch((e) => setError(errorText(t, e)));
  };
  const reasonOk = reason.trim().length >= 5;

  if (!person) {
    return (
      <ScrollView contentContainerStyle={styles.wrap}>
        <Text style={styles.body}>{t("common.waitingNetwork")}</Text>
      </ScrollView>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {person.name}
      </Text>
      {error ? <Banner kind="error" icon="⚠" text={error} /> : null}
      {done ? <Banner kind="success" icon="✓" text={t("common.done")} /> : null}
      <View style={styles.card}>
        <Text style={styles.body}>
          {person.role} • {person.status} • {person.age}
        </Text>
        {person.donor ? (
          <Text style={styles.body}>
            {person.donor.bloodGroup}
          </Text>
        ) : null}
        <Text style={styles.help}>
          {person.counts.requests} • {person.counts.responses} •{" "}
          {person.counts.reportsAbout}
        </Text>
        {person.consents.map((consent) => (
          <Text key={`${consent.kind}-${consent.acceptedAt}`} style={styles.help}>
            {consent.kind} • {consent.version}
          </Text>
        ))}
      </View>

      <Text style={styles.label}>{t("volunteer.revealReason")}</Text>
      <TextInput
        style={styles.input}
        value={reason}
        onChangeText={setReason}
        accessibilityLabel={t("volunteer.revealReason")}
      />

      <View style={styles.card}>
        {phone ? (
          <>
            <Text style={styles.bodyStrong}>{phone}</Text>
            <Button
              label={t("common.call")}
              onPress={() => void Linking.openURL(`tel:${phone}`)}
            />
          </>
        ) : (
          <Button
            label={t("volunteer.reveal")}
            disabled={!reasonOk}
            onPress={() =>
              run(async () => {
                const out = await revealPhone({ profileId, reason: reason.trim() });
                setPhone(out.phone);
              })
            }
          />
        )}
      </View>

      <View style={styles.card}>
        {ROLES.filter((role) => role !== person.role).map((role) => (
          <Button
            key={role}
            label={role}
            variant="secondary"
            disabled={!reasonOk}
            onPress={() =>
              run(() => setRole({ profileId, role, reason: reason.trim() }))
            }
          />
        ))}
      </View>

      <View style={styles.card}>
        {STATUSES.filter((status) => status !== person.status).map((status) => (
          <Button
            key={status}
            label={status}
            variant="secondary"
            disabled={!reasonOk}
            onPress={() =>
              run(() =>
                setStatus({
                  profileId,
                  status,
                  reason: reason.trim(),
                  until:
                    status === "suspended"
                      ? Date.now() + SUSPEND_DAYS * 86_400_000
                      : undefined,
                }),
              )
            }
          />
        ))}
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
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
