import React, { useEffect, useState } from "react";
import { Redirect, useRouter } from "expo-router";
import { useTranslation } from "react-i18next";
import {
  Image, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, View,
} from "react-native";
import { Button, LanguageToggle, Skeleton } from "@/components";
import { useQuery } from "convex/react";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { getLocalConsent, consentSatisfies } from "@/lib/consent";
import { FALLBACK_APP_CONFIG } from "@/lib/appConfig";
import { convexSiteUrl, isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";

/**
 * SCR-P01 — Landing page (specs §3.7, US-P01).
 *
 * Web: the public landing page — static shell (hero renders without
 * any JS data), live-impact numbers loaded afterwards from
 * GET /public/stats (specs §6.5, practice area excluded server-side).
 * Native: no UI — redirect (/home if consent is current, else
 * /welcome), exactly as specs §3.7 prescribes.
 *
 * Copy: hero/how-it-works come from the keyed landing.* strings. The
 * page chrome (header labels, section titles, stats labels, footer
 * initiative line) has no i18n keys in specs — registered in
 * docs/dev/I18N-GAPS.md §3 (#72) — so it is held in the consts below
 * (specs §3.7 layout wording verbatim where specs give it), pending
 * member 3's key review; the Responsible-AI bullets are PRD §6.4
 * commitments 1–3 verbatim. The dengue strip (layout item 5) links to
 * the P7 learn pages and stays hidden until they exist (§1.9).
 */
const DOWNLOAD_APP = "Download app";
const SIGN_IN = "Sign in";
const HOW_TITLE = "How it works";
const LIVE_IMPACT = "Live impact";
const UPDATED_5_MIN = "Updated every 5 minutes";
const STATS_UNAVAILABLE = "Live numbers are not available right now.";
const DONORS_LIVE = "donors ready now";
const REQUESTS_HELPED = "requests helped";
const DONATIONS_CONFIRMED = "donations confirmed";
const AI_TITLE = "Responsible AI";
const AI_BULLETS = [
  "AI never decides who is contacted — rules do, and they are visible.",
  "AI suggestions are always labelled and confirmed by a person.",
  "Code removes phone numbers, names and diagnoses before any AI call; users are told on the consent screen.",
];
const ABOUT_LINK = "About UDVASITO";
const FOOTER_PRIVACY = "Privacy";
const FOOTER_TERMS = "Terms";
const FOOTER_ABOUT = "About";
const INITIATIVE = "A student initiative, University of Chittagong";

type PublicStats = {
  donorsByGroup: Record<string, number>;
  donorsLive: number;
  requestsHelped: number;
  donationsConfirmed: number;
  updatedAt: number;
};

const GROUP_ORDER = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

function usePublicStats() {
  const [stats, setStats] = useState<PublicStats | null>(null);
  const [failed, setFailed] = useState(
    () => Platform.OS !== "web" || !convexSiteUrl,
  );
  useEffect(() => {
    if (Platform.OS !== "web" || !convexSiteUrl) return;
    let cancelled = false;
    fetch(`${convexSiteUrl}/public/stats`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("stats"))))
      .then((data: PublicStats) => {
        if (!cancelled) setStats(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return { stats, failed };
}

function Landing() {
  const { t } = useTranslation();
  const router = useRouter();
  const { stats, failed } = usePublicStats();
  const appConfigMissing = !convexSiteUrl;

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <View style={styles.header}>
        <View style={styles.brandRow}>
          <Image
            source={require("../assets/icon.png")}
            style={styles.logo}
            accessibilityLabel={t("common.appName")}
          />
          <Text accessibilityRole="header" style={styles.appName}>
            {t("common.appName")}
          </Text>
        </View>
        <View style={styles.headerActions}>
          <LanguageToggle />
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={DOWNLOAD_APP}
            onPress={() => router.push("/download")}
            style={styles.headerLink}
          >
            <Text style={styles.headerLinkText}>{DOWNLOAD_APP}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={SIGN_IN}
            onPress={() => router.push("/(onboarding)/sign-in")}
            style={styles.headerLink}
          >
            <Text style={styles.headerLinkText}>{SIGN_IN}</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.hero}>
        <Text style={styles.heroTitle}>{t("landing.hero")}</Text>
        <Text style={styles.heroSub}>{t("landing.sub")}</Text>
        <View style={styles.ctaRow}>
          <Button
            label={t("home.needBlood")}
            onPress={() => router.push("/(app)/request-new")}
          />
          <Button
            label={t("home.becomeDonor")}
            variant="secondary"
            onPress={() => router.push("/(app)/donor-setup")}
          />
        </View>
      </View>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {HOW_TITLE}
        </Text>
        {[t("landing.how1"), t("landing.how2"), t("landing.how3"), t("landing.how4")].map(
          (step, i) => (
            <View key={step} style={styles.stepRow}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepNumber}>{i + 1}</Text>
              </View>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ),
        )}
      </View>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {LIVE_IMPACT}
        </Text>
        {stats ? (
          <>
            <View style={styles.statRow}>
              <View style={styles.stat}>
                <Text style={styles.statNumber}>{stats.donorsLive}</Text>
                <Text style={styles.statLabel}>{DONORS_LIVE}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statNumber}>{stats.requestsHelped}</Text>
                <Text style={styles.statLabel}>{REQUESTS_HELPED}</Text>
              </View>
              <View style={styles.stat}>
                <Text style={styles.statNumber}>{stats.donationsConfirmed}</Text>
                <Text style={styles.statLabel}>{DONATIONS_CONFIRMED}</Text>
              </View>
            </View>
            <View style={styles.groupRow}>
              {GROUP_ORDER.map((g) => (
                <View key={g} style={styles.groupChip}>
                  <Text style={styles.groupText}>{`${g}: ${stats.donorsByGroup[g] ?? 0}`}</Text>
                </View>
              ))}
            </View>
            <Text style={styles.help}>{UPDATED_5_MIN}</Text>
          </>
        ) : (
          <Text style={styles.help}>
            {failed || appConfigMissing ? STATS_UNAVAILABLE : t("common.waitingNetwork")}
          </Text>
        )}
      </View>

      <View style={styles.card}>
        <Text accessibilityRole="header" style={styles.sectionTitle}>
          {AI_TITLE}
        </Text>
        {AI_BULLETS.map((b) => (
          <Text key={b} style={styles.body}>
            {"• "}
            {b}
          </Text>
        ))}
        <Pressable
          accessibilityRole="link"
          accessibilityLabel={ABOUT_LINK}
          onPress={() => router.push("/about")}
          style={styles.textLink}
        >
          <Text style={styles.linkText}>{ABOUT_LINK}</Text>
        </Pressable>
      </View>

      <View style={styles.footer}>
        <Text style={styles.help}>{t("common.notBloodBank")}</Text>
        <View style={styles.footerLinks}>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={FOOTER_PRIVACY}
            onPress={() => router.push("/(onboarding)/privacy")}
            style={styles.textLink}
          >
            <Text style={styles.linkText}>{FOOTER_PRIVACY}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={FOOTER_TERMS}
            onPress={() => router.push("/(onboarding)/terms")}
            style={styles.textLink}
          >
            <Text style={styles.linkText}>{FOOTER_TERMS}</Text>
          </Pressable>
          <Pressable
            accessibilityRole="link"
            accessibilityLabel={FOOTER_ABOUT}
            onPress={() => router.push("/about")}
            style={styles.textLink}
          >
            <Text style={styles.linkText}>{FOOTER_ABOUT}</Text>
          </Pressable>
        </View>
        <ContactEmail />
        <Text style={styles.help}>{INITIATIVE}</Text>
      </View>
    </ScrollView>
  );
}

