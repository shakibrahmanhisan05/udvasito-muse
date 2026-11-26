import React from "react";
import { useTranslation } from "react-i18next";
import { Tabs } from "expo-router";
import { ClipboardList, Droplet, HandHeart, House, Menu } from "lucide-react-native";
import { useQuery } from "convex/react";
import { colors } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";

/**
 * Signed-in tab layout (specs §1.4.1): Home / Requests / Donate (badge =
 * unanswered alerts) / Volunteer (approved volunteers + admins) / More.
 * The Admin tab arrives in P4 with its screens (specs §1.9: an unfinished
 * feature is invisible, never a dead tab).
 */
export default function AppLayout() {
  const { t } = useTranslation();
  const me = useQuery(refs.me, isAuthConfigured ? {} : "skip");
  const inbox = useQuery(refs.responsesInbox, isAuthConfigured && me?.donor ? {} : "skip");
  const unanswered = inbox?.needsAnswer.length ?? 0;
  const showVolunteer =
    me?.role === "volunteer" || me?.role === "admin" || me?.role === "super_admin";

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
        name="requests"
        options={{
          title: t("nav.requests"),
          tabBarIcon: ({ color, size }) => <ClipboardList color={color} size={size} />,
          tabBarAccessibilityLabel: t("nav.requests"),
        }}
      />
      <Tabs.Screen
        name="donor"
        options={{
          title: t("nav.donate"),
          tabBarIcon: ({ color, size }) => <Droplet color={color} size={size} />,
          tabBarAccessibilityLabel: t("nav.donate"),
          tabBarBadge: unanswered > 0 ? unanswered : undefined,
        }}
      />
      <Tabs.Screen
        name="volunteer"
        options={{
          title: t("nav.volunteer"),
          tabBarIcon: ({ color, size }) => <HandHeart color={color} size={size} />,
          tabBarAccessibilityLabel: t("nav.volunteer"),
          href: showVolunteer ? undefined : null,
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
      {/* Non-tab routes inside the signed-in area. */}
      <Tabs.Screen name="request-new" options={{ href: null }} />
      <Tabs.Screen name="request-live" options={{ href: null }} />
      <Tabs.Screen name="donor-setup" options={{ href: null }} />
      <Tabs.Screen name="donor/alert-guide" options={{ href: null }} />
      <Tabs.Screen name="alerts" options={{ href: null }} />
      <Tabs.Screen name="alert-detail" options={{ href: null }} />
      <Tabs.Screen name="settings" options={{ href: null }} />
      <Tabs.Screen name="verify-in-person" options={{ href: null }} />
      <Tabs.Screen name="volunteer-apply" options={{ href: null }} />
      <Tabs.Screen name="volunteer-request" options={{ href: null }} />
      <Tabs.Screen name="admin-people" options={{ href: null }} />
      <Tabs.Screen name="admin-person" options={{ href: null }} />
      <Tabs.Screen name="admin" options={{ href: null }} />
      <Tabs.Screen name="admin-moderation" options={{ href: null }} />
      <Tabs.Screen name="admin-moderation-item" options={{ href: null }} />
      <Tabs.Screen name="admin-audit" options={{ href: null }} />
      <Tabs.Screen name="admin-ai" options={{ href: null }} />
      <Tabs.Screen name="admin-usage" options={{ href: null }} />
      <Tabs.Screen name="admin-demo" options={{ href: null }} />
      <Tabs.Screen name="admin-settings" options={{ href: null }} />
      <Tabs.Screen name="my-data" options={{ href: null }} />
    </Tabs>
  );
}
