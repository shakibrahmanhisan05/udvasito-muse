import React from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text } from "react-native";
import { Markdown, type MarkdownBlock } from "@/components";
import { colors, spacing, typography } from "@/theme/tokens";
import termsEn from "../../src/content/generated/legal/terms.en.json";
import termsBn from "../../src/content/generated/legal/terms.bn.json";

/** SCR-P07 — Terms (Markdown content file, specs §3.7/§5.4). */
export default function Terms() {
  const { i18n } = useTranslation();
  const doc = i18n.language === "bn" ? termsBn : termsEn;
  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text style={styles.version}>
        {doc.meta.version} • {doc.meta.effective}
      </Text>
      <Markdown blocks={doc.blocks as MarkdownBlock[]} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.md, backgroundColor: colors.bg.app, flexGrow: 1 },
  version: { ...typography.small, color: colors.text.muted },
});