/** Footer contact email — rendered only when the team has set the
 *  public contactEmail setting (SCR-P01 layout item 7). */
function ContactEmail() {
  const appConfig = useQuery(refs.appConfig, isAuthConfigured ? {} : "skip");
  const email = appConfig?.contactEmail ?? "";
  if (!email) return null;
  return (
    <Pressable
      accessibilityRole="link"
      accessibilityLabel={email}
      onPress={() => void Linking.openURL(`mailto:${email}`)}
      style={styles.textLink}
    >
      <Text style={styles.linkText}>{email}</Text>
    </Pressable>
  );
}

export default function Index() {
  const [target, setTarget] = useState<"/(onboarding)/welcome" | "/(app)/home" | null>(null);
  useEffect(() => {
    if (Platform.OS === "web") return;
    void (async () => {
      const local = await getLocalConsent();
      setTarget(
        consentSatisfies(local?.consentVersion, FALLBACK_APP_CONFIG.consentVersion)
          ? "/(app)/home"
          : "/(onboarding)/welcome",
      );
    })();
  }, []);
  if (Platform.OS === "web") return <Landing />;
  if (!target) {
    return (
      <View style={{ flex: 1, padding: 16, backgroundColor: "#fff" }}>
        <Skeleton height={28} width="60%" />
        <Skeleton height={120} />
      </View>
    );
  }
  return <Redirect href={target} />;
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg.app, flexGrow: 1 },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    flexWrap: "wrap", gap: spacing.md,
  },
  brandRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  logo: { width: 40, height: 40, borderRadius: 10 },
  appName: { ...typography.title, color: colors.text.primary },
  headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.md, flexWrap: "wrap" },
  headerLink: { minHeight: 48, justifyContent: "center", paddingHorizontal: spacing.sm },
  headerLinkText: { ...typography.bodyStrong, color: colors.brand.primary },
  hero: { gap: spacing.md, paddingVertical: spacing.lg },
  heroTitle: { ...typography.display, color: colors.text.primary },
  heroSub: { ...typography.body, color: colors.text.muted },
  ctaRow: { flexDirection: "row", gap: spacing.md, flexWrap: "wrap" },
  card: {
    backgroundColor: colors.bg.surface, borderRadius: radius.card,
    padding: spacing.lg, gap: spacing.md,
  },
  sectionTitle: { ...typography.heading, color: colors.text.primary },
  stepRow: { flexDirection: "row", gap: spacing.md, alignItems: "flex-start" },
  stepBadge: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.brand.primary,
    alignItems: "center", justifyContent: "center",
  },
  stepNumber: { color: "#fff", fontWeight: "700" },
  stepText: { ...typography.body, color: colors.text.primary, flex: 1 },
  statRow: { flexDirection: "row", gap: spacing.lg, flexWrap: "wrap" },
  stat: { gap: 2 },
  statNumber: { ...typography.display, color: colors.brand.primary },
  statLabel: { ...typography.small, color: colors.text.muted },
  groupRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap" },
  groupChip: {
    borderWidth: 1, borderColor: colors.border.input, borderRadius: radius.input,
    paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, minHeight: 32,
    justifyContent: "center",
  },
  groupText: { ...typography.small, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  help: { ...typography.small, color: colors.text.muted },
  textLink: { minHeight: 48, justifyContent: "center" },
  linkText: { ...typography.bodyStrong, color: colors.brand.primary },
  footer: { gap: spacing.sm, alignItems: "flex-start" },
  footerLinks: { flexDirection: "row", gap: spacing.lg, flexWrap: "wrap" },
});
