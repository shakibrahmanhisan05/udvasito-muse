import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Doc } from "../schemaTypes";
import { getSetting } from "./settings";
import { ageOn } from "../rules/eligibility";

type Ctx = GenericMutationCtx<DataModel> | GenericQueryCtx<DataModel>;
type Profile = Doc<"profiles">;
type Donor = Doc<"donorProfiles">;

export type NotLiveReason = "phone" | "consent" | "group" | "hidden" | "status" | "age";

/**
 * donorProfiles.live — derived value (specs §5.4): phone verified ∧ health
 * consent current ∧ group ≠ unknown ∧ ¬hidden ∧ profile status active ∧
 * age within S-01..S-02. Recomputed (and persisted, since matching reads
 * the `live` index) whenever any input changes: donor setup, phone
 * verification, phone revocation.
 */
export async function computeDonorLive(
  ctx: Ctx,
  profile: Profile,
  donor: Donor,
): Promise<{ live: boolean; notLiveReasons: NotLiveReason[] }> {
  const reasons: NotLiveReason[] = [];
  if (!profile.phoneVerified) reasons.push("phone");
  const consentVersion = await getSetting<string>(ctx, "consentVersion");
  if (donor.healthConsentVersion !== consentVersion) reasons.push("consent");
  if (donor.bloodGroup === "unknown") reasons.push("group");
  if (donor.hidden) reasons.push("hidden");
  if (profile.status !== "active") reasons.push("status");
  const [minAge, maxDonorAge] = await Promise.all([
    getSetting<number>(ctx, "minAge"),
    getSetting<number>(ctx, "maxDonorAge"),
  ]);
  const age = ageOn(profile.dateOfBirth, Date.now());
  if (age < minAge || age > maxDonorAge) reasons.push("age");
  return { live: reasons.length === 0, notLiveReasons: reasons };
}

/** Recompute and persist `live` for a donor profile; returns the result. */
export async function refreshDonorLive(
  ctx: GenericMutationCtx<DataModel>,
  profile: Profile,
  donor: Donor,
): Promise<{ live: boolean; notLiveReasons: NotLiveReason[] }> {
  const result = await computeDonorLive(ctx, profile, donor);
  if (donor.live !== result.live) {
    await ctx.db.patch(donor._id, { live: result.live });
  }
  return result;
}
