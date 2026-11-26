import { makeFunctionReference } from "convex/server";
import type { GenericMutationCtx } from "convex/server";
import type { DataModel, Doc, Id } from "./schemaTypes";
import { v } from "convex/values";
import { memberMutationV, memberQueryV, ownerViewQueryV } from "./_lib/auth";
import { fail } from "./_lib/errors";
import { getRulesSettings, getSetting } from "./_lib/settings";
import { recordEvent } from "./_lib/events";
import { notifyUser, COMPONENT_LABEL } from "./_lib/notify";
import { phoneOf } from "./_lib/visibility";
import { eqRange } from "./_lib/db";
import { canCreateRequest } from "./rules/limits";
import { containsMoneyWord, normalisePhone, validateRequestForm } from "./rules/validation";
import { haversineKm } from "./rules/ranking";
import { pruneNoShows } from "./rules/alertPolicy";
import { allResponses, promoteStandbyOrWave } from "./matching";
import { component, lang, requestGroup } from "./schema";

/**
 * Requests (specs §6.2, F-201/F-202/F-207, SCR-M02/M03/M04). Form path
 * only in P1; voice/paste/AI intake is P4.
 */

const startRequestRef = makeFunctionReference<"mutation">("matching:startRequest");
const autoCloseRef = makeFunctionReference<"mutation">("lifecycle:autoClose");

/** Arm the S-17 auto-close for a request (idempotent — see lifecycle). */
async function scheduleAutoClose(
  ctx: GenericMutationCtx<DataModel>,
  requestId: Id<"requests">,
  neededBy: number,
) {
  const afterHours = await getSetting<number>(ctx, "autoCloseAfterNeededHours");
  await ctx.scheduler.runAfter(
    Math.max(0, neededBy + afterHours * 3_600_000 - Date.now()),
    autoCloseRef,
    { requestId },
  );
}

const SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
function randomSlug(): string {
  const bytes = new Uint8Array(10);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => SLUG_ALPHABET[b % SLUG_ALPHABET.length]).join("");
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

/** Asia/Dhaka calendar parts for `now` (urgency + monthly-limit maths). */
function dhakaParts(now: number): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(now));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  return { y: get("year"), m: get("month"), d: get("day") };
}

function deriveUrgency(neededBy: number, now: number): "now" | "today" | "later" {
  if (neededBy <= now + 2 * 3_600_000) return "now";
  const { y, m, d } = dhakaParts(now);
  const endOfToday = Date.parse(
    `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}T23:59:59+06:00`,
  );
  return neededBy <= endOfToday ? "today" : "later";
}

