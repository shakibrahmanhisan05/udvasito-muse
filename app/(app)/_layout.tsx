import React from "react";
import { useTranslation } from "react-i18next";
import { Tabs } from "expo-router";
import { House, Menu } from "lucide-react-native";
import { colors } from "@/theme/tokens";

/**
 * Signed-in tab layout (specs §1.4.1). P0 ships only the tabs whose screens
 * exist and work — Home and More. Requests / Donate / Volunteer / Admin tabs
 * appear in the phases that build their screens (specs §1.9: an unfinished
 * feature is invisible, never a dead tab).
 */
export default function AppLayout() {
  const { t } = useTranslation();
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.brand.primary,
        tabBarInactiveTintColor: colors.text.muted,
        headerShown: false,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: t("nav.home"),
          tabBarIcon: ({ color, size }) => <House color={color} size={size} />,
          tabBarAccessibilityLabel: t("nav.home"),
        }}
      />
      <Tabs.Screen
        name="more"
        options={{
          title: t("nav.more"),
          tabBarIcon: ({ color, size }) => <Menu color={color} size={size} />,
          tabBarAccessibilityLabel: t("nav.more"),
        }}
      />
    </Tabs>
  );
}
