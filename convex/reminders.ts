import { internalMutationGeneric } from "convex/server";
import { featureOn, getSetting } from "./_lib/settings";
import { notifyUser } from "./_lib/notify";

/**
 * Donor reminders (F-505/D11, switch `reminders`) — the daily job from
 * specs §6.6:
 * - NTF-11 "you can donate again from today" when a donor's whole-blood
 *   cooldown (eligibleFrom) has just passed;
 * - NTF-12 "still available?" when availability was last confirmed more
 *   than S-28 (availabilityNudgeDays) ago and the donor is still live.
 * Both are de-duplicated against the notifications table itself (no new
 * schema): a template is sent at most once per cooldown / per nudge
 * window. With the switch off the job is a no-op. Practice donors are
 * reminded inside the practice scope only (rows carry their isDemo).
 */

const DAY = 86_400_000;

export const daily = internalMutationGeneric({
  args: {},
  handler: async (ctx) => {
    if (!(await featureOn(ctx, "reminders"))) {
      return { eligibleAgain: 0, nudges: 0, skipped: "feature_off" as const };
    }
    const nudgeDays = await getSetting<number>(ctx, "availabilityNudgeDays");
    const now = Date.now();
    let eligibleAgain = 0;
    let nudges = 0;

    const donors = await ctx.db.query("donorProfiles").collect();
    for (const donor of donors) {
      const profile = await ctx.db.get(donor.profileId);
      if (!profile || profile.status !== "active") continue;
      const sent = await ctx.db
        .query("notifications")
        .withIndex("by_recipient", (q) => q.eq("recipientId", profile._id))
        .order("desc")
        .take(60);

      // NTF-11: cooldown ended within the last day and not yet celebrated.
      if (
        donor.eligibleFrom > 0 &&
        donor.eligibleFrom <= now &&
        donor.eligibleFrom > now - DAY &&
        !sent.some((n) => n.template === "NTF-11" && n._creationTime >= donor.eligibleFrom - DAY)
      ) {
        await notifyUser(ctx, {
          recipient: profile,
          template: "NTF-11",
          params: {},
          url: "/donor",
          channelId: "updates",
        });
        eligibleAgain++;
      }

      // NTF-12: availability confirmation older than S-28, donor still
      // marked available, and no nudge inside the current window.
      const staleSince = now - nudgeDays * DAY;
      if (
        donor.availability === "available" &&
        donor.availabilityConfirmedAt > 0 &&
        donor.availabilityConfirmedAt < staleSince &&
        !sent.some((n) => n.template === "NTF-12" && n._creationTime >= staleSince)
      ) {
        await notifyUser(ctx, {
          recipient: profile,
          template: "NTF-12",
          params: {},
          url: "/donor",
          channelId: "updates",
        });
        nudges++;
      }
    }
    return { eligibleAgain, nudges, skipped: undefined };
  },
});