/** requests.create 🔁 (specs §6.2) — idempotent on clientId. */
export const create = memberMutationV({
  args: {
    clientId: v.string(),
    bloodGroup: requestGroup,
    component,
    isDengue: v.boolean(),
    unitsNeeded: v.number(),
    hospitalId: v.optional(v.id("hospitals")),
    divisionId: v.id("places"),
    districtId: v.id("places"),
    upazilaId: v.id("places"),
    placeText: v.optional(v.string()),
    approxLat: v.optional(v.number()),
    approxLng: v.optional(v.number()),
    neededBy: v.number(),
    contactPhone: v.string(),
    patientName: v.optional(v.string()),
    ward: v.optional(v.string()),
    note: v.optional(v.string()),
    source: v.union(
      v.literal("form"), v.literal("voice"), v.literal("text"),
      v.literal("paste"), v.literal("volunteer_paste"),
    ),
    aiAssisted: v.boolean(),
    lang,
  },
  handler: async (ctx, args) => {
    // Idempotency (F-207): a retry with the same clientId returns the original.
    const sameClient = await ctx.db
      .query("requests")
      .withIndex("by_clientId", (q) => q.eq("clientId", args.clientId))
      .collect();
    const existing = sameClient.find((r) => r.requesterId === ctx.profile._id);
    if (existing) return { requestId: existing._id, existing: true };

    const check = validateRequestForm(
      {
        bloodGroup: args.bloodGroup,
        component: args.component,
        isDengue: args.isDengue,
        unitsNeeded: args.unitsNeeded,
        hospitalId: args.hospitalId,
        districtId: args.districtId,
        upazilaId: args.upazilaId,
        placeText: args.placeText,
        neededBy: args.neededBy,
        contactPhone: args.contactPhone,
        patientName: args.patientName,
        ward: args.ward,
        note: args.note,
      },
      Date.now(),
    );
    if (!check.ok) fail("ERR_VALIDATION", {}, check.field);

    // Limits (F-802, S-22) — settings-driven via the pure rules.
    const settings = await getRulesSettings(ctx);
    const byStatus = async (status: "live" | "covered" | "closed") =>
      await ctx.db
        .query("requests")
        .withIndex(
          "by_requester_status",
          eqRange([["requesterId", ctx.profile._id], ["status", status]]),
        )
        .collect();
    const [live, covered, closed] = await Promise.all([
      byStatus("live"),
      byStatus("covered"),
      byStatus("closed"),
    ]);
    const { y, m } = dhakaParts(Date.now());
    const monthStart = Date.parse(
      `${y}-${String(m).padStart(2, "0")}-01T00:00:00+06:00`,
    );
    const thisMonth = [...live, ...covered, ...closed].filter(
      (r) => r._creationTime >= monthStart,
    ).length;
    const limit = canCreateRequest(
      ctx.profile,
      {
        open: live.length + covered.length,
        thisMonth,
        isVolunteerPosting: args.source === "volunteer_paste",
      },
      settings,
    );
    if (!limit.ok) fail(limit.code, limit.params);

    // Place resolution: a listed hospital wins; otherwise the picked area.
    let divisionId = args.divisionId;
    let districtId = args.districtId;
    let upazilaId = args.upazilaId;
    let approxLat: number;
    let approxLng: number;
    if (args.hospitalId) {
      const hospital = await ctx.db.get(args.hospitalId);
      if (!hospital || hospital!.isDemo !== ctx.profile.isDemo) fail("ERR_NOT_FOUND");
      divisionId = hospital!.divisionId;
      districtId = hospital!.districtId;
      upazilaId = hospital!.upazilaId;
      approxLat = round3(hospital!.lat);
      approxLng = round3(hospital!.lng);
    } else {
      const [district, upazila] = await Promise.all([
        ctx.db.get(args.districtId),
        ctx.db.get(args.upazilaId),
      ]);
      if (!district || !upazila || upazila!.parentId !== district!._id) {
        fail("ERR_VALIDATION", {}, "place");
      }
      approxLat = round3(args.approxLat ?? upazila!.lat);
      approxLng = round3(args.approxLng ?? upazila!.lng);
    }

    const contactPhone = normalisePhone(args.contactPhone)!;
    let publicSlug = randomSlug();
    for (let attempt = 0; attempt < 3; attempt++) {
      const clash = await ctx.db
        .query("requests")
        .withIndex("by_publicSlug", (q) => q.eq("publicSlug", publicSlug))
        .first();
      if (!clash) break;
      publicSlug = randomSlug();
    }

    const requestId = await ctx.db.insert("requests", {
      requesterId: ctx.profile._id,
      createdByVolunteerId: args.source === "volunteer_paste" ? ctx.profile._id : undefined,
      source: args.source,
      clientId: args.clientId,
      bloodGroup: args.bloodGroup,
      component: args.component,
      isDengue: args.isDengue,
      unitsNeeded: args.unitsNeeded,
      unitsConfirmed: 0,
      hospitalId: args.hospitalId,
      placeText: args.placeText,
      divisionId,
      districtId,
      upazilaId,
      approxLat,
      approxLng,
      neededBy: args.neededBy,
      urgency: deriveUrgency(args.neededBy, Date.now()),
      patientName: args.patientName,
      ward: args.ward,
      note: args.note,
      contactPhone,
      contactPhoneVerified: ctx.profile.phoneVerified && contactPhone === ctx.profile.phone,
      lang: args.lang,
      publicSlug,
      status: "live",
      wave: 0,
      volunteerShownIds: [],
      fallbackShown: false,
      zeroEligibleAtPublish: false,
      verifiedBadge: false,
      slipStatus: "none",
      revealsFrozen: false,
      hiddenByModerator: false,
      aiAssisted: args.aiAssisted,
      isDemo: ctx.profile.isDemo,
    });

    // Money-word check → non-blocking moderation flag (specs §6.2).
    if (containsMoneyWord(args.note) || containsMoneyWord(args.placeText)) {
      await ctx.db.insert("moderationItems", {
        type: "flag",
        kind: "money_mention",
        subjectId: ctx.profile._id,
        requestId,
        severity: "low",
        status: "open",
        isDemo: ctx.profile.isDemo,
      });
    }

    await recordEvent(ctx, "request_published", {
      requestId,
      actorRole: ctx.profile.role,
      props: { source: args.source, aiAssisted: args.aiAssisted },
      isDemo: ctx.profile.isDemo,
    });
    await ctx.scheduler.runAfter(0, startRequestRef, { requestId });
    await scheduleAutoClose(ctx, requestId, args.neededBy);
    return { requestId, existing: false };
  },
});

