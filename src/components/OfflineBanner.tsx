import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { StyleSheet, Text, View } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { colors, spacing, typography } from "../theme/tokens";

/** CMP-OfflineBanner (specs §1.3.5): sticky banner when offline + outbox count. */
export function OfflineBanner(props: { pendingCount?: number }) {
  const { t } = useTranslation();
  const [offline, setOffline] = useState(false);
  useEffect(() => NetInfo.addEventListener((s) => setOffline(!(s.isConnected ?? true))), []);
  if (!offline) return null;
  return (
    <View style={styles.wrap} accessibilityLiveRegion="polite">
      <Text style={styles.text}>
        {t("common.offline", { count: props.pendingCount ?? 0 })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { backgroundColor: colors.status.warningBg, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  text: { ...typography.small, color: colors.status.warning },
});
