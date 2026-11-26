import React, { createContext, useCallback, useContext, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radius, spacing, typography } from "../theme/tokens";

/**
 * CMP-Toast (specs §1.3.5): short confirmations. Never the only place an
 * error is shown — errors use CMP-ErrorState / CMP-Banner.
 */
const ToastCtx = createContext<{ show: (message: string) => void }>({ show: () => {} });
export const useToast = () => useContext(ToastCtx);

export function ToastProvider(props: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((m: string) => {
    setMessage(m);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 3000);
  }, []);
  return (
    <ToastCtx.Provider value={{ show }}>
      {props.children}
      {message ? (
        <View style={styles.wrap} accessibilityLiveRegion="polite" pointerEvents="none">
          <Text style={styles.text}>{message}</Text>
        </View>
      ) : null}
    </ToastCtx.Provider>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: "absolute",
    bottom: spacing.xl,
    alignSelf: "center",
    backgroundColor: colors.text.primary,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  text: { ...typography.small, color: "#fff" },
});