/** requests.getForOwner 📞 (specs §6.2) — SCR-M03 live status. Frozen and
 * suspended owners keep this read-only view (gate G6); writes stay shut. */
export const getForOwner = ownerViewQueryV({
  args: { requestId: v.id("requests") },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (
      !request ||
      request!.requesterId !== ctx.profile._id ||
      request!.isDemo !== ctx.profile.isDemo
    ) {
      fail("ERR_NOT_FOUND");
    }
    const req = request!;
    const responses = await allResponses(ctx, req._id);
    const inStates = (states: string[]) => responses.filter((r) => states.includes(r.state));
    const progress = {
      notified: inStates(["notified", "opened", "accepted", "confirmed", "standby"]).length,
      opened: responses.filter(
        (r) => r.openedAt !== undefined || ["opened", "accepted", "confirmed", "standby"].includes(r.state),
      ).length,
      accepted: inStates(["accepted", "confirmed", "standby"]).length,
      confirmed: inStates(["confirmed"]).length,
    };

    const reveals = await ctx.db
      .query("contactReveals")
      .withIndex(
        "by_viewer_request",
        eqRange([["viewerId", ctx.profile._id], ["requestId", req._id]]),
      )
      .collect();
    const now = Date.now();
    const revealFor = (subjectId: string) =>
      reveals.find((r) => r.subjectId === subjectId && r.expiresAt > now);

    const confirmedDonors = [];
    for (const response of inStates(["confirmed"])) {
      const donorProfile = await ctx.db.get(response.donorId);
      const donor = await ctx.db.get(response.donorProfileId);
      if (!donorProfile || !donor) continue;
      const area = await ctx.db.get(donor.upazilaId);
      const reveal = response.callMode === "donor_calls" ? undefined : revealFor(donorProfile._id);
      confirmedDonors.push({
        responseId: response._id,
        firstName: donorProfile.firstName,
        group: donor.bloodGroup,
        areaName: area?.nameEn ?? "",
        distanceKm: area
          ? Math.round(haversineKm(area, { lat: req.approxLat, lng: req.approxLng }) * 10) / 10
          : 0,
        phone: reveal ? phoneOf(donorProfile) : undefined,
        callMode: response.callMode,
      });
    }

    const volunteers = [];
    for (const vpId of req.volunteerShownIds) {
      const vp = await ctx.db.get(vpId);
      if (!vp) continue;
      const volunteer = await ctx.db.get(vp.profileId);
      if (!volunteer) continue;
      const reveal = revealFor(volunteer._id);
      volunteers.push({
        firstName: volunteer.firstName,
        phone: reveal ? phoneOf(volunteer) : undefined,
      });
    }

    const noDonorsShow =
      req.zeroEligibleAtPublish || (req.wave >= 1 && progress.confirmed === 0 && progress.notified === 0);
    let bloodBanks: { nameEn: string; nameBn: string; phone?: string; distanceKm: number }[] = [];
    if (noDonorsShow) {
      const rows = await ctx.db
        .query("hospitals")
        .withIndex(
          "by_district",
          eqRange([["isDemo", req.isDemo], ["active", true], ["districtId", req.districtId]]),
        )
        .collect();
      bloodBanks = rows
        .map((h) => ({
          nameEn: h.nameEn,
          nameBn: h.nameBn,
          phone: h.bloodBankPhone,
          distanceKm: Math.round(haversineKm(h, { lat: req.approxLat, lng: req.approxLng }) * 10) / 10,
        }))
        .sort((a, b) => a.distanceKm - b.distanceKm)
        .slice(0, 5);
    }

    const fallbackPhone = req.fallbackShown
      ? (await getSetting<string>(ctx, "fallbackContactPhone")) || undefined
      : undefined;

    const hospital = req.hospitalId ? await ctx.db.get(req.hospitalId) : null;
    return {
      request: {
        ...req,
        hospitalName: hospital?.nameEn ?? req.placeText ?? "",
      },
      progress,
      wave: req.wave,
      nextWaveAt: req.nextWaveAt,
      confirmedDonors,
      volunteers,
      fallbackPhone,
      noDonors: { show: noDonorsShow, bloodBanks },
      revealsFrozen: req.revealsFrozen,
    };
  },
});

