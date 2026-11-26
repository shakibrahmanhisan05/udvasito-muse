import React from "react";
import { StyleSheet, View } from "react-native";
import { colors, radius } from "../theme/tokens";

/** CMP-Skeleton (specs §1.3.5): grey blocks matching the final layout. */
export function Skeleton(props: { height?: number; width?: number | `${number}%` }) {
  return (
    <View
      accessibilityElementsHidden
      style={[styles.block, { height: props.height ?? 20, width: props.width ?? "100%" }]}
    />
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: colors.bg.surface, borderRadius: radius.input, marginVertical: 4 },
});
