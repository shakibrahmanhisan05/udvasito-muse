import React, { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocalSearchParams } from "expo-router";
import {
  Image, Platform, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View,
} from "react-native";
import { useAction, useQuery } from "convex/react";
import { Banner, Button, Skeleton, useToast } from "@/components";
import { colors, radius, spacing, typography } from "@/theme/tokens";
import { isAuthConfigured } from "@/lib/auth-client";
import { refs } from "@/lib/refs";
import { errorText } from "@/lib/errors";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * SCR-M05 — Share request (F-1005, if-time; behind
 * features.sharedLinks). Preview image (Cloudinary card or the
 * template fallback), editable appeal text, the add-my-number toggle
 * (OFF by default — the number is never in the image and joins the
 * text only on the owner's explicit opt-in), Share via the platform
 * share sheet / Web Share API, and Copy buttons where a clipboard
 * exists (web). Copy labels reuse common.copyNumber-style chrome —
 * "Copy link"/"Copy text" have no keys in specs §4; flagged in
 * docs/dev/I18N-GAPS.md by the P7 report.
 */
const COPY_LINK = "Copy link";
const COPY_TEXT = "Copy text";
const CHECKED = "☑";
const UNCHECKED = "☐";

export default function RequestShare() {
  const { t, i18n } = useTranslation();
  const lang = i18n.language === "bn" ? "bn" : "en";
  const params = useLocalSearchParams<{ id: string }>();
  const toast = useToast();
  const appConfig = useQuery(refs.appConfig, isAuthConfigured ? {} : "skip");
  const shareCard = useAction(refs.requestsShareCard);
  const [includeNumber, setIncludeNumber] = useState(false);
  const [card, setCard] = useState<{ imageUrl: string; text: string; link: string } | null>(null);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const enabled = appConfig?.features?.sharedLinks === true;

  useEffect(() => {
    if (!enabled || !params.id) return;
    let alive = true;
    void (async () => {
      try {
        const result = await shareCard({
          requestId: params.id as Id<"requests">,
          lang,
          includeMyNumber: includeNumber,
        });
        if (!alive) return;
        setCard(result);
        setText(result.text);
        setError(null);
      } catch (e) {
        if (alive) setError(errorText(t, e));
      }
    })();
    return () => {
      alive = false;
    };
    // Regenerate only when the feature flips on or the toggle flips.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, includeNumber]);

  if (appConfig === undefined) {
    return (
      <View style={styles.wrap}>
        <Skeleton height={28} width="60%" />
        <Skeleton height={200} />
      </View>
    );
  }
  if (!enabled) return null; // feature off → the screen is inert

  const copy = (value: string) => {
    if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
      void navigator.clipboard.writeText(value).then(() => toast.show(t("common.copied")));
    }
  };

  const share = () => {
    if (!card) return;
    if (Platform.OS === "web" && typeof navigator !== "undefined" && "share" in navigator) {
      void navigator.share({ text, url: card.link }).catch(() => undefined);
      return;
    }
    void Share.share({ message: text, url: card.link }).catch(() => undefined);
  };

  return (
    <ScrollView contentContainerStyle={styles.wrap}>
      <Text accessibilityRole="header" style={styles.title}>
        {t("share.title")}
      </Text>
      {error ? <Banner kind="error" icon="⚠" text={error} /> : null}
      {card ? (
        <>
          <Image
            source={{ uri: card.imageUrl }}
            style={styles.card}
            accessibilityLabel={t("share.title")}
          />
          <TextInput
            style={styles.textBox}
            value={text}
            onChangeText={setText}
            multiline
            accessibilityLabel={t("share.title")}
          />
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: includeNumber }}
            onPress={() => setIncludeNumber((v) => !v)}
            style={styles.toggleRow}
          >
            <Text style={styles.toggleMark}>{includeNumber ? CHECKED : UNCHECKED}</Text>
            <Text style={styles.body}>{t("share.addMyNumber")}</Text>
          </Pressable>
          <Button label={t("request.share")} onPress={share} />
          {Platform.OS === "web" ? (
            <>
              <Button label={COPY_LINK} variant="secondary" onPress={() => copy(card.link)} />
              <Button label={COPY_TEXT} variant="ghost" onPress={() => copy(text)} />
            </>
          ) : null}
        </>
      ) : (
        <Skeleton height={200} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { padding: spacing.lg, gap: spacing.md },
  title: { ...typography.title, color: colors.text.primary },
  body: { ...typography.body, color: colors.text.primary },
  card: { width: "100%", aspectRatio: 1.91, borderRadius: radius.card, backgroundColor: colors.bg.surface },
  textBox: {
    ...typography.body,
    color: colors.text.primary,
    borderWidth: 1,
    borderColor: colors.border.input,
    borderRadius: radius.card,
    padding: spacing.md,
    minHeight: 110,
    textAlignVertical: "top",
  },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: 48 },
  toggleMark: { ...typography.title, color: colors.text.primary },
});
