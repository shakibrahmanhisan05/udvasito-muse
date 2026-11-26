import React, { useEffect, useState } from "react";
import { Redirect } from "expo-router";
import { View } from "react-native";
import { getLocalConsent } from "@/lib/consent";
import { FALLBACK_APP_CONFIG } from "@/lib/appConfig";
import { Skeleton } from "@/components";

/**
 * SCR-P01 entry (P0/P1 posture): the public landing page arrives in P6;
 * until then `/` routes to /welcome (no consent yet) or the app home
 * (roadmap P1: "web / redirects to /welcome or /home until P6").
 */
export default function Index() {
  const [target, setTarget] = useState<"/(onboarding)/welcome" | "/(app)/home" | null>(null);
  useEffect(() => {
    void (async () => {
      const local = await getLocalConsent();
      setTarget(
        local && local.consentVersion === FALLBACK_APP_CONFIG.consentVersion
          ? "/(app)/home"
          : "/(onboarding)/welcome",
      );
    })();
  }, []);
  if (!target) {
    return (
      <View style={{ flex: 1, padding: 16, backgroundColor: "#fff" }}>
        <Skeleton height={28} width="60%" />
        <Skeleton height={120} />
      </View>
    );
  }
  return <Redirect href={target} />;
}
