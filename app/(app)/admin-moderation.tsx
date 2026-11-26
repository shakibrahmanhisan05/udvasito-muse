import React, { useState } from "react";
import { useRouter } from "expo-router";
import { ScrollView, StyleSheet, Text, TouchableOpacity } from "react-native";
import { useQuery } from "convex/react";
import { Button } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import type { Id } from "@/convex/_generated/dataModel";

type QueueRow = {
  itemId: Id<"moderationItems">;
  type: string;
  kind: string;
  severity: string;
  status: string;
  subjectName: string | null;
  subjectRole: string | null;
  autoAction: string | null;
  reportCount: number;
  createdAt: number;
  decision: string | null;
};

/**
 * SCR-A02 — Moderation queue (F-803). Open items first (severity,
 * then age, sorted server-side); decided items behind the toggle.
 * The screen title is specs §3.6 prose without an i18n key
 * (I18N-GAPS §4), rendered verbatim like the SCR-A03 decision
 * labels; the empty-state copy ("Nothing to review. 🎉") is likewise
 * unkeyed and therefore omitted rather than invented. No phone
 * numbers exist in this payload — by design.
 */
// Specs §3.6 prose without i18n keys (I18N-GAPS §4) — the screen
// title and the two queue states (which are also the server-side
// status values). Pending member 3's key review; rendered via
// variables like the SCR-A05 role/status values.
const TITLE = "Moderation queue";
const STATUS_OPEN = "open";
const STATUS_DECIDED = "decided";

export default function AdminModeration() {
  const router = useRouter();
  const [showDecided, setShowDecided] = useState(false);
  const items = useQuery(
    refs.moderationList,
    isAuthConfigured ? { status: showDecided ? "decided" : "open" } : "skip",
  ) as QueueRow[] | undefined;

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {TITLE}
      </Text>
      <Button
        label={showDecided ? STATUS_OPEN : STATUS_DECIDED}
        variant="secondary"
        onPress={() => setShowDecided((v) => !v)}
      />
      {(items ?? []).map((item) => (
        <TouchableOpacity
          key={item.itemId}
          style={styles.card}
          accessibilityRole="button"
          onPress={() =>
            router.push({
              pathname: "/(app)/admin-moderation-item",
              params: { id: item.itemId },
            })
          }
        >
          <Text style={styles.bodyStrong}>
            {item.kind} • {item.severity}
          </Text>
          <Text style={styles.body}>{item.subjectName ?? ""}</Text>
          <Text style={styles.help}>
            {item.type} • {item.reportCount} • {new Date(item.createdAt).toLocaleString()}
            {item.autoAction ? ` • ${item.autoAction}` : ""}
            {item.decision ? ` • ${item.decision}` : ""}
          </Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  bodyStrong: { ...typography.bodyStrong, color: colors.text.primary },
  help: { ...typography.small, color: colors.text.muted },
  card: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
});
