import React, { useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useAction, useQuery } from "convex/react";
import { Button } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";

/**
 * Weekly summary (F-908, A10, switch `weeklySummary`) — aggregates
 * only, delivered in the admin panel. The paragraph is deterministic
 * by default; "Rewrite with AI" asks the server action, which may
 * rephrase the same numbers when the summary AI feature is on and
 * falls back to the template otherwise. Chrome is unkeyed — consts.
 */

const TITLE = "Weekly summary";
const REWRITE = "Rewrite with AI";
const THIS_WEEK = "This week";
const LAST_WEEK = "Last week";

type Aggregates = {
  requestsCreated: number;
  requestsCreatedPrev: number;
  requestsClosed: number;
  requestsClosedPrev: number;
  donationsConfirmed: number;
  donationsConfirmedPrev: number;
  newDonors: number;
  newDonorsPrev: number;
  newMembers: number;
  newMembersPrev: number;
  liveDonorsNow: number;
  openRequestsNow: number;
};

const ROWS: { label: string; now: keyof Aggregates; prev: keyof Aggregates }[] = [
  { label: "New requests", now: "requestsCreated", prev: "requestsCreatedPrev" },
  { label: "Requests closed", now: "requestsClosed", prev: "requestsClosedPrev" },
  { label: "Donations confirmed", now: "donationsConfirmed", prev: "donationsConfirmedPrev" },
  { label: "New donors", now: "newDonors", prev: "newDonorsPrev" },
  { label: "New members", now: "newMembers", prev: "newMembersPrev" },
];

export default function AdminSummary() {
  const data = useQuery(refs.adminSummaryCurrent, isAuthConfigured ? {} : "skip") as
    | { aggregates: Aggregates; paragraph: string }
    | null
    | undefined;
  const narrate = useAction(refs.adminSummaryNarrate);
  const [paragraph, setParagraph] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const a = data?.aggregates;

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {TITLE}
      </Text>
      {a ? (
        <>
          <View style={styles.card}>
            <Text style={styles.bodyStrong}>{`${THIS_WEEK} / ${LAST_WEEK}`}</Text>
            {ROWS.map((row) => (
              <Text key={row.label} style={styles.body}>
                {`${row.label}: ${a[row.now]} / ${a[row.prev]}`}
              </Text>
            ))}
            <Text style={styles.body}>
              {`Live donors now: ${a.liveDonorsNow} • Open requests now: ${a.openRequestsNow}`}
            </Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.body}>{paragraph ?? data?.paragraph}</Text>
            <Button
              label={REWRITE}
              variant="secondary"
              loading={busy}
              onPress={() => {
                setBusy(true);
                void (async () => {
                  try {
                    const out = (await narrate({})) as { paragraph: string };
                    setParagraph(out.paragraph);
                  } finally {
                    setBusy(false);
                  }
                })();
              }}
            />
          </View>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  bodyStrong: { ...typography.bodyStrong, color: colors.text.primary },
  card: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
  },
});
