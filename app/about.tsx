import React from "react";
import { useTranslation } from "react-i18next";
import { useQuery } from "convex/react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";

/**
 * SCR-P05 — About (specs §3.7). Mission, the team (roles from
 * vision.md §8 — no personal phone numbers; only the founder is named
 * in the project documents, the other members are listed by role
 * until they choose to be named), the 7 Responsible-AI commitments
 * (PRD §6.4, verbatim), data sources and licences (the credit line
 * from docs/data-licences.md, verbatim), the medical reviewer credit
 * (from the medicalReviewer setting, shown only when set), the
 * open-source link and the contact email (contactEmail setting, shown
 * only when set).
 *
 * Section headings and the commitments are specs/PRD prose without
 * i18n keys (the I18N-GAPS register covers the public-page chrome);
 * they are held in consts below pending member 3's key review.
 */
const TITLE = "About UDVASITO";
const MISSION_TITLE = "Our mission";
const ORIGIN =
  "Student-led initiative, University of Chittagong (Dept. of Genetic Engineering & Biotechnology).";
const TEAM_TITLE = "The team";
const TEAM: { name?: string; role: string }[] = [
  { name: "Shakib Rahman Hisan", role: "Founder & lead developer — builds the platform, owns deploys, data and security" },
  { role: "Donor recruitment & partnerships — campus drives, university blood clubs, hospitals" },
  { role: "Bangla content, FAQ & QA — all Bangla copy; testing on low-end phones" },
  { role: "Operations & moderation — verifies reports and flagged requests; coordinates volunteers" },
  { role: "Presentation & community — walkthrough, slides, social media, public voting" },
];
const AI_TITLE = "Responsible AI — our 7 commitments";
const COMMITMENTS = [
  "AI never decides who is contacted — rules do, and they are visible.",
  "AI suggestions are always labelled and confirmed by a person.",
  "Code removes phone numbers, names and diagnoses before any AI call; users are told on the consent screen.",
  "No AI medical advice; health questions go to doctors and blood banks.",
  "18+ only.",
  "Every AI feature can be switched off instantly; the app works without AI.",
  "AI inputs (redacted) and outputs are logged for 30 days for review.",
];
const DATA_TITLE = "Data sources & licences";
const DATA_CREDIT =
  "Geographic data: bangladesh-geocode (MIT), incorporating Bangladesh Bureau of Statistics data via HDX COD-AB (CC BY-IGO) and GeoNames (CC BY 4.0); thana boundaries via geoBoundaries (CC BY 3.0 IGO).";
const MAP_CREDIT = "Maps: © OpenStreetMap contributors, via OpenFreeMap.";
const REVIEWER_LABEL = "Medical reviewer";
const OPEN_SOURCE_TITLE = "Open source";
const OPEN_SOURCE_BODY =
  "UDVASITO is free and open source (MIT). The code, specs and issues are public:";
const GITHUB_URL = "https://github.com/shakibrahmanhisan05/udvasito-muse";
const GITHUB_LABEL = "github.com/shakibrahmanhisan05/udvasito-muse";
const CONTACT_TITLE = "Contact";

export default function About() {
  const { t } = useTranslation();
  const appConfig = useQuery(refs.appConfig, isAuthConfigured ? {} : "skip");
  const reviewer = appConfig?.medicalReviewer;
  const reviewerLine = reviewer?.name
    ? `${REVIEWER_LABEL}: ${reviewer.name}${
        reviewer.reviewedAt
          ? ` (${new Date(reviewer.reviewedAt).toLocaleDateString()})`
          : ""
      }`
    : "";
  const contactEmail = appConfig?.contactEmail ?? "";

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {TITLE}
      </Text>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {MISSION_TITLE}
        </Text>
        <Text style={styles.body}>{t("landing.sub")}</Text>
        <Text style={styles.body}>{ORIGIN}</Text>
      </View>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {TEAM_TITLE}
        </Text>
        {TEAM.map((member) => (
          <View key={member.role} style={styles.memberRow}>
            {member.name ? <Text style={styles.bodyStrong}>{member.name}</Text> : null}
            <Text style={styles.body}>{member.role}</Text>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {AI_TITLE}
        </Text>
        {COMMITMENTS.map((c, i) => (
          <View key={c} style={styles.stepRow}>
            <View style={styles.stepBadge}>
              <Text style={styles.stepNumber}>{i + 1}</Text>
            </View>
            <Text style={styles.stepText}>{c}</Text>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {DATA_TITLE}
        </Text>
        <Text style={styles.body}>{DATA_CREDIT}</Text>
        <Text style={styles.body}>{MAP_CREDIT}</Text>
        {reviewerLine ? <Text style={styles.body}>{reviewerLine}</Text> : null}
      </View>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {OPEN_SOURCE_TITLE}
        </Text>
        <Text style={styles.body}>{OPEN_SOURCE_BODY}</Text>
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={GITHUB_LABEL}
          onPress={() => void Linking.openURL(GITHUB_URL)}
          style={styles.textLink}
        >
          <Text style={styles.linkText}>{GITHUB_LABEL}</Text>
        </Pressable>
      </View>

      {contactEmail ? (
        <View style={styles.card}>
          <Text accessibilityRole="header" style={styles.sectionTitle}>
            {CONTACT_TITLE}
          </Text>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={contactEmail}
            onPress={() => void Linking.openURL(`mailto:${contactEmail}`)}
            style={styles.textLink}
          >
            <Text style={styles.linkText}>{contactEmail}</Text>
          </Pressable>
        </View>
      ) : null}

      <Text style={styles.footer}>{t("common.notBloodBank")}</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  card: {
    backgroundColor: colors.bg.surface, borderRadius: radius.card,
    padding: spacing.lg, gap: spacing.md,
  },
  sectionTitle: { ...typography.heading, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  bodyStrong: { ...typography.bodyStrong, color: colors.text.primary },
  memberRow: { gap: 2 },
  stepRow: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  stepBadge: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brand.primary,
    alignItems: "center", justifyContent: "center",
  },
  stepNumber: { color: "#fff", fontWeight: "700" },
  stepText: { ...typography.body, color: colors.text.primary, flex: 1 },
  textLink: { minHeight: 48, justifyContent: "center" },
  linkText: { ...typography.bodyStrong, color: colors.brand.primary },
  footer: { ...typography.small, color: colors.text.muted, textAlign: "center" },
});
