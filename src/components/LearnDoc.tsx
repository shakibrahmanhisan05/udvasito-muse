import React from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { Markdown, type MarkdownBlock } from "./Markdown";
import { colors, spacing, typography } from "@/theme/tokens";

export type LearnDocData = {
  meta: Record<string, string>;
  blocks: MarkdownBlock[];
};

/**
 * Shared body for SCR-P03/P04 (F-1003/F-1004): the team's Markdown
 * (src/content/<lang>/*.md via content:build), the specced
 * not-medical-advice line on every page, and the frontmatter
 * reviewedBy status line verbatim (draft until DEP-03 lands).
 */
export function LearnDoc(props: { doc: LearnDocData; children?: React.ReactNode }) {
  const { t } = useTranslation();
  return (
    <>
      <Markdown blocks={props.doc.blocks} />
      {props.children}
      <View style={styles.footer}>
        <Text style={styles.help}>{t("common.notMedicalAdvice")}</Text>
        {props.doc.meta.reviewedBy ? (
          <Text style={styles.help}>{props.doc.meta.reviewedBy}</Text>
        ) : null}
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  footer: { gap: spacing.xs, marginTop: spacing.lg },
  help: { ...typography.small, color: colors.text.muted },
});
