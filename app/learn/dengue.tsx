import React from "react";
import { useTranslation } from "react-i18next";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useQuery } from "convex/react";
import { Button, Skeleton } from "@/components";
import { LearnDoc, type LearnDocData } from "@/components/LearnDoc";
import { colors, spacing } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import dengueEn from "../../src/content/generated/en/dengue.json";
import dengueBn from "../../src/content/generated/bn/dengue.json";

/**
 * SCR-P04 — Dengue & platelets (F-1004, if-time; behind
 * features.learnPages). Content: src/content/<lang>/dengue.md (team
 * draft, DEP-03). Specced CTAs: "Ask for platelets" (the keyed
 * home.dengueCta) → request form with the dengue option preselected;
 * "Become a platelet donor" → donor setup (label unkeyed in specs §4
 * — const below, flagged in the P7 gap list).
 */
const BECOME_PLATELET_DONOR = "Become a platelet donor";

export default function Dengue() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const appConfig = useQuery(refs.appConfig, isAuthConfigured ? {} : "skip");
  const doc = (i18n.language === "bn" ? dengueBn : dengueEn) as LearnDocData;

  if (appConfig === undefined) {
    return (
      <View style={styles.wrap}>
        <Skeleton height={200} />
      </View>
    );
  }
  if (appConfig?.features?.learnPages !== true) {
    return (
      <View style={styles.wrap}>
        <Text accessibilityRole="header" style={styles.title}>
          {t("notFound.title")}
        </Text>
        <Button label={t("notFound.home")} onPress={() => router.replace("/")} />
      </View>
    );
  }
  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <LearnDoc doc={doc}>
        <View style={styles.ctas}>
          <Button
            label={t("home.dengueCta")}
            onPress={() =>
              router.push({ pathname: "/(app)/request-new", params: { dengue: "1" } })
            }
          />
          <Button
            label={BECOME_PLATELET_DONOR}
            variant="secondary"
            onPress={() => router.push("/(app)/donor-setup")}
          />
        </View>
      </LearnDoc>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text.primary },
  ctas: { gap: spacing.md, marginTop: spacing.lg },
});
