import { internalMutationGeneric, makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { GenericMutationCtx } from "convex/server";
import type { DataModel, Doc } from "./schemaTypes";
import { getSetting } from "./_lib/settings";
import { recordEvent } from "./_lib/events";
import { notifyUser } from "./_lib/notify";
import { refreshDonorLive } from "./_lib/donorLive";
import { allResponses, promoteStandbyOrWave } from "./matching";

/**
 * Request lifecycle jobs (specs §6.6, roadmap P2 F-405/F-501/F-502/F-602):
 * still-coming checks, auto-close, donation-confirmation prompts and the
 * hourly sweep (pause ends, suspension ends, verification expiry).
 * Every job re-checks current state first — all are idempotent, and
 * `autoClose` re-arms itself when a request's needed-by has moved.
 */

type Ctx = GenericMutationCtx<DataModel>;

const stillComingTimeoutRef = makeFunctionReference<"mutation">("lifecycle:stillComingTimeout");
const autoCloseRef = makeFunctionReference<"mutation">("lifecycle:autoClose");
const confirmationPromptRef = makeFunctionReference<"mutation">("lifecycle:confirmationPrompt");

async function hospitalName(ctx: Ctx, request: Doc<"requests">): Promise<string> {
  if (request.hospitalId) {
    const hospital = await ctx.db.get(request.hospitalId);
    if (hospital) return hospital.nameEn;
  }
  return request.placeText ?? "";
}

/**
 * internal.lifecycle.stillComingCheck (specs §6.6): round 1 fires S-15
 * after confirmation, round 2 at needed-by − S-15c. Asks NTF-08 (unless
 * the donor already answered this round) and arms the S-16 timeout.
 */
export const stillComingCheck = internalMutationGeneric({
  args: { responseId: v.id("responses"), round: v.number() },
  handler: async (ctx, args) => {
    const response = await ctx.db.get(args.responseId);
    if (!response || response.state !== "confirmed") return;
    const request = await ctx.db.get(response.requestId);
    if (!request || request.status === "closed") return;
    const answerWindowMin = await getSetting<number>(ctx, "stillComingAnswerMin");
    const now = Date.now();
    if (response.stillComingAskedAt) {
      const askedAgoMin = (now - response.stillComingAskedAt) / 60_000;
      if (!response.stillComingAnswer && askedAgoMin < answerWindowMin) {
        return; // a question is already inside its answer window
      }
      if (response.stillComingAnswer && args.round === 1) return; // round 1 done
    }
    const donorProfile = await ctx.db.get(response.donorId);
    if (!donorProfile) return;
    await ctx.db.patch(response._id, {
      stillComingAskedAt: now,
      stillComingAnswer: undefined,
      stillComingAnsweredAt: undefined,
    });
    await notifyUser(ctx, {
      recipient: donorProfile,
      template: "NTF-08",
      requestId: request._id,
      params: { hospital: await hospitalName(ctx, request) },
      url: `/alerts/${request._id}`,
      channelId: "urgent-requests",
    });
    await ctx.scheduler.runAfter(answerWindowMin * 60_000, stillComingTimeoutRef, {
      responseId: response._id,
    });
    await recordEvent(ctx, "still_coming_asked", {
      requestId: request._id,
      actorRole: "system",
      props: { round: args.round },
      isDemo: request.isDemo,
    });
  },
});

/**
 * internal.lifecycle.stillComingTimeout (specs §6.6): silence after S-16
 * promotes the first standby (or runs the next wave at once). The
 * original donor STAYS confirmed (PRD §5.5).
 */
export const stillComingTimeout = internalMutationGeneric({
  args: { responseId: v.id("responses") },
  handler: async (ctx, args) => {
    const response = await ctx.db.get(args.responseId);
    if (!response || response.state !== "confirmed") return;
    if (response.stillComingAnswer || !response.stillComingAskedAt) return;
    const answerWindowMin = await getSetting<number>(ctx, "stillComingAnswerMin");
    const dueAt = response.stillComingAskedAt + answerWindowMin * 60_000;
    if (Date.now() < dueAt) {
      await ctx.scheduler.runAfter(dueAt - Date.now(), stillComingTimeoutRef, {
        responseId: response._id,
      });
      return;
    }
    const request = await ctx.db.get(response.requestId);
    if (!request || request.status === "closed") return;
    await recordEvent(ctx, "still_coming_timeout", {
      requestId: request._id,
      actorRole: "system",
      isDemo: request.isDemo,
    });
    await promoteStandbyOrWave(ctx, request);
  },
});

/**
 * internal.lifecycle.autoClose (specs §6.6): at needed-by + S-17, close
 * the request `expired` and prompt the requester (NTF-10). If needed-by
 * moved later (requests.update), the job re-arms instead of closing.
 */
export const autoClose = internalMutationGeneric({
  args: { requestId: v.id("requests") },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request || request.status === "closed") return;
    const afterHours = await getSetting<number>(ctx, "autoCloseAfterNeededHours");
    const dueAt = request.neededBy + afterHours * 3_600_000;
    if (Date.now() < dueAt) {
      await ctx.scheduler.runAfter(dueAt - Date.now(), autoCloseRef, {
        requestId: request._id,
      });
      return;
    }
    await ctx.db.patch(request._id, {
      status: "closed",
      closeReason: "expired",
      closedAt: Date.now(),
    });
    const requester = await ctx.db.get(request.requesterId);
    if (requester) {
      await notifyUser(ctx, {
        recipient: requester,
        template: "NTF-10",
        requestId: request._id,
        params: {},
        url: `/confirm/${request._id}`,
        channelId: "updates",
      });
    }
    await recordEvent(ctx, "request_closed", {
      requestId: request._id,
      actorRole: "system",
      props: { reason: "expired" },
      isDemo: request.isDemo,
    });
  },
});