/** requests.listMine (specs §6.2) — SCR-M04, list only in P1. */
export const listMine = memberQueryV({
  args: {
    status: v.union(v.literal("active"), v.literal("closed")),
    paginationOpts: v.object({
      numItems: v.number(),
      cursor: v.union(v.string(), v.null()),
    }),
  },
  handler: async (ctx, args) => {
    const statuses = args.status === "active" ? ["live", "covered"] : ["closed"];
    const rows = [];
    for (const status of statuses) {
      rows.push(
        ...(await ctx.db
          .query("requests")
          .withIndex(
            "by_requester_status",
            eqRange([["requesterId", ctx.profile._id], ["status", status]]),
          )
          .collect()),
      );
    }
    rows.sort((a, b) => b._creationTime - a._creationTime);
    const page = [];
    for (const row of rows.slice(0, args.paginationOpts.numItems)) {
      const hospital = row.hospitalId ? await ctx.db.get(row.hospitalId) : null;
      page.push({
        _id: row._id,
        bloodGroup: row.bloodGroup,
        component: row.component,
        isDengue: row.isDengue,
        unitsNeeded: row.unitsNeeded,
        unitsConfirmed: row.unitsConfirmed,
        status: row.status,
        hospitalName: hospital?.nameEn ?? row.placeText ?? "",
        createdAt: row._creationTime,
        neededBy: row.neededBy,
      });
    }
    return { page, isDone: true, continueCursor: "" };
  },
});

/** requests.close (specs §6.2, F-501) — owner, claimed volunteer or admin. */
export const close = memberMutationV({
  args: {
    requestId: v.id("requests"),
    reason: v.union(v.literal("fulfilled"), v.literal("not_needed")),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request || request!.isDemo !== ctx.profile.isDemo) fail("ERR_NOT_FOUND");
    const req = request!;
    let claimedVolunteer = false;
    if (req.claimedByVolunteerId) {
      const vp = await ctx.db.get(req.claimedByVolunteerId);
      claimedVolunteer = vp?.profileId === ctx.profile._id;
    }
    const allowed =
      req.requesterId === ctx.profile._id ||
      ctx.profile.role === "admin" ||
      ctx.profile.role === "superadmin" ||
      claimedVolunteer;
    if (!allowed) fail("ERR_NOT_FOUND");
    if (req.status === "closed") fail("ERR_REQUEST_CLOSED");

    await ctx.db.patch(req._id, {
      status: "closed",
      closeReason: args.reason,
      closedAt: Date.now(),
    });

    // "No longer needed" (NTF-09) to donors still deciding (specs §6.2).
    const hospital = req.hospitalId ? await ctx.db.get(req.hospitalId) : null;
    const hospitalName = hospital?.nameEn ?? req.placeText ?? "";
    const responses = await allResponses(ctx, req._id);
    for (const response of responses) {
      if (!["notified", "opened", "standby"].includes(response.state)) continue;
      const donorProfile = await ctx.db.get(response.donorId);
      if (!donorProfile) continue;
      await notifyUser(ctx, {
        recipient: donorProfile,
        template: "NTF-09",
        requestId: req._id,
        params: {
          group: req.bloodGroup,
          component: COMPONENT_LABEL[donorProfile.language][req.component],
          hospital: hospitalName,
        },
        url: `/alerts/${req._id}`,
        channelId: "updates",
      });
    }
    await recordEvent(ctx, "request_closed", {
      requestId: req._id,
      actorRole: ctx.profile.role,
      props: { reason: args.reason },
      isDemo: req.isDemo,
    });
    return null;
  },
});

