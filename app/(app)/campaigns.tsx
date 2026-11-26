import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ScrollView, Share, StyleSheet, Text, TextInput, View } from "react-native";
import { useConvex, useMutation, useQuery } from "convex/react";
import QRCode from "react-native-qrcode-svg";
import { Banner, Button, Skeleton } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { errorText } from "@/lib/errors";
import { APP_ORIGIN } from "@/lib/links";

/**
 * Campus campaigns (F-708 / V07) — behind features.campaignStats.
 * Volunteers show the QR/link for a campaign at a drive; the link
 * lands on onboarding with ?c=<code>, and the server attributes the
 * sign-up only when the campaign is active. Admins additionally see
 * per-campaign sign-ups / live donors and can create or pause
 * campaigns. No campaign copy is keyed in specs §4 — the chrome below
 * is held in consts and flagged in docs/dev/I18N-GAPS.md (P7 report).
 */
const TITLE = "Campus campaigns";
const SIGNUPS = "sign-ups";
const DONORS_READY = "donors ready";
const NEW_CAMPAIGN = "New campaign";
const CODE_LABEL = "Code (e.g. cu-drive-1)";
const NAME_LABEL = "Campaign name";
const INSTITUTION_LABEL = "Institution (optional)";
const CREATE = "Create campaign";
const PAUSE = "Pause";
const RESUME = "Resume";
const SHARE_LINK = "Share link";
const INACTIVE = "Paused";

type Campaign = { code: string; name: string; institution: string | null; active: boolean };
type Stat = Campaign & { signups: number; donorsLive: number };

export default function Campaigns() {
  const { t } = useTranslation();
  const convex = useConvex();
  const appConfig = useQuery(refs.appConfig, isAuthConfigured ? {} : "skip");
  const me = useQuery(refs.me, isAuthConfigured ? {} : "skip");
  const create = useMutation(refs.campaignsCreate);
  const setActive = useMutation(refs.campaignsSetActive);
  const [rows, setRows] = useState<Stat[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const enabled = appConfig?.features?.campaignStats === true;
  const isAdmin = me?.role === "admin" || me?.role === "superadmin";

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void (async () => {
      try {
        const list = (await convex.query(refs.campaignsList, {})) as Campaign[];
        let merged: Stat[] = list.map((c) => ({ ...c, signups: 0, donorsLive: 0 }));
        if (isAdmin) {
          const stats = (await convex.query(refs.campaignsStats, {})) as Stat[];
          const byCode = new Map(stats.map((s) => [s.code, s]));
          merged = list.map((c) => byCode.get(c.code) ?? { ...c, signups: 0, donorsLive: 0 });
        }
        if (alive) setRows(merged);
      } catch (e) {
        if (alive) setError(errorText(t, e));
      }
    })();
    return () => {
      alive = false;
    };
  }, [convex, enabled, isAdmin, refreshKey, t]);

  if (!enabled) return null; // feature off → inert

  const run = (fn: () => Promise<unknown>) => {
    setError(null);
    void fn()
      .then(() => setRefreshKey((k) => k + 1))
      .catch((e) => setError(errorText(t, e)));
  };

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {TITLE}
      </Text>
      {error ? <Banner kind="error" icon="⚠" text={error} /> : null}
      {rows === null ? (
        <Skeleton height={160} />
      ) : (
        rows.map((c) => {
          const link = `${APP_ORIGIN}/onboarding?c=${c.code}`;
          return (
            <View key={c.code} style={styles.card}>
              <Text style={styles.bodyStrong}>{c.name}</Text>
              {c.institution ? <Text style={styles.help}>{c.institution}</Text> : null}
              {!c.active ? <Text style={styles.help}>{INACTIVE}</Text> : null}
              {isAdmin ? (
                <Text style={styles.body}>
                  {c.signups} {SIGNUPS} • {c.donorsLive} {DONORS_READY}
                </Text>
              ) : null}
              {c.active ? (
                <>
                  <View style={styles.qrWrap}>
                    <QRCode value={link} size={180} />
                  </View>
                  <Text style={styles.help}>{link}</Text>
                  <Button
                    label={SHARE_LINK}
                    variant="secondary"
                    onPress={() => void Share.share({ message: link, url: link }).catch(() => undefined)}
                  />
                </>
              ) : null}
              {isAdmin ? (
                <Button
                  label={c.active ? PAUSE : RESUME}
                  variant="ghost"
                  onPress={() => run(() => setActive({ code: c.code, active: !c.active }))}
                />
              ) : null}
            </View>
          );
        })
      )}
      {isAdmin ? (
        <View style={styles.card}>
          <Text style={styles.bodyStrong}>{NEW_CAMPAIGN}</Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            placeholder={CODE_LABEL}
            accessibilityLabel={CODE_LABEL}
            autoCapitalize="none"
          />
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder={NAME_LABEL}
            accessibilityLabel={NAME_LABEL}
          />
          <TextInput
            style={styles.input}
            value={institution}
            onChangeText={setInstitution}
            placeholder={INSTITUTION_LABEL}
            accessibilityLabel={INSTITUTION_LABEL}
          />
          <Button
            label={CREATE}
            onPress={() =>
              run(async () => {
                await create({
                  code: code.trim(),
                  name: name.trim(),
                  institution: institution.trim() || undefined,
                });
                setCode("");
                setName("");
                setInstitution("");
              })
            }
          />
        </View>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.lg, backgroundColor: colors.bg.app, flexGrow: 1 },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  bodyStrong: { ...typography.body, color: colors.text.primary, fontWeight: "700" },
  help: { ...typography.small, color: colors.text.muted },
  card: {
    backgroundColor: colors.bg.surface,
    borderRadius: radius.card,
    padding: spacing.md,
    gap: spacing.sm,
  },
  qrWrap: { alignItems: "center", padding: spacing.md, backgroundColor: "#FFFFFF", borderRadius: radius.card },
  input: {
    ...typography.body,
    color: colors.text.primary,
    borderWidth: 1,
    borderColor: colors.border.input,
    borderRadius: radius.input,
    padding: spacing.md,
    minHeight: 52,
  },
});
