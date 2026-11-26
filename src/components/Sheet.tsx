import React from "react";
import { Modal, Pressable, StyleSheet, Text } from "react-native";
import { colors, radius, spacing, typography } from "../theme/tokens";

/**
 * CMP-Sheet / CMP-Dialog (specs §1.3.5): accessible modal — title announced,
 * backdrop/back closes. Focus trapping on web is completed with the screens
 * that need it in later phases.
 */
export function Sheet(props: {
  visible: boolean;
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <Modal
      visible={props.visible}
      transparent
      animationType="slide"
      onRequestClose={props.onClose}
    >
      <Pressable
        style={styles.backdrop}
        onPress={props.onClose}
        accessibilityRole="button"
        accessibilityLabel={props.title}
      >
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <Text accessibilityRole="header" style={styles.title}>
            {props.title}
          </Text>
          {props.children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: "rgba(17,24,39,0.45)", justifyContent: "flex-end" },
  sheet: {
    backgroundColor: colors.bg.app,
    borderTopLeftRadius: radius.card,
    borderTopRightRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
    maxHeight: "85%",
  },
  title: { ...typography.heading, color: colors.text.primary },
});