/**
 * internal.lifecycle.confirmationPrompt (specs §6.6): S-19 after the
 * first contact was shared, ask the requester and every confirmed donor
 * without an outcome (NTF-10); one reminder S-19b later. Only the DONOR's
 * own "donated" answer ever starts a cooldown (F-503) — see
 * responses.recordOutcome.
 */
export const confirmationPrompt = internalMutationGeneric({
  args: { requestId: v.id("requests"), reminder: v.boolean() },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request) return;
    if (!args.reminder) {
      // Dedupe on the prompt event (auto-close also sends NTF-10, so the
      // notifications table alone cannot prove a prompt already ran).
      const events = await ctx.db
        .query("events")
        .withIndex("by_request", (q) => q.eq("requestId", request._id))
        .collect();
      if (events.some((e) => e.name === "confirmation_prompted")) return;
    }
    const responses = await allResponses(ctx, request._id);
    const confirmed = responses.filter((r) => r.state === "confirmed");
    if (confirmed.length === 0) return;
    const recipients = new Map<string, Doc<"profiles">>();
    if (confirmed.some((r) => !r.outcomeRequester)) {
      const requester = await ctx.db.get(request.requesterId);
      if (requester) recipients.set(String(requester._id), requester);
    }
    for (const response of confirmed) {
      if (response.outcomeDonor) continue;
      const donorProfile = await ctx.db.get(response.donorId);
      if (donorProfile) recipients.set(String(donorProfile._id), donorProfile);
    }
    for (const recipient of recipients.values()) {
      await notifyUser(ctx, {
        recipient,
        template: "NTF-10",
        requestId: request._id,
        params: {},
        url: `/confirm/${request._id}`,
        channelId: "updates",
      });
    }
    if (recipients.size > 0) {
      await recordEvent(ctx, "confirmation_prompted", {
        requestId: request._id,
        actorRole: "system",
        props: { reminder: args.reminder, count: recipients.size },
        isDemo: request.isDemo,
      });
    }
    if (!args.reminder) {
      const reminderHours = await getSetting<number>(ctx, "confirmReminderHours");
      await ctx.scheduler.runAfter(reminderHours * 3_600_000, confirmationPromptRef, {
        requestId: request._id,
        reminder: true,
      });
    }
  },
});

/**
 * Hourly sweep (specs §6.6 crons): end pauses (→ available + NTF-13),
 * end suspensions whose time is up, expire stale phone verifications.
 */
export const hourlySweep = internalMutationGeneric({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const donors = await ctx.db.query("donorProfiles").collect();
    for (const donor of donors) {
      if (
        donor.availability === "paused" &&
        donor.pausedUntil !== undefined &&
        donor.pausedUntil <= now
      ) {
        await ctx.db.patch(donor._id, { availability: "available", pausedUntil: undefined });
        const profile = await ctx.db.get(donor.profileId);
        if (profile) {
          await notifyUser(ctx, {
            recipient: profile,
            template: "NTF-13",
            params: {},
            url: "/donor",
            channelId: "updates",
          });
          await recordEvent(ctx, "availability_changed", {
            actorRole: "system",
            props: { state: "available", auto: true },
            isDemo: donor.isDemo,
          });
        }
      }
    }
    const suspended = await ctx.db
      .query("profiles")
      .withIndex("by_status", (q) => q.eq("status", "suspended"))
      .collect();
    for (const profile of suspended) {
      if (profile.statusUntil !== undefined && profile.statusUntil <= now) {
        await ctx.db.patch(profile._id, {
          status: "active",
          statusUntil: undefined,
          statusReason: undefined,
        });
        const donor = await ctx.db
          .query("donorProfiles")
          .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
          .unique();
        if (donor) {
          const fresh = await ctx.db.get(profile._id);
          if (fresh) await refreshDonorLive(ctx, fresh, donor);
        }
      }
    }
    const verifications = await ctx.db.query("phoneVerifications").collect();
    for (const verification of verifications) {
      if (verification.status === "pending" && verification.expiresAt <= now) {
        await ctx.db.patch(verification._id, { status: "expired" });
      }
    }
    return null;
  },
});
