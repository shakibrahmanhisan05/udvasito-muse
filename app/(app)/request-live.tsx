import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { useMutation, useQuery } from "convex/react";
import { Banner, Button, ErrorState, HelplineButton, SafetyCard, Sheet, Skeleton } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { errorText } from "@/lib/errors";
import { directionsUrl, formatTimeDhaka } from "@/lib/geo";
import type { Id } from "@/convex/_generated/dataModel";

/** F-209 slip-pending line — unkeyed in specs §4 (P7 gap list). */
const SLIP_PENDING = "Slip sent — a volunteer will check it.";

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
  const appConfig = useQuery(refs.appConfig, isAuthConfigured ? {} : "skip");
  const router = useRouter();
  const close = useMutation(refs.requestsClose);
  const genSlipUrl = useMutation(refs.requestsGenerateSlipUploadUrl);
  const attachSlip = useMutation(refs.requestsAttachSlip);
  const [slipBusy, setSlipBusy] = useState(false);
  const markNotResponding = useMutation(refs.requestsMarkDonorNotResponding);
  const updateRequest = useMutation(refs.requestsUpdate);
  const reopenRequest = useMutation(refs.requestsReopen);
  const [notResponding, setNotResponding] = useState<{ responseId: string; name: string } | null>(
    null,
  );
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

  // F-209: attach a hospital slip photo (VAL-12 resize on-device;
  // the file goes to private Convex storage via a one-time URL).
  const attachSlipPhoto = () => {
    setSlipBusy(true);
    void (async () => {
      try {
        const ImagePicker = await import("expo-image-picker");
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (!perm.granted) return;
        const picked = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          quality: 1,
        });
        if (picked.canceled || !picked.assets[0]) return;
        let uri = picked.assets[0].uri;
        let mime = picked.assets[0].mimeType ?? "image/jpeg";
        try {
          const Manipulator = await import("expo-image-manipulator");
          const out = await Manipulator.manipulateAsync(
            uri,
            [{ resize: { width: 1600 } }],
            { compress: 0.7, format: Manipulator.SaveFormat.JPEG },
          );
          uri = out.uri;
          mime = "image/jpeg";
        } catch {
          // Keep the original photo if resizing is unavailable.
        }
        const { uploadUrl } = await genSlipUrl({ requestId: request._id });
        const blob = await (await fetch(uri)).blob();
        const up = await fetch(uploadUrl, {
          method: "POST",
          headers: { "Content-Type": mime },
          body: blob,
        });
        if (!up.ok) throw new Error("upload failed");
        const { storageId } = (await up.json()) as { storageId: string };
        await attachSlip({
          requestId: request._id,
          storageId: storageId as Id<"_storage">,
        });
      } catch (e) {
        setError(errorText(t, e));
      } finally {
        setSlipBusy(false);
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
      {request.createdByVolunteerId ? (
        <Text style={styles.body}>{t("volunteerPost.label")}</Text>
      ) : null}
      {error ? <Banner kind="error" icon="⚠" text={error} /> : null}
      {anyPhoneShown ? <SafetyCard /> : null}

      {data.confirmedDonors.length > 0 ? (
        <View style={styles.card}>
          {data.confirmedDonors.map((donor: { responseId: string; donorAuthUserId?: string; firstName: string; callMode: string; phone?: string }) => (
            <View key={donor.responseId} style={styles.personRow}>
              <Text style={styles.personName}>{donor.firstName}</Text>
              {isOpen ? (
                <Button
                  label={t("request.donorNotResponding")}
                  variant="ghost"
                  onPress={() =>
                    setNotResponding({ responseId: donor.responseId, name: donor.firstName })
                  }
                />
              ) : null}
              {donor.donorAuthUserId ? (
                <Button
                  label={t("report.title")}
                  variant="ghost"
                  onPress={() =>
                    router.push({
                      pathname: "/(app)/report",
                      params: { subject: donor.donorAuthUserId as string, requestId: request._id },
                    })
                  }
                />
              ) : null}
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
          <Button
            label={t("confirm.title")}
            variant="secondary"
            onPress={() =>
              router.push({ pathname: "/(app)/confirm", params: { id: request._id } })
            }
          />
          <Button
            label={t("request.needMore")}
            variant="secondary"
            onPress={() =>
              void updateRequest({
                requestId: request._id,
                unitsNeeded: Math.min(4, request.unitsNeeded + 1),
              }).catch((e: unknown) => setError(errorText(t, e)))
            }
          />
          <Button label={t("request.markFulfilled")} onPress={() => setConfirmClose("fulfilled")} />
          {appConfig?.features?.sharedLinks === true ? (
            <Button
              label={t("request.share")}
              variant="secondary"
              onPress={() =>
                router.push({ pathname: "/(app)/request-share", params: { id: request._id } })
              }
            />
          ) : null}
          {appConfig?.features?.slips === true ? (
            <>
              {request.slipStatus === "approved" ? (
                <Text style={styles.body}>{t("alert.verified")}</Text>
              ) : null}
              {request.slipStatus === "pending" ? (
                <Text style={styles.body}>{SLIP_PENDING}</Text>
              ) : null}
              {request.slipStatus === "rejected" && request.slipReviewReason ? (
                <Text style={styles.body}>{request.slipReviewReason}</Text>
              ) : null}
              {request.slipStatus !== "pending" && request.slipStatus !== "approved" ? (
                <Button
                  label={t("request.slip")}
                  variant="secondary"
                  loading={slipBusy}
                  onPress={attachSlipPhoto}
                />
              ) : null}
            </>
          ) : null}
          <Button
            label={t("request.notNeeded")}
            variant="danger"
            onPress={() => setConfirmClose("not_needed")}
          />
        </View>
      ) : (
        <View style={styles.card}>
          <Banner kind="info" icon="ℹ" text={t("request.closed")} />
          <Button
            label={t("confirm.title")}
            variant="secondary"
            onPress={() =>
              router.push({ pathname: "/(app)/confirm", params: { id: request._id } })
            }
          />
          <Button
            label={t("request.reopen")}
            variant="ghost"
            onPress={() =>
              void reopenRequest({ requestId: request._id }).catch((e: unknown) =>
                setError(errorText(t, e)),
              )
            }
          />
        </View>
      )}

      <Sheet
        visible={notResponding !== null}
        title={t("request.donorNotResponding")}
        onClose={() => setNotResponding(null)}
      >
        <Text style={styles.body}>
          {t("request.donorNotRespondingConfirm", { name: notResponding?.name ?? "" })}
        </Text>
        <Button
          label={t("request.donorNotResponding")}
          variant="danger"
          onPress={() => {
            if (!notResponding) return;
            void (async () => {
              try {
                await markNotResponding({
                  requestId: request._id,
                  responseId: notResponding.responseId as Id<"responses">,
                });
                setNotResponding(null);
              } catch (e) {
                setError(errorText(t, e));
              }
            })();
          }}
        />
        <Button label={t("common.cancel")} variant="ghost" onPress={() => setNotResponding(null)} />
      </Sheet>

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
