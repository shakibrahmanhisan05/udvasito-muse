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
import { pruneNoShows, startOfDhakaDay } from "./rules/alertPolicy";
import {
  allResponses,
  promoteStandbyOrWave,
  scheduleConfirmationPrompt,
  scheduleStillComingChecks,
} from "./matching";
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
        compatibleGroup:
          request.component === "whole_blood" &&
          donor.bloodGroup !== request.bloodGroup &&
          request.bloodGroup !== "any" &&
          request.bloodGroup !== "not_sure",
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
      myResponse: {
        responseId: response!._id,
        state: response!.state,
        callMode: response!.callMode,
        wave: response!.wave,
        compatibleGroup:
          req.component === "whole_blood" &&
          donor!.bloodGroup !== req.bloodGroup &&
          req.bloodGroup !== "any" &&
          req.bloodGroup !== "not_sure",
        stillComingAskedAt: response!.stillComingAskedAt,
        stillComingAnswer: response!.stillComingAnswer,
      },
      requester: confirmed
        ? { firstName: requester!.firstName, phone: requesterPhone, authUserId: requester!.authUserId }
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
    // Group rule (PRD §5.2): exact in waves 1–2; compatible groups may
    // answer in the final wave (they were only notified then, S-11).
    const isFinalWave = response!.wave >= settings.waveCount;
    const { exact, compatible } = groupsFor(req.bloodGroup, req.component, isFinalWave, settings);
    if (
      !exact.includes(donor!.bloodGroup as never) &&
      !compatible.includes(donor!.bloodGroup as never)
    ) {
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
      const hadReveals =
        (await ctx.db
          .query("contactReveals")
          .withIndex("by_request", eqRange([["requestId", req._id]]))
          .collect()).length > 0;
      let revealed = false;
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
        revealed = true;
        // …and the requester sees the donor's, unless the donor chose
        // "I'll call them" (D16 — donor_calls) or the requester has hit
        // the daily reveal cap (S-23, F-802).
        if (args.callMode === "mutual") {
          const revealCap = await getSetting<number>(ctx, "revealsPerRequesterPerDay");
          const requesterReveals = await ctx.db
            .query("contactReveals")
            .withIndex("by_viewer_request", eqRange([["viewerId", requester!._id]]))
            .collect();
          const receivedToday = requesterReveals.filter(
            (r) => r._creationTime >= startOfDhakaDay(now),
          ).length;
          if (receivedToday < revealCap) {
            await recordContactReveal(ctx, {
              viewer: requester!,
              subject: ctx.profile,
              subjectRole: "donor",
              requestId: req._id,
              reason: "confirmed_slot",
              expiresAt,
              isDemo: req.isDemo,
            });
          } else {
            await recordEvent(ctx, "reveal_cap_reached", {
              requestId: req._id,
              actorRole: "system",
              props: { cap: revealCap },
              isDemo: req.isDemo,
            });
          }
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
      // Lifecycle (specs §6.3/§6.6): still-coming checks for this donor,
      // and the S-19 confirmation prompt when the first contact is shared.
      const patched = await ctx.db.get(response!._id);
      if (patched) {
        await scheduleStillComingChecks(ctx, req, patched._id);
        if (revealed && !hadReveals) await scheduleConfirmationPrompt(ctx, req);
      }
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

/**
 * responses.withdraw (specs §6.3, F-405): a confirmed or standby donor
 * backs out. A freed confirmed slot promotes the first standby at once,
 * or runs the next wave immediately; a covered request drops back to
 * `live` when no standby exists (PRD §5.6). Note: specs §6.8 defines no
 * push template for a withdrawal, so the requester sees it live in-app.
 */
export const withdraw = donorMutationV({
  args: { responseId: v.id("responses") },
  handler: async (ctx, args) => {
    const donor = await myDonor(ctx, ctx.profile._id);
    if (!donor) fail("ERR_NOT_FOUND");
    const response = await ctx.db.get(args.responseId);
    if (!response || response!.donorProfileId !== donor!._id) fail("ERR_NOT_FOUND");
    if (!["confirmed", "standby", "accepted"].includes(response!.state)) {
      fail("ERR_ALREADY_RESPONDED");
    }
    const wasConfirmed = response!.state === "confirmed";
    const request = await ctx.db.get(response!.requestId);
    await ctx.db.patch(response!._id, { state: "withdrew" });
    await recordEvent(ctx, "donor_withdrew", {
      requestId: response!.requestId,
      actorRole: ctx.profile.role,
      isDemo: ctx.profile.isDemo,
    });
    if (wasConfirmed && request && request!.status !== "closed") {
      await promoteStandbyOrWave(ctx, request!);
    }
    return null;
  },
});

/**
 * responses.answerStillComing (specs §6.3, F-405): the confirmed donor
 * answers the "Still coming?" prompt. "cant" runs the withdraw flow.
 */
export const answerStillComing = donorMutationV({
  args: {
    responseId: v.id("responses"),
    answer: v.union(v.literal("yes"), v.literal("cant")),
  },
  handler: async (ctx, args) => {
    const donor = await myDonor(ctx, ctx.profile._id);
    if (!donor) fail("ERR_NOT_FOUND");
    const response = await ctx.db.get(args.responseId);
    if (!response || response!.donorProfileId !== donor!._id) fail("ERR_NOT_FOUND");
    if (response!.state !== "confirmed" || !response!.stillComingAskedAt) {
      fail("ERR_VALIDATION", {}, "answer");
    }
    await ctx.db.patch(response!._id, {
      stillComingAnswer: args.answer,
      stillComingAnsweredAt: Date.now(),
    });
    await recordEvent(ctx, "still_coming_answered", {
      requestId: response!.requestId,
      actorRole: ctx.profile.role,
      props: { answer: args.answer },
      isDemo: ctx.profile.isDemo,
    });
    if (args.answer === "cant") {
      const request = await ctx.db.get(response!.requestId);
      await ctx.db.patch(response!._id, { state: "withdrew" });
      await recordEvent(ctx, "donor_withdrew", {
        requestId: response!.requestId,
        actorRole: ctx.profile.role,
        props: { via: "still_coming" },
        isDemo: ctx.profile.isDemo,
      });
      if (request && request!.status !== "closed") {
        await promoteStandbyOrWave(ctx, request!);
      }
    }
    return null;
  },
});

function dhakaToday(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

/**
 * PRD §5.5: when a donation is confirmed for a request, any OTHER
 * confirmed donor who was asked "Still coming?" and stayed silent takes
 * a no-show mark (ranking only, S-37 — never public).
 */
async function applySilenceNoShows(
  ctx: GenericMutationCtx<DataModel>,
  request: Doc<"requests">,
  exceptDonorId: Doc<"profiles">["_id"],
) {
  const settings = await getRulesSettings(ctx);
  const now = Date.now();
  const responses = await allResponses(ctx, request._id);
  for (const other of responses) {
    if (other.state !== "confirmed" || other.donorId === exceptDonorId) continue;
    if (!other.stillComingAskedAt || other.stillComingAnswer) continue;
    const donor = await ctx.db.get(other.donorProfileId);
    if (!donor) continue;
    await ctx.db.patch(donor._id, {
      noShowAt: [...pruneNoShows(donor.noShowAt, now, settings.noShowPenalty.days), now],
    });
    await recordEvent(ctx, "donor_no_show", {
      requestId: request._id,
      actorRole: "system",
      props: { cause: "still_coming_silence" },
      isDemo: request.isDemo,
    });
  }
}

/**
 * responses.recordOutcome (specs §6.3, F-502/F-503, SCR-M09): the donor
 * reports their own outcome, or the requester reports about a confirmed
 * donor. ONLY the donor's own "donated" starts the cooldown (F-503):
 * it writes the last-donation fields and recomputes eligibility.
 */
export const recordOutcome = donorMutationV({
  args: {
    requestId: v.id("requests"),
    responseId: v.optional(v.id("responses")),
    outcome: v.union(
      v.literal("donated"), v.literal("did_not_donate"), v.literal("not_yet"),
    ),
    donationDate: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request || request!.isDemo !== ctx.profile.isDemo) fail("ERR_NOT_FOUND");
    const req = request!;
    let response: Doc<"responses"> | null = null;
    if (args.responseId) {
      response = await ctx.db.get(args.responseId);
      if (!response || response!.requestId !== req._id) fail("ERR_NOT_FOUND");
    } else {
      const donor = await myDonor(ctx, ctx.profile._id);
      if (donor) response = await myResponse(ctx, req._id, donor._id);
    }
    if (!response) fail("ERR_NOT_FOUND");
    const isDonorSide = response!.donorId === ctx.profile._id;
    const isRequesterSide = req.requesterId === ctx.profile._id;
    if (!isDonorSide && !isRequesterSide) fail("ERR_NOT_FOUND");
    if (response!.state !== "confirmed") fail("ERR_VALIDATION", {}, "responseId");

    const now = Date.now();
    if (isDonorSide) {
      await ctx.db.patch(response!._id, {
        outcomeDonor: args.outcome,
        outcomeDonorAt: now,
      });
      if (args.outcome === "donated") {
        const date = args.donationDate ?? dhakaToday();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > dhakaToday()) {
          fail("ERR_VALIDATION", {}, "donationDate");
        }
        const donor = await ctx.db.get(response!.donorProfileId);
        if (donor) {
          const settings = await getRulesSettings(ctx);
          const updated = {
            gender: donor.gender,
            neverDonated: false,
            lastDonationDate: date,
            lastDonationType: req.component,
          };
          const { eligibleFrom, eligibleFromPlatelets } = computeEligibility(updated, settings);
          await ctx.db.patch(donor._id, { ...updated, eligibleFrom, eligibleFromPlatelets });
        }
        await applySilenceNoShows(ctx, req, ctx.profile._id);
      }
      await recordEvent(ctx, "donation_confirmed_by_donor", {
        requestId: req._id,
        actorRole: ctx.profile.role,
        props: { outcome: args.outcome },
        isDemo: req.isDemo,
      });
    } else {
      await ctx.db.patch(response!._id, {
        outcomeRequester: args.outcome,
        outcomeRequesterAt: now,
      });
      if (args.outcome === "donated") {
        await applySilenceNoShows(ctx, req, response!.donorId);
      }
      await recordEvent(ctx, "donation_reported_by_requester", {
        requestId: req._id,
        actorRole: ctx.profile.role,
        props: { outcome: args.outcome },
        isDemo: req.isDemo,
      });
    }
    return null;
  },
});