/** requests.update (specs §6.2, F-501) — owner edits units/needed-by/note. */
export const update = memberMutationV({
  args: {
    requestId: v.id("requests"),
    unitsNeeded: v.optional(v.number()),
    neededBy: v.optional(v.number()),
    note: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (
      !request ||
      request!.requesterId !== ctx.profile._id ||
      request!.isDemo !== ctx.profile.isDemo
    ) {
      fail("ERR_NOT_FOUND");
    }
    const req = request!;
    if (req.status === "closed") fail("ERR_REQUEST_CLOSED");
    if (
      args.unitsNeeded !== undefined &&
      (!Number.isInteger(args.unitsNeeded) || args.unitsNeeded < 1 || args.unitsNeeded > 10)
    ) {
      fail("ERR_VALIDATION", {}, "unitsNeeded");
    }
    const patch: Partial<Doc<"requests">> = {};
    if (args.unitsNeeded !== undefined) patch.unitsNeeded = args.unitsNeeded;
    if (args.note !== undefined) patch.note = args.note;
    if (args.neededBy !== undefined) {
      patch.neededBy = args.neededBy;
      patch.urgency = deriveUrgency(args.neededBy, Date.now());
    }
    await ctx.db.patch(req._id, patch);
    await recordEvent(ctx, "request_updated", {
      requestId: req._id,
      actorRole: ctx.profile.role,
      props: {
        units: args.unitsNeeded !== undefined,
        neededBy: args.neededBy !== undefined,
        text: args.note !== undefined,
      },
      isDemo: req.isDemo,
    });
    if (args.neededBy !== undefined) {
      await scheduleAutoClose(ctx, req._id, args.neededBy);
    }
    // Need-more while covered (F-501): back to live and fill the new
    // slots at once — standby first, then the next wave.
    if (
      args.unitsNeeded !== undefined &&
      args.unitsNeeded > req.unitsNeeded &&
      req.status === "covered"
    ) {
      const fresh = await ctx.db.get(req._id);
      if (fresh) await promoteStandbyOrWave(ctx, fresh);
    }
    return null;
  },
});

/** requests.reopen (specs §6.2, F-501) — within S-34 of closing. */
export const reopen = memberMutationV({
  args: { requestId: v.id("requests") },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (
      !request ||
      request!.requesterId !== ctx.profile._id ||
      request!.isDemo !== ctx.profile.isDemo
    ) {
      fail("ERR_NOT_FOUND");
    }
    const req = request!;
    if (req.status !== "closed") fail("ERR_VALIDATION", {}, "requestId");
    const windowHours = await getSetting<number>(ctx, "reopenWindowHours");
    if (!req.closedAt || Date.now() - req.closedAt > windowHours * 3_600_000) {
      fail("ERR_REQUEST_CLOSED");
    }
    await ctx.db.patch(req._id, {
      status: "live",
      closeReason: undefined,
      closedAt: undefined,
      wave: 0,
      escalatedAt: undefined,
      fallbackShown: false,
    });
    await recordEvent(ctx, "request_reopened", {
      requestId: req._id,
      actorRole: ctx.profile.role,
      isDemo: req.isDemo,
    });
    // startRequest re-runs wave 1 for donors not yet notified (specs §6.2).
    await ctx.scheduler.runAfter(0, startRequestRef, { requestId: req._id });
    await scheduleAutoClose(ctx, req._id, req.neededBy);
    return null;
  },
});

/**
 * requests.markDonorNotResponding (specs §6.2, F-406): the requester
 * marks a confirmed donor as not responding. The donor takes a no-show
 * mark (S-37, ranking only), a standby is confirmed in their place, or
 * matching restarts with the next wave at once.
 */
export const markDonorNotResponding = memberMutationV({
  args: { requestId: v.id("requests"), responseId: v.id("responses") },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (
      !request ||
      request!.requesterId !== ctx.profile._id ||
      request!.isDemo !== ctx.profile.isDemo
    ) {
      fail("ERR_NOT_FOUND");
    }
    const req = request!;
    const response = await ctx.db.get(args.responseId);
    if (!response || response!.requestId !== req._id) fail("ERR_NOT_FOUND");
    if (response!.state !== "confirmed") fail("ERR_VALIDATION", {}, "responseId");
    await ctx.db.patch(response!._id, { state: "not_responding" });
    const settings = await getRulesSettings(ctx);
    const donor = await ctx.db.get(response!.donorProfileId);
    if (donor) {
      const now = Date.now();
      await ctx.db.patch(donor._id, {
        noShowAt: [...pruneNoShows(donor.noShowAt, now, settings.noShowPenalty.days), now],
      });
    }
    await recordEvent(ctx, "donor_not_responding", {
      requestId: req._id,
      actorRole: ctx.profile.role,
      isDemo: req.isDemo,
    });
    if (req.status !== "closed") {
      const fresh = await ctx.db.get(req._id);
      if (fresh) await promoteStandbyOrWave(ctx, fresh);
    }
    return null;
  },
});
