import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useConvex, useQuery } from "convex/react";
import { Button, Skeleton } from "@/components";
import { colors, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { setLanguage } from "@/lib/i18n";
import { formatDateTime } from "@/lib/format";

/**
 * SCR-P02 — Shared request (F-1002, if-time; behind
 * features.sharedLinks). The anonymised public view of one request:
 * group, component, units, hospital, area, needed-by, status — no
 * names, no numbers (requests.publicView returns nothing else).
 * "I can help" leads to sign-in (then donor setup → accept, per
 * US-P02); signed-in members go to their alerts. Open Graph tags for
 * this URL come from the Vercel function (api/r/[slug].ts, ADR-006).
 *
 * The closed-state line is specs §3.2 SCR-P02 verbatim (EN/BN); it has
 * no i18n key — flagged in docs/dev/I18N-GAPS.md by the P7 report.
 */
const CLOSED_MESSAGE = {
  en: "This request is no longer active. Thank you for caring.",
  bn: "এই অনুরোধটি আর সক্রিয় নয়। আপনার আন্তরিকতার জন্য ধন্যবাদ।",
} as const;

type PublicView = {
  bloodGroup: string;
  component: string;
  unitsNeeded: number;
  unitsConfirmed: number;
  hospitalName: string;
  areaName: string;
  neededBy: number;
  status: string;
};

export default function SharedRequest() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bn" ? "bn" : "en";
  const params = useLocalSearchParams<{ slug: string; lang?: string }>();
  const router = useRouter();
  const convex = useConvex();
  const me = useQuery(refs.me, isAuthConfigured ? {} : "skip");
  const [view, setView] = useState<PublicView | null | undefined>(undefined);

  useEffect(() => {
    if (params.lang === "bn" || params.lang === "en") {
      void setLanguage(params.lang);
    }
  }, [params.lang]);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const result = await convex.query(refs.requestsPublicView, { slug: params.slug });
        if (alive) setView(result as PublicView);
      } catch {
        // ERR_NOT_FOUND (unknown slug, practice request, hidden, or the
        // feature is off) — one honest not-found state for all.
        if (alive) setView(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [convex, params.slug]);

  if (view === undefined) {
    return (
      <View style={styles.wrap}>
        <Skeleton height={32} width="70%" />
        <Skeleton height={140} />
      </View>
    );
  }
  if (view === null) {
    return (
      <View style={styles.wrap}>
        <Text accessibilityRole="header" style={styles.title}>
          {t("notFound.title")}
        </Text>
        <Button label={t("notFound.home")} onPress={() => router.replace("/")} />
      </View>
    );
  }

  const isOpen = view.status === "live" || view.status === "covered";
  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("alert.title", {
          group: view.bloodGroup,
          component: t(view.component === "platelets" ? "blood.platelets" : "blood.wholeBlood"),
        })}
      </Text>
      <Text style={styles.body}>
        {t("units", { count: view.unitsNeeded })} • {view.hospitalName}
        {view.areaName ? `, ${view.areaName}` : ""}
      </Text>
      <Text style={styles.body}>
        {t("alert.neededBy", { time: formatDateTime(view.neededBy, lang) })}
      </Text>
      <Text style={styles.body}>
        {t("home.covered", { confirmed: view.unitsConfirmed, needed: view.unitsNeeded })}
      </Text>
      {isOpen ? (
        <>
          <Button
            label={t("alert.canHelp")}
            onPress={() =>
              router.push(me ? "/(app)/alerts" : "/(onboarding)/sign-in")
            }
          />
          <Button
            label={t("report.title")}
            variant="ghost"
            onPress={() => router.push("/(app)/report")}
          />
        </>
      ) : (
        <Text style={styles.body}>{CLOSED_MESSAGE[lang]}</Text>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
});
