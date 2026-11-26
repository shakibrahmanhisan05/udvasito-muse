import { v } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Doc } from "./schemaTypes";
import { donorMutationV, donorQueryV } from "./_lib/auth";
import { fail } from "./_lib/errors";
import { getRulesSettings, getSetting } from "./_lib/settings";
import { recordEvent } from "./_lib/events";
import { recordContactReveal, phoneOf } from "./_lib/visibility";
import { notifyUser } from "./_lib/notify";
import { eqRange } from "./_lib/db";
import { groupsFor } from "./rules/compatibility";
import { canDonate, computeEligibility } from "./rules/eligibility";
import { haversineKm } from "./rules/ranking";
import { allResponses } from "./matching";
import { callMode } from "./schema";

/**
 * Donor responses (specs §6.3, F-401/F-402/F-403, SCR-D03/D04).
 * Accept is the heart of the loop: a transaction that re-checks the rules,
 * confirms the first units+1 acceptors (S-12), stands the rest by, and
 * exchanges numbers ONLY through _lib/visibility (PRD §3.3).
 */

type AnyCtx = GenericMutationCtx<DataModel> | GenericQueryCtx<DataModel>;

async function myDonor(ctx: AnyCtx, profileId: Doc<"profiles">["_id"]) {
  return await ctx.db
    .query("donorProfiles")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId))
    .unique();
}

async function myResponse(
  ctx: AnyCtx,
  requestId: Doc<"requests">["_id"],
  donorProfileId: Doc<"donorProfiles">["_id"],
) {
  return await ctx.db
    .query("responses")
    .withIndex(
      "by_request_donor",
      eqRange([["requestId", requestId], ["donorProfileId", donorProfileId]]),
    )
    .unique();
}

/** responses.inbox (specs §6.3) — SCR-D03 groups. */
export const inbox = donorQueryV({
  args: {},
  handler: async (ctx) => {
    const empty = { needsAnswer: [], saidYes: [], earlier: [] };
    const donor = await myDonor(ctx, ctx.profile._id);
    if (!donor) return empty;
    const byState = async (state: string) =>
      await ctx.db
        .query("responses")
        .withIndex("by_donor_state", eqRange([["donorId", ctx.profile._id], ["state", state]]))
        .collect();
    const donorPlace = await ctx.db.get(donor.upazilaId);
    const item = async (response: Doc<"responses">) => {
      const request = await ctx.db.get(response.requestId);
      if (!request) return null;
      const hospital = request.hospitalId ? await ctx.db.get(request.hospitalId) : null;
      const upazila = await ctx.db.get(request.upazilaId);
      return {
        requestId: request._id,
        responseId: response._id,
        state: response.state,
        bloodGroup: request.bloodGroup,
        component: request.component,
        isDengue: request.isDengue,
        unitsNeeded: request.unitsNeeded,
        unitsConfirmed: request.unitsConfirmed,
        hospitalName: hospital?.nameEn ?? request.placeText ?? "",
        areaName: upazila?.nameEn ?? "",
        distanceKm: donorPlace
          ? Math.round(haversineKm(donorPlace, { lat: request.approxLat, lng: request.approxLng }) * 10) / 10
          : 0,
        neededBy: request.neededBy,
        requestStatus: request.status,
        contactPhoneVerified: request.contactPhoneVerified,
        verifiedBadge: request.verifiedBadge,
        notifiedAt: response.notifiedAt,
      };
    };
    const build = async (states: string[]) => {
      const rows = (await Promise.all(states.map(byState))).flat();
      rows.sort((a, b) => b.notifiedAt - a.notifiedAt);
      const items = await Promise.all(rows.map(item));
      return items.filter((x) => x !== null);
    };
    return {
      needsAnswer: await build(["notified", "opened"]),
      saidYes: await build(["accepted", "confirmed", "standby"]),
      earlier: await build(["declined", "withdrew", "not_responding"]),
    };
  },
});

