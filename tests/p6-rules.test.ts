import { describe, expect, it } from "vitest";
import { decisionActionText } from "../convex/rules/moderation";

/**
 * NTF-14 wording truthfulness (P5 review F1): for every decision ×
 * freeze-state combination, the action text the affected person
 * receives must match what actually happened to their account/request.
 */
describe("P6 rules — moderation NTF-14 action wording", () => {
  const none = { account: false, reveals: false };
  const acct = { account: true, reveals: false };
  const rev = { account: false, reveals: true };
  const both = { account: true, reveals: true };

  it("dismiss with no freeze keeps the original truthful text", () => {
    expect(decisionActionText("dismiss", none)).toBe("Report reviewed — no action taken");
    expect(decisionActionText("warn", none)).toBe("Warning");
  });

  it("dismiss + keep NEVER says 'no action taken' while a freeze persists", () => {
    const a = decisionActionText("dismiss", acct, "keep");
    expect(a).not.toContain("no action taken");
    expect(a).toContain("stays frozen");
    const r = decisionActionText("dismiss", rev, "keep");
    expect(r).not.toContain("no action taken");
    expect(r).toContain("stays paused");
    const b = decisionActionText("dismiss", both, "keep");
    expect(b).toContain("stays frozen");
    expect(b).toContain("stays paused");
  });

  it("dismiss + lift says the freeze was lifted", () => {
    expect(decisionActionText("dismiss", acct, "lift")).toContain("account freeze lifted");
    expect(decisionActionText("dismiss", rev, "lift")).toContain("resumed");
    const b = decisionActionText("dismiss", both, "lift");
    expect(b).toContain("account freeze lifted");
    expect(b).toContain("resumed");
  });

  it("warn mirrors the same freeze outcomes", () => {
    expect(decisionActionText("warn", acct, "keep")).toBe("Warning — account stays frozen");
    expect(decisionActionText("warn", acct, "lift")).toBe("Warning — account freeze lifted");
    expect(decisionActionText("warn", rev, "keep")).toContain("stays paused");
    expect(decisionActionText("warn", rev, "lift")).toContain("resumed");
  });

  it("state-changing decisions keep their established wording", () => {
    expect(decisionActionText("hide_request", none)).toBe("Request removed");
    expect(decisionActionText("suspend", acct, "keep")).toBe("Account suspended");
    expect(decisionActionText("ban", none)).toBe("Account banned");
    expect(decisionActionText("restore", acct, "lift")).toBe("Account restored");
  });
});
