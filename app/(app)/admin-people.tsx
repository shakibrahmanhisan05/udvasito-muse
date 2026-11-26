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

type ApplicationRow = {
  volunteerProfileId: Id<"volunteerProfiles">;
  profileId: Id<"profiles">;
  name: string;
  status: string;
  areaNames: string[];
  institution?: string;
  motivation?: string;
  phoneVerified: boolean;
};

type PersonRow = {
  profileId: Id<"profiles">;
  name: string;
  role: string;
  status: string;
  donorGroup: string | null;
};

/**
 * SCR-A04 — Admin: volunteer applications + people search (F-903).
 * Applications are reviewed here (approve / reject with a reason);
 * people are found by name or ID — never by phone — and opened in
 * SCR-A05. All payloads on this screen are phone-free.
 */
export default function AdminPeople() {
  const { t } = useTranslation();
  const router = useRouter();
  const applications = useQuery(
    refs.adminApplications,
    isAuthConfigured ? {} : "skip",
  ) as ApplicationRow[] | undefined;
  const review = useMutation(refs.adminReviewVolunteer);
  const [reason, setReason] = useState("");
  const [searchText, setSearchText] = useState("");
  const people = useQuery(
    refs.adminPeopleSearch,
    isAuthConfigured && searchText.trim() ? { text: searchText.trim() } : "skip",
  ) as PersonRow[] | undefined;
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    setDone(false);
    void fn()
      .then(() => setDone(true))
      .catch((e) => setError(errorText(t, e)));
  };

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("admin.applications")}
      </Text>
      {error ? <Banner kind="error" icon="⚠" text={error} /> : null}
      {done ? <Banner kind="success" icon="✓" text={t("common.done")} /> : null}
      <Text style={styles.label}>{t("volunteer.revealReason")}</Text>
      <TextInput
        style={styles.input}
        value={reason}
        onChangeText={setReason}
        accessibilityLabel={t("volunteer.revealReason")}
      />
      {(applications ?? [])
        .filter((a) => a.status === "pending")
        .map((application) => (
          <View key={application.volunteerProfileId} style={styles.card}>
            <Text style={styles.bodyStrong}>{application.name}</Text>
            {application.areaNames.map((area) => (
              <Text key={area} style={styles.body}>
                {area}
              </Text>
            ))}
            {application.institution ? (
              <Text style={styles.body}>{application.institution}</Text>
            ) : null}
            <Text style={styles.help}>{application.motivation}</Text>
            <Button
              label={t("admin.approve")}
              onPress={() =>
                run(() =>
                  review({
                    volunteerProfileId: application.volunteerProfileId,
                    decision: "approve",
                  }),
                )
              }
            />
            <Button
              label={t("admin.reject")}
              variant="secondary"
              disabled={reason.trim().length < 5}
              onPress={() =>
                run(() =>
                  review({
                    volunteerProfileId: application.volunteerProfileId,
                    decision: "reject",
                    reason: reason.trim(),
                  }),
                )
              }
            />
          </View>
        ))}

      <Text accessibilityRole="header" style={styles.heading}>
        {t("admin.people")}
      </Text>
      <TextInput
        style={styles.input}
        value={searchText}
        onChangeText={setSearchText}
        accessibilityLabel={t("admin.people")}
      />
      {(people ?? []).map((person) => (
        <TouchableOpacity
          key={person.profileId}
          style={styles.card}
          accessibilityRole="button"
          onPress={() =>
            router.push({
              pathname: "/(app)/admin-person",
              params: { id: person.profileId },
            })
          }
        >
          <Text style={styles.bodyStrong}>{person.name}</Text>
          <Text style={styles.help}>
            {person.role} • {person.status}
            {person.donorGroup ? ` • ${person.donorGroup}` : ""}
          </Text>
        </TouchableOpacity>
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