/** responses.getForDonor 📞 (specs §6.3) — SCR-D04. */
export const getForDonor = donorQueryV({
  args: { requestId: v.id("requests") },
  handler: async (ctx, args) => {
    const donor = await myDonor(ctx, ctx.profile._id);
    if (!donor) fail("ERR_NOT_FOUND");
    const response = await myResponse(ctx, args.requestId, donor!._id);
    if (!response) fail("ERR_NOT_FOUND");
    const request = await ctx.db.get(args.requestId);
    if (!request || request!.isDemo !== ctx.profile.isDemo) fail("ERR_NOT_FOUND");
    const req = request!;
    const requester = await ctx.db.get(req.requesterId);
    if (!requester) fail("ERR_NOT_FOUND");

    const confirmed = response!.state === "confirmed";
    let requesterPhone: string | undefined;
    if (confirmed) {
      const reveals = await ctx.db
        .query("contactReveals")
        .withIndex(
          "by_viewer_request",
          eqRange([["viewerId", ctx.profile._id], ["requestId", req._id]]),
        )
        .collect();
      const reveal = reveals.find(
        (r) => r.subjectId === requester!._id && r.expiresAt > Date.now(),
      );
      if (reveal) requesterPhone = phoneOf(requester!);
    }

    const hospital = req.hospitalId ? await ctx.db.get(req.hospitalId) : null;
    const requesterRequests = (
      await Promise.all(
        (["live", "covered", "closed"] as const).map(
          async (status) =>
            await ctx.db
              .query("requests")
              .withIndex(
                "by_requester_status",
                eqRange([["requesterId", requester!._id], ["status", status]]),
              )
              .collect(),
        ),
      )
    ).flat();
    const requesterDonations = await ctx.db
      .query("responses")
      .withIndex(
        "by_donor_state",
        eqRange([["donorId", requester!._id], ["state", "confirmed"]]),
      )
      .collect();

    return {
      request: {
        bloodGroup: req.bloodGroup,
        component: req.component,
        isDengue: req.isDengue,
        unitsNeeded: req.unitsNeeded,
        unitsConfirmed: req.unitsConfirmed,
        neededBy: req.neededBy,
        status: req.status,
        note: req.note,
        contactPhoneVerified: req.contactPhoneVerified,
        verifiedBadge: req.verifiedBadge,
      },
      myResponse: { state: response!.state, callMode: response!.callMode, wave: response!.wave },
      requester: confirmed
        ? { firstName: requester!.firstName, phone: requesterPhone }
        : undefined,
      patientName: confirmed ? req.patientName : undefined,
      ward: confirmed ? req.ward : undefined,
      hospital: {
        name: hospital?.nameEn ?? req.placeText ?? "",
        lat: hospital?.lat ?? req.approxLat,
        lng: hospital?.lng ?? req.approxLng,
      },
      trackRecord: {
        memberSince: requester!._creationTime,
        requests: requesterRequests.length,
        donations: requesterDonations.length,
      },
    };
  },
});

/** responses.markOpened (specs §6.3) — push tap / screen open. */
export const markOpened = donorMutationV({
  args: { requestId: v.id("requests"), notificationId: v.optional(v.id("notifications")) },
  handler: async (ctx, args) => {
    const donor = await myDonor(ctx, ctx.profile._id);
    if (!donor) return null;
    const response = await myResponse(ctx, args.requestId, donor._id);
    if (!response) return null;
    if (response.state === "notified") {
      await ctx.db.patch(response._id, { state: "opened", openedAt: Date.now() });
      await recordEvent(ctx, "notification_opened", {
        requestId: args.requestId,
        actorRole: ctx.profile.role,
        isDemo: ctx.profile.isDemo,
      });
    }
    if (args.notificationId) {
      const notification = await ctx.db.get(args.notificationId);
      if (notification && notification.recipientId === ctx.profile._id && !notification.openedAt) {
        await ctx.db.patch(args.notificationId, { openedAt: Date.now() });
      }
    }
    return null;
  },
});

