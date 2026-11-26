import React from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, StyleSheet, Text } from "react-native";
import { Markdown, type MarkdownBlock } from "@/components";
import { colors, spacing, typography } from "@/theme/tokens";
import privacyEn from "../../src/content/generated/legal/privacy.en.json";
import privacyBn from "../../src/content/generated/legal/privacy.bn.json";

/** SCR-P06 — Privacy notice (Markdown content file, specs §3.7/§5.4). */
export default function Privacy() {
  const { i18n } = useTranslation();
  const doc = i18n.language === "bn" ? privacyBn : privacyEn;
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
