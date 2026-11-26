import React from "react";
import { useTranslation } from "react-i18next";
import { Banner } from "./Banner";

/**
 * Safety card shown on every screen where a phone number is revealed
 * (specs SCR-M03/D04 must-cover): the never-pay-money warning.
 */
export function SafetyCard() {
  const { t } = useTranslation();
  return <Banner kind="warning" icon="⚠" text={t("safety.money")} />;
}
