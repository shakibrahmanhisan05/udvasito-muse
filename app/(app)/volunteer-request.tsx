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

type DonorRow = {
  donorProfileId: Id<"donorProfiles">;
  firstName: string;
  group: string;
  areaName: string;
  eligible: boolean;
  alreadyNotified: boolean;
  canBeCalled: boolean;
};

/**
 * SCR-V03 — Volunteer case view (F-703/F-705). The requester's number
 * appears only after "Reveal number" (openCase — one logged reveal);
 * donors are searched and asked from here, and an opt-in donor's number
 * is revealed only with a typed reason. No other number exists in any
 * payload on this screen.
 */
export default function VolunteerRequest() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const requestId = id as Id<"requests">;
  const data = useQuery(
    refs.volunteersGetRequest,
    isAuthConfigured && id ? { requestId } : "skip",
  );
  const openCase = useMutation(refs.volunteersOpenCase);
  const claim = useMutation(refs.volunteersClaim);
  const unclaim = useMutation(refs.volunteersUnclaim);
  const searchDonors = useMutation(refs.volunteersSearchDonors);
  const askDonor = useMutation(refs.volunteersAskDonor);
  const revealOptInDonor = useMutation(refs.volunteersRevealOptInDonor);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<DonorRow[] | null>(null);
  const [asked, setAsked] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    void fn().catch((e) => setError(errorText(t, e)));
  };

  if (!data) {
    return (
      <ScrollView contentContainerStyle={styles.wrap}>
        <Text style={styles.body}>{t("common.waitingNetwork")}</Text>
      </ScrollView>
    );
  }
  const { request, requester } = data;

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {request.bloodGroup} •{" "}
        {t(request.unitsNeeded === 1 ? "units_one" : "units_other", {
          count: request.unitsNeeded,
        })}
      </Text>
      {error ? <Banner kind="error" icon="⚠" text={error} /> : null}
      <View style={styles.card}>
        <Text style={styles.body}>{request.hospitalName}</Text>
        <Text style={styles.body}>
          {t(request.component === "platelets" ? "blood.platelets" : "blood.wholeBlood")}
        </Text>
        {request.patientName ? <Text style={styles.body}>{request.patientName}</Text> : null}
        {request.ward ? <Text style={styles.body}>{request.ward}</Text> : null}
        {request.note ? <Text style={styles.body}>{request.note}</Text> : null}
        <Text style={styles.help}>
          {requester.firstName} • {request.unitsConfirmed} • {request.unitsNeeded}
        </Text>
        {request.claimedByMe ? (
          <Button
            label={t("volunteer.unclaim")}
            variant="secondary"
            onPress={() => run(() => unclaim({ requestId }))}
          />
        ) : request.claimedByFirstName ? (
          <Text style={styles.help}>
            {t("volunteer.claimedBy", { name: request.claimedByFirstName })}
          </Text>
        ) : (
          <Button
            label={t("volunteer.claim")}
            variant="secondary"
            onPress={() => run(() => claim({ requestId }))}
          />
        )}
        {requester.phone ? (
          <>
            <Text style={styles.bodyStrong}>{requester.phone}</Text>
            <Button
              label={t("common.call")}
              onPress={() => void Linking.openURL(`tel:${requester.phone}`)}
            />
          </>
        ) : (
          <Button
            label={t("volunteer.reveal")}
            onPress={() => run(() => openCase({ requestId }))}
          />
        )}
      </View>

      <Text accessibilityRole="header" style={styles.heading}>
        {t("volunteer.findDonors")}
      </Text>
      <Button
        label={t("volunteer.findDonors")}
        variant="secondary"
        onPress={() =>
          run(async () => {
            const rows = await searchDonors({ requestId });
            setResults(rows as DonorRow[]);
          })
        }
      />
      {results && results.length === 0 ? (
        <Text style={styles.body}>{t("volunteer.noResults")}</Text>
      ) : null}
      {(results ?? []).map((donor) => (
        <View key={donor.donorProfileId} style={styles.card}>
          <Text style={styles.bodyStrong}>
            {donor.firstName} • {donor.group}
          </Text>
          <Text style={styles.help}>{donor.areaName}</Text>
          {donor.canBeCalled ? (
            <Text style={styles.help}>{t("volunteer.canBeCalled")}</Text>
          ) : null}
          {revealed[donor.donorProfileId] ? (
            <>
              <Text style={styles.bodyStrong}>{revealed[donor.donorProfileId]}</Text>
              <Button
                label={t("common.call")}
                onPress={() =>
                  void Linking.openURL(`tel:${revealed[donor.donorProfileId]}`)
                }
              />
            </>
          ) : donor.alreadyNotified || asked.has(donor.donorProfileId) ? (
            <Text style={styles.help}>{t("volunteer.asked")}</Text>
          ) : (
            <Button
              label={t("volunteer.ask")}
              variant="secondary"
              onPress={() =>
                run(async () => {
                  await askDonor({ requestId, donorProfileId: donor.donorProfileId });
                  setAsked((prev) => new Set(prev).add(donor.donorProfileId));
                })
              }
            />
          )}
          {donor.canBeCalled && !revealed[donor.donorProfileId] ? (
            <>
              <Text style={styles.label}>{t("volunteer.revealReason")}</Text>
              <TextInput
                style={styles.input}
                value={reason}
                onChangeText={setReason}
                accessibilityLabel={t("volunteer.revealReason")}
              />
              <Button
                label={t("volunteer.reveal")}
                variant="secondary"
                disabled={reason.trim().length < 5}
                onPress={() =>
                  run(async () => {
                    const out = await revealOptInDonor({
                      requestId,
                      donorProfileId: donor.donorProfileId,
                      reason: reason.trim(),
                    });
                    setRevealed((prev) => ({
                      ...prev,
                      [donor.donorProfileId]: out.phone,
                    }));
                  })
                }
              />
            </>
          ) : null}
        </View>
      ))}
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
