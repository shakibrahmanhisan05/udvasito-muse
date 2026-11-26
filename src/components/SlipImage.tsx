import React, { useEffect, useState } from "react";
import { Image, Platform, StyleSheet, Text, View } from "react-native";
import { colors, spacing, typography } from "@/theme/tokens";
import { authClient, convexSiteUrl } from "@/lib/auth-client";

/**
 * A request's slip photo (F-209/F-706) — served ONLY by
 * GET /slip/:requestId with the session Bearer token (audited
 * server-side per view). Web fetches a blob URL; native passes the
 * Authorization header through the Image source. The watermark is
 * the specs §3.2 SCR-V04 line, shown in the volunteer check view.
 */
const WATERMARK = "UDVASITO — for verification only";

type TokenClient = {
  convex: { token: () => Promise<{ data?: { token?: string } | null }> };
};

async function sessionToken(): Promise<string | null> {
  try {
    const res = await (authClient as unknown as TokenClient).convex.token();
    return res.data?.token ?? null;
  } catch {
    return null;
  }
}

export function SlipImage(props: { requestId: string; watermark?: boolean }) {
  const [uri, setUri] = useState<string | null>(null);
  const [headers, setHeaders] = useState<Record<string, string> | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    let objectUrl: string | null = null;
    void (async () => {
      const token = await sessionToken();
      if (!token || !convexSiteUrl) return;
      const url = `${convexSiteUrl}/slip/${props.requestId}`;
      if (Platform.OS === "web") {
        try {
          const res = await fetch(url, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (!res.ok) return;
          const blob = await res.blob();
          objectUrl = URL.createObjectURL(blob);
          if (alive) setUri(objectUrl);
        } catch {
          // leave the placeholder — the photo stays private either way
        }
      } else if (alive) {
        setUri(url);
        setHeaders({ Authorization: `Bearer ${token}` });
      }
    })();
    return () => {
      alive = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [props.requestId]);

  if (!uri) return <View style={styles.placeholder} />;
  return (
    <View>
      <Image
        source={{ uri, headers }}
        style={styles.image}
        resizeMode="contain"
        accessibilityLabel={WATERMARK}
      />
      {props.watermark ? <Text style={styles.watermark}>{WATERMARK}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  image: { width: "100%", height: 320, backgroundColor: colors.bg.surface },
  placeholder: { width: "100%", height: 200, backgroundColor: colors.bg.surface },
  watermark: {
    ...typography.small,
    color: colors.text.muted,
    textAlign: "center",
    padding: spacing.xs,
  },
});
