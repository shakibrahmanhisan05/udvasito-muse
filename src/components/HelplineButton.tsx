import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { Linking } from "react-native";
import { Button } from "./Button";
import { authClient } from "@/lib/auth-client";
import { fetchHelplinePublic, useHelpline } from "@/lib/helpline";

/**
 * Helpline button (D-R3). Signed in: number comes from the rate-limited
 * support.helpline query. Signed out: the number is fetched from
 * GET /public/helpline ONLY on tap, then the dialler opens — the number is
 * never in the bundle and never fetched on page load.
 */
export function HelplineButton(props: { label?: string }) {
  const { t } = useTranslation();
  const session = authClient.useSession();
  const signedIn = Boolean(session.data);
  const helpline = useHelpline(signedIn);
  const [busy, setBusy] = useState(false);

  if (signedIn) {
    if (!helpline) return null; // not configured → no dead control (§1.9)
    return (
      <Button
        label={props.label ?? t("signin.helplineCall", { phone: helpline.phone })}
        variant="secondary"
        onPress={() => void Linking.openURL(helpline.telUrl)}
      />
    );
  }
  return (
    <Button
      label={props.label ?? t("signin.helpline")}
      variant="secondary"
      loading={busy}
      onPress={() => {
        setBusy(true);
        void (async () => {
          const fetched = await fetchHelplinePublic();
          setBusy(false);
          if (fetched) await Linking.openURL(fetched.telUrl);
        })();
      }}
    />
  );
}
