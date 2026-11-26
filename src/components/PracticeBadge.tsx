import React from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius } from "../theme/tokens";

/** CMP-PracticeBadge (specs §1.3.5): PRACTICE pill on practice-area screens. */
export function PracticeBadge() {
  const { t } = useTranslation();
  return (
    <View style={styles.pill}>
      <Text style={styles.text}>{t("common.demo")}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: { backgroundColor: colors.status.warningBg, borderRadius: radius.pill, paddingHorizontal: 10, paddingVertical: 4 },
  text: { color: colors.status.warning, fontSize: 12, fontWeight: "700" },
});