/** responses.accept 🔁 (specs §6.3) — confirm units+1, stand the rest by. */
export const accept = donorMutationV({
  args: { requestId: v.id("requests"), clientId: v.string(), selfCheck: v.boolean(), callMode },
  handler: async (ctx, args) => {
    if (!args.selfCheck) fail("ERR_VALIDATION", {}, "selfCheck");
    const donor = await myDonor(ctx, ctx.profile._id);
    if (!donor) fail("ERR_NOT_ELIGIBLE", { reason: "notLive" });
    const response = await myResponse(ctx, args.requestId, donor!._id);
    if (!response) fail("ERR_NOT_FOUND");
    const request = await ctx.db.get(args.requestId);
    if (!request || request!.isDemo !== ctx.profile.isDemo) fail("ERR_NOT_FOUND");
    const req = request!;

    // Idempotent retry (same device clientId) returns the original outcome.
    if (
      response!.acceptClientId === args.clientId &&
      (response!.state === "confirmed" || response!.state === "standby")
    ) {
      return { state: response!.state as "confirmed" | "standby", contactsPaused: req.revealsFrozen };
    }
    if (req.status === "closed") fail("ERR_REQUEST_CLOSED");
    if (!["notified", "opened"].includes(response!.state)) fail("ERR_ALREADY_RESPONDED");

    const blocked = await ctx.db
      .query("blocks")
      .withIndex(
        "by_pair",
        eqRange([["blockerId", req.requesterId], ["blockedId", ctx.profile._id]]),
      )
      .first();
    const blockedBy = await ctx.db
      .query("blocks")
      .withIndex(
        "by_pair",
        eqRange([["blockerId", ctx.profile._id], ["blockedId", req.requesterId]]),
      )
      .first();
    if (blocked || blockedBy) fail("ERR_BLOCKED");

    const settings = await getRulesSettings(ctx);
    if (!donor!.live) fail("ERR_NOT_ELIGIBLE", { reason: "notLive" });
    const { exact } = groupsFor(req.bloodGroup, req.component, false, settings);
    if (!exact.includes(donor!.bloodGroup as never)) {
      fail("ERR_NOT_ELIGIBLE", { reason: "group" });
    }
    const eligibility = canDonate(
      {
        gender: donor!.gender,
        neverDonated: donor!.neverDonated,
        lastDonationDate: donor!.lastDonationDate,
        lastDonationType: donor!.lastDonationType,
        plateletOptIn: donor!.plateletOptIn,
      },
      req.component,
      Date.now(),
      settings,
      ctx.profile.dateOfBirth,
    );
    if (!eligibility.ok) {
      fail("ERR_NOT_ELIGIBLE", {
        reason: eligibility.reason,
        date: eligibility.date
          ? new Date(eligibility.date).toISOString().slice(0, 10)
          : "",
      });
    }

    const confirmedCount = (await allResponses(ctx, req._id)).filter(
      (r) => r.state === "confirmed",
    ).length;
    const extraSlots = await getSetting<number>(ctx, "extraConfirmedSlots");
    const isConfirmed = confirmedCount < req.unitsNeeded + extraSlots;
    const now = Date.now();
    await ctx.db.patch(response!._id, {
      state: isConfirmed ? "confirmed" : "standby",
      acceptedAt: now,
      confirmedAt: isConfirmed ? now : undefined,
      acceptClientId: args.clientId,
      callMode: args.callMode,
    });
    await recordEvent(ctx, "donor_accepted", {
      requestId: req._id,
      actorRole: ctx.profile.role,
      isDemo: req.isDemo,
    });

    if (isConfirmed) {
      const requester = await ctx.db.get(req.requesterId);
      if (!requester) fail("ERR_NOT_FOUND");
      if (!req.revealsFrozen) {
        const visibleDays = await getSetting<number>(ctx, "contactVisibleAfterCloseDays");
        const expiresAt = now + visibleDays * 86_400_000;
        // The confirmed donor always sees the requester's number (PRD §3.3)…
        await recordContactReveal(ctx, {
          viewer: ctx.profile,
          subject: requester!,
          subjectRole: "requester",
          requestId: req._id,
          reason: "confirmed_slot",
          expiresAt,
          isDemo: req.isDemo,
        });
        // …and the requester sees the donor's, unless the donor chose
        // "I'll call them" (D16 — donor_calls).
        if (args.callMode === "mutual") {
          await recordContactReveal(ctx, {
            viewer: requester!,
            subject: ctx.profile,
            subjectRole: "donor",
            requestId: req._id,
            reason: "confirmed_slot",
            expiresAt,
            isDemo: req.isDemo,
          });
        }
        await recordEvent(ctx, "contact_shared", {
          requestId: req._id,
          actorRole: ctx.profile.role,
          props: { mode: args.callMode },
          isDemo: req.isDemo,
        });
      }
      const unitsConfirmed = Math.min(confirmedCount + 1, req.unitsNeeded);
      await ctx.db.patch(req._id, {
        unitsConfirmed,
        status: unitsConfirmed >= req.unitsNeeded ? "covered" : req.status,
      });
      await recordEvent(ctx, "donor_confirmed", {
        requestId: req._id,
        actorRole: ctx.profile.role,
        isDemo: req.isDemo,
      });
      await notifyUser(ctx, {
        recipient: requester!,
        template: "NTF-04",
        requestId: req._id,
        params: { name: ctx.profile.firstName },
        url: `/request/${req._id}`,
        channelId: "updates",
        donorCallsBody: args.callMode === "donor_calls",
      });
      return { state: "confirmed" as const, contactsPaused: req.revealsFrozen };
    }

    await recordEvent(ctx, "donor_standby", {
      requestId: req._id,
      actorRole: ctx.profile.role,
      isDemo: req.isDemo,
    });
    return { state: "standby" as const, contactsPaused: req.revealsFrozen };
  },
});

/** responses.decline (specs §6.3). */
export const decline = donorMutationV({
  args: {
    requestId: v.id("requests"),
    reason: v.optional(
      v.union(
        v.literal("busy"), v.literal("far"), v.literal("donated"),
        v.literal("unwell"), v.literal("other"),
      ),
    ),
    donatedDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const donor = await myDonor(ctx, ctx.profile._id);
    if (!donor) fail("ERR_NOT_FOUND");
    const response = await myResponse(ctx, args.requestId, donor!._id);
    if (!response) fail("ERR_NOT_FOUND");
    if (!["notified", "opened"].includes(response!.state)) fail("ERR_ALREADY_RESPONDED");
    await ctx.db.patch(response!._id, {
      state: "declined",
      declineReason: args.reason,
    });
    const request = await ctx.db.get(args.requestId);
    if (args.reason === "donated" && args.donatedDate && request) {
      const settings = await getRulesSettings(ctx);
      const updated = {
        gender: donor!.gender,
        neverDonated: false,
        lastDonationDate: args.donatedDate,
        lastDonationType: request.component,
      };
      const { eligibleFrom, eligibleFromPlatelets } = computeEligibility(updated, settings);
      await ctx.db.patch(donor!._id, { ...updated, eligibleFrom, eligibleFromPlatelets });
    }
    await recordEvent(ctx, "donor_declined", {
      requestId: args.requestId,
      actorRole: ctx.profile.role,
      props: { reason: args.reason ?? "other" },
      isDemo: ctx.profile.isDemo,
    });
    return null;
  },
});
