import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams } from "expo-router";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Banner, Button, ErrorState, HelplineButton, SafetyCard, Sheet, Skeleton } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { errorText } from "@/lib/errors";
import { directionsUrl, formatTimeDhaka } from "@/lib/geo";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * SCR-M03 — Request live status (Convex real-time). Shows progress, the
 * confirmed donors' numbers ONLY as returned by requests.getForOwner (the
 * server reveals a number solely when a live contactReveals row entitles
 * this viewer — donor_calls donors show no number), the safety card on
 * reveal, directions, the volunteer/helpline fallback, and close actions.
 */
export default function RequestLive() {
  const { t, i18n } = useTranslation();
  const params = useLocalSearchParams<{ id: string }>();
  const lang = i18n.language === "bn" ? "bn" : "en";
  const data = useQuery(
    refs.requestsGetForOwner,
    isAuthConfigured && params.id ? { requestId: params.id as Id<"requests"> } : "skip",
  );
  const close = useMutation(refs.requestsClose);
  const [confirmClose, setConfirmClose] = useState<"fulfilled" | "not_needed" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (data === undefined) {
    return (
      <View style={styles.wrap}>
        <Skeleton height={28} width="60%" />
        <Skeleton height={120} />
      </View>
    );
  }
  if (data === null) return <ErrorState />;

  const { request } = data;
  const anyPhoneShown =
    data.confirmedDonors.some((d: { phone?: string }) => d.phone) || data.volunteers.some((v: { phone?: string }) => v.phone);
  const isOpen = request.status === "live" || request.status === "covered";

  const doClose = (reason: "fulfilled" | "not_needed") => {
    void (async () => {
      try {
        await close({ requestId: request._id, reason });
        setConfirmClose(null);
      } catch (e) {
        setError(errorText(t, e));
      }
    })();
  };

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {request.bloodGroup} • {t(request.component === "platelets" ? "blood.platelets" : "blood.wholeBlood")}
      </Text>
      <Text style={styles.body}>
        {t(`requestStatus.${request.status === "live" ? "live" : request.status === "covered" ? "covered" : "closed"}`)}
        {" • "}
        {t("home.covered", { confirmed: request.unitsConfirmed, needed: request.unitsNeeded })}
      </Text>
      <Text style={styles.body}>
        {request.hospitalName ?? request.placeText ?? ""} • {formatTimeDhaka(request.neededBy, lang)}
      </Text>
      {error ? <Banner kind="error" icon="⚠" text={error} /> : null}
      {anyPhoneShown ? <SafetyCard /> : null}

      {data.confirmedDonors.length > 0 ? (
        <View style={styles.card}>
          {data.confirmedDonors.map((donor: { responseId: string; firstName: string; callMode: string; phone?: string }) => (
            <View key={donor.responseId} style={styles.personRow}>
              <Text style={styles.personName}>{donor.firstName}</Text>
              {donor.callMode === "donor_calls" ? (
                <Text style={styles.body}>{t("contact.donorWillCall", { name: donor.firstName })}</Text>
              ) : donor.phone ? (
                <Button
                  label={`${t("common.call")} ${donor.phone}`}
                  variant="secondary"
                  onPress={() => void Linking.openURL(`tel:${donor.phone}`)}
                />
              ) : null}
            </View>
          ))}
          {request.hospitalLat !== undefined && request.hospitalLng !== undefined ? (
            <Button
              label={t("alert.directions")}
              variant="secondary"
              onPress={() =>
                void Linking.openURL(
                  directionsUrl({ lat: request.hospitalLat as number, lng: request.hospitalLng as number }),
                )
              }
            />
          ) : null}
        </View>
      ) : null}

      {data.volunteers.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("request.volunteerTitle")}</Text>
          {data.volunteers.map((volunteer: { profileId: string; firstName: string; phone?: string }) => (
            <View key={volunteer.profileId} style={styles.personRow}>
              <Text style={styles.personName}>{volunteer.firstName}</Text>
              {volunteer.phone ? (
                <Button
                  label={`${t("common.call")} ${volunteer.phone}`}
                  variant="secondary"
                  onPress={() => void Linking.openURL(`tel:${volunteer.phone}`)}
                />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {data.noDonors.show ? (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>{t("request.noDonors")}</Text>
          {data.noDonors.bloodBanks.map((bank: { hospitalId: string; name: string; phone: string | null }) => (
            <View key={bank.hospitalId} style={styles.personRow}>
              <Text style={styles.personName}>{bank.name}</Text>
              {bank.phone ? (
                <Button
                  label={`${t("common.call")} ${bank.phone}`}
                  variant="secondary"
                  onPress={() => void Linking.openURL(`tel:${bank.phone}`)}
                />
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {data.fallbackPhone || data.volunteers.length > 0 || data.noDonors.show ? (
        <HelplineButton />
      ) : null}

      {isOpen ? (
        <View style={styles.card}>
          <Button label={t("request.markFulfilled")} onPress={() => setConfirmClose("fulfilled")} />
          <Button
            label={t("request.notNeeded")}
            variant="danger"
            onPress={() => setConfirmClose("not_needed")}
          />
        </View>
      ) : (
        <Banner kind="info" icon="ℹ" text={t("request.closed")} />
      )}

      <Sheet
        visible={confirmClose !== null}
        title={t("request.closeConfirm")}
        onClose={() => setConfirmClose(null)}
      >
        <Button
          label={confirmClose === "fulfilled" ? t("request.markFulfilled") : t("request.notNeeded")}
          variant={confirmClose === "fulfilled" ? "primary" : "danger"}
          onPress={() => confirmClose && doClose(confirmClose)}
        />
        <Button label={t("common.cancel")} variant="ghost" onPress={() => setConfirmClose(null)} />
      </Sheet>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  card: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardTitle: { ...typography.heading, color: colors.text.primary },
  personRow: { gap: spacing.sm },
  personName: { ...typography.bodyStrong, color: colors.text.primary },
});
