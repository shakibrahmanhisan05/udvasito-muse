import React from "react";
import { useTranslation } from "react-i18next";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors, radius, touch } from "../theme/tokens";
import { setLanguage, type AppLanguage } from "../lib/i18n";

/** CMP-LanguageToggle (specs §1.3.5): two-segment বাংলা / EN in every header. */
function Segment(props: {
  lang: AppLanguage;
  label: string;
  current: AppLanguage;
  onSelect: (lang: AppLanguage) => void;
}) {
  const active = props.current === props.lang;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={props.label}
      accessibilityState={{ selected: active }}
      onPress={() => props.onSelect(props.lang)}
      style={[styles.segment, active && styles.segmentActive]}
    >
      <Text style={[styles.label, active && styles.labelActive]}>{props.label}</Text>
    </Pressable>
  );
}

export function LanguageToggle() {
  const { i18n } = useTranslation();
  const current: AppLanguage = i18n.language === "bn" ? "bn" : "en";
  return (
    <View style={styles.row}>
      <Segment lang="bn" label="বাংলা" current={current} onSelect={(l) => void setLanguage(l)} />
      <Segment lang="en" label="EN" current={current} onSelect={(l) => void setLanguage(l)} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", borderWidth: 1, borderColor: colors.border.subtle, borderRadius: radius.pill, overflow: "hidden" },
  segment: { minHeight: touch.min, minWidth: 56, alignItems: "center", justifyContent: "center", paddingHorizontal: 10, backgroundColor: "#fff" },
  segmentActive: { backgroundColor: colors.brand.primary },
  label: { fontSize: 14, color: colors.text.primary },
  labelActive: { color: "#fff", fontWeight: "600" },
});
