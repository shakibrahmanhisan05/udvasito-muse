import * as Sentry from "@sentry/react-native";
import { scrubValue } from "./scrub";

/**
 * Sentry initialisation (ADR-018). The beforeSend/beforeBreadcrumb
 * scrubber removes phone numbers, emails and credentials from every
 * event — it must stay on (CLAUDE.md rule 3, specs §7.4).
 * Without EXPO_PUBLIC_SENTRY_DSN, Sentry stays disabled (never fake data).
 */
export function initSentry(): void {
  const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;
  if (!dsn) return;
  Sentry.init({
    dsn,
    beforeSend(event) {
      return scrubValue(event);
    },
    beforeBreadcrumb(breadcrumb) {
      return scrubValue(breadcrumb);
    },
  });
}

export { Sentry };
