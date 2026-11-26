import React from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "convex/react";
import { EmptyState } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { formatTimeDhaka } from "@/lib/geo";
import type { Id } from "@/convex/_generated/dataModel";

type InboxItem = {
  responseId: Id<"responses">;
  requestId: Id<"requests">;
  state: string;
  bloodGroup: string;
  component: string;
  hospitalName: string;
  neededBy: number;
  distanceKm: number | null;
  isDemo: boolean;
};

function Section(props: {
  title: string;
  items: InboxItem[];
  onOpen: (item: InboxItem) => void;
}) {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bn" ? "bn" : "en";
  if (props.items.length === 0) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{props.title}</Text>
      {props.items.map((item) => (
        <Pressable
          key={item.responseId}
          accessibilityRole="button"
          onPress={() => props.onOpen(item)}
          style={styles.card}
        >
          <Text style={styles.cardTitle}>
            {t("alert.title", {
              group: item.bloodGroup,
              component: t(item.component === "platelets" ? "blood.platelets" : "blood.wholeBlood"),
            })}
          </Text>
          <Text style={styles.body}>{item.hospitalName}</Text>
          <Text style={styles.body}>
            {t("alert.neededBy", { time: formatTimeDhaka(item.neededBy, lang) })}
            {item.distanceKm !== null
              ? ` • ${t("alert.distance", { km: item.distanceKm.toFixed(1) })}`
              : ""}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** SCR-D03 — Alerts inbox: needs answer / said yes / earlier (F-501). */
export default function Alerts() {
  const { t } = useTranslation();
  const router = useRouter();
  const inbox = useQuery(refs.responsesInbox, isAuthConfigured ? {} : "skip");
  const open = (item: InboxItem) =>
    router.push({ pathname: "/(app)/alert-detail", params: { id: item.requestId } });

  const empty =
    inbox &&
    inbox.needsAnswer.length === 0 &&
    inbox.saidYes.length === 0 &&
    inbox.earlier.length === 0;

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("alerts.title")}
      </Text>
      {empty ? <EmptyState icon="🩸" title={t("alerts.empty")} /> : null}
      {inbox ? (
        <>
          <Section title={t("alerts.needsAnswer")} items={inbox.needsAnswer as InboxItem[]} onOpen={open} />
          <Section title={t("alerts.saidYes")} items={inbox.saidYes as InboxItem[]} onOpen={open} />
          <Section title={t("alerts.earlier")} items={inbox.earlier as InboxItem[]} onOpen={open} />
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  section: { gap: spacing.md },
  sectionTitle: { ...typography.heading, color: colors.text.primary },
  card: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  cardTitle: { ...typography.bodyStrong, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
});
