/**
 * Moderation decision helpers (pure TypeScript, unit-tested) — the
 * NTF-14 action wording for admin.moderation.decide (specs §3.6
 * SCR-A03, §6.4 F-803).
 *
 * SCR-A03: a decision "closes the item and lifts or keeps automatic
 * freezes as chosen". The P2 auto-actions (PRD §5.8) an item can carry
 * are an account freeze ("asked for money") and a request reveals
 * freeze (a confirmed donor's "fake request"). The wording the
 * affected person receives must be TRUE of their resulting state:
 * the P5 text "Report reviewed — no action taken" was a lie whenever
 * a freeze stayed in place (P5 review F1), so the action string is
 * built from the actual freeze outcome.
 */

export type FreezeKind = "account" | "reveals";
export type FreezeChoice = "lift" | "keep";

export type FreezeState = {
  /** An auto account freeze from this item is currently in place. */
  account: boolean;
  /** An auto reveals freeze from this item is currently in place. */
  reveals: boolean;
};

export function anyFreeze(freezes: FreezeState): boolean {
  return freezes.account || freezes.reveals;
}

function freezeClauses(freezes: FreezeState, choice: FreezeChoice): string[] {
  const clauses: string[] = [];
  if (freezes.account) {
    clauses.push(choice === "lift" ? "account freeze lifted" : "account stays frozen");
  }
  if (freezes.reveals) {
    clauses.push(
      choice === "lift"
        ? "number sharing on the request resumed"
        : "number sharing on the request stays paused",
    );
  }
  return clauses;
}

/**
 * The NTF-14 `{{action}}` text for a decision. For dismiss/warn with
 * auto-freezes in place, `choice` is the moderator's explicit lift/keep
 * choice (the server requires it in that case); the returned text
 * states exactly what happened to each freeze.
 */
export function decisionActionText(
  decision: string,
  freezes: FreezeState,
  choice?: FreezeChoice,
): string {
  if (decision === "dismiss" || decision === "warn") {
    const base = decision === "dismiss" ? "Report reviewed" : "Warning";
    if (!anyFreeze(freezes)) {
      return decision === "dismiss" ? "Report reviewed — no action taken" : "Warning";
    }
    const clauses = freezeClauses(freezes, choice ?? "keep");
    return `${base} — ${clauses.join("; ")}`;
  }
  switch (decision) {
    case "hide_request":
      return "Request removed";
    case "suspend":
      return "Account suspended";
    case "ban":
      return "Account banned";
    case "restore":
      return "Account restored";
    default:
      return "Report reviewed";
  }
}
