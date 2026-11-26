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
import learnEn from "../../src/content/generated/en/learn.json";
import learnBn from "../../src/content/generated/bn/learn.json";

/**
 * SCR-P03 — Learn (F-1003, if-time; behind features.learnPages).
 * Content: src/content/<lang>/learn.md (team draft, DEP-03) rendered
 * by CMP-Markdown via the generated JSON. While the switch is off the
 * page does not exist (not-found state), per the features contract.
 */
export default function Learn() {
  const { t, i18n } = useTranslation();
  const router = useRouter();
  const appConfig = useQuery(refs.appConfig, isAuthConfigured ? {} : "skip");
  const doc = (i18n.language === "bn" ? learnBn : learnEn) as LearnDocData;

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
      <LearnDoc doc={doc} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { fontSize: 22, fontWeight: "700", color: colors.text.primary },
});
