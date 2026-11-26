import { makeFunctionReference, queryGeneric } from "convex/server";
import type { GenericDatabaseReader, GenericMutationCtx } from "convex/server";
import type { DataModel, Doc, Id } from "./schemaTypes";
import { v } from "convex/values";
import { memberMutationV, memberQueryV, ownerViewQueryV, volunteerMutationV, volunteerQueryV } from "./_lib/auth";
import { fail } from "./_lib/errors";
import { featureOn, getRulesSettings, getSetting } from "./_lib/settings";
import { writeAudit } from "./_lib/audit";
import { recordEvent } from "./_lib/events";
import { notifyUser, COMPONENT_LABEL } from "./_lib/notify";
import { phoneOf } from "./_lib/visibility";
import { eqRange } from "./_lib/db";
import { canCreateRequest, FARMING_WINDOW_DAYS, farmingSignals } from "./rules/limits";
import { dupGroupKey, findDuplicate, responsePriority } from "./rules/duplicates";
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
    // Optional since P7: when a hospital is picked the place comes
    // from the hospital row (the SCR-M02 form does not know a picked
    // hospital's place ids); the no-hospital path validates presence.
    divisionId: v.optional(v.id("places")),
    districtId: v.optional(v.id("places")),
    upazilaId: v.optional(v.id("places")),
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

    // F-211: posting on behalf of a family is a volunteer action,
    // behind features.volunteerPost.
    if (args.source === "volunteer_paste") {
      if (!(await featureOn(ctx, "volunteerPost"))) {
        fail("ERR_VALIDATION", {}, "feature");
      }
      if (!["volunteer", "admin", "superadmin"].includes(ctx.profile.role)) {
        fail("ERR_FORBIDDEN");
      }
    }

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
      if (!args.divisionId || !args.districtId || !args.upazilaId) {
        fail("ERR_VALIDATION", {}, "place");
      }
      const [district, upazila] = await Promise.all([
        ctx.db.get(args.districtId!),
        ctx.db.get(args.upazilaId!),
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
      // Both branches above guarantee these: the hospital branch
      // takes them from the hospital row; the other branch validated
      // their presence before resolving.
      divisionId: divisionId!,
      districtId: districtId!,
      upazilaId: upazilaId!,
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

    // F-803: request-farming patterns over the last 30 days (PRD §5.8)
    // → at most one open moderation item per requester (queue is P5).
    // `live/covered/closed` were fetched pre-insert, so the new request
    // itself is appended explicitly.
    const farmingCutoff = Date.now() - FARMING_WINDOW_DAYS * 86_400_000;
    const recentRequests = [...live, ...covered, ...closed].filter(
      (r) => r._creationTime >= farmingCutoff,
    );
    const signals = farmingSignals([
      ...recentRequests.map((r) => ({
        bloodGroup: r.bloodGroup,
        hospitalId: r.hospitalId,
        closeReason: r.closeReason,
        unitsConfirmed: r.unitsConfirmed,
      })),
      {
        bloodGroup: args.bloodGroup,
        hospitalId: args.hospitalId,
        unitsConfirmed: 0,
      },
    ]);
    if (signals.length > 0) {
      const openFlags = await ctx.db
        .query("moderationItems")
        .withIndex("by_status", (q) =>
          q.eq("isDemo", ctx.profile.isDemo).eq("status", "open"),
        )
        .collect();
      const alreadyFlagged = openFlags.some(
        (item) =>
          item.kind === "request_farming" && item.subjectId === ctx.profile._id,
      );
      if (!alreadyFlagged) {
        await ctx.db.insert("moderationItems", {
          type: "flag",
          kind: "request_farming",
          subjectId: ctx.profile._id,
          requestId,
          severity: "medium",
          status: "open",
          isDemo: ctx.profile.isDemo,
        });
      }
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
      // For a merged request, expose the surviving request's slug so
      // the owner can follow it (F-707: both requesters are informed).
      let mergedSlug: string | null = null;
      if (row.mergedIntoId) {
        const survivor = await ctx.db.get(row.mergedIntoId);
        mergedSlug = survivor?.publicSlug ?? null;
      }
      page.push({
        _id: row._id,
        bloodGroup: row.bloodGroup,
        component: row.component,
        isDengue: row.isDengue,
        unitsNeeded: row.unitsNeeded,
        unitsConfirmed: row.unitsConfirmed,
        status: row.status,
        closeReason: row.closeReason ?? null,
        mergedSlug,
        postedByVolunteer: Boolean(row.createdByVolunteerId),
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
    await recordEvent(ctx, "donor_not_responding_marked", {
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

/** Hospital display name for duplicate summaries (never patient data). */
async function dupHospitalName(
  ctx: { db: GenericDatabaseReader<DataModel> },
  request: Doc<"requests">,
): Promise<string> {
  if (request.hospitalId) {
    const hospital = await ctx.db.get(request.hospitalId);
    if (hospital) return hospital.nameEn;
  }
  if (request.placeText) return request.placeText;
  const upazila = await ctx.db.get(request.upazilaId);
  return upazila?.nameEn ?? "";
}

/** Open (live/covered) requests in the caller's demo scope, newest first. */
async function openRequestsForDup(
  ctx: { db: GenericDatabaseReader<DataModel> },
  isDemo: boolean,
  bloodGroup: Doc<"requests">["bloodGroup"],
  hospitalId: Id<"hospitals"> | undefined,
  districtId: Id<"places"> | undefined,
): Promise<Doc<"requests">[]> {
  const out: Doc<"requests">[] = [];
  for (const status of ["live", "covered"] as const) {
    if (hospitalId) {
      const rows = await ctx.db
        .query("requests")
        .withIndex("by_dup", (q) =>
          q.eq("isDemo", isDemo).eq("status", status).eq("bloodGroup", bloodGroup).eq("hospitalId", hospitalId),
        )
        .collect();
      out.push(...rows);
    } else if (districtId) {
      const rows = await ctx.db
        .query("requests")
        .withIndex("by_status_district", (q) =>
          q.eq("isDemo", isDemo).eq("status", status).eq("districtId", districtId),
        )
        .collect();
      out.push(...rows.filter((r) => r.bloodGroup === bloodGroup));
    } else {
      // No district either (specs §6.2 always sends the upazila; the
      // form always has the district when it has an upazila) — a
      // bounded status scan keeps the check correct regardless.
      const rows = await ctx.db
        .query("requests")
        .withIndex("by_status_neededBy", (q) => q.eq("status", status))
        .take(200);
      out.push(...rows.filter((r) => r.isDemo === isDemo && r.bloodGroup === bloodGroup));
    }
  }
  return out;
}

/**
 * requests.repeat (F-210/R15, switch `repeatRequest`) — "Request again"
 * on a CLOSED request: copies its clinical/place/contact details; the
 * requester only adjusts the date and units (the AC). The copy goes
 * through the same form validation, creation limits and matching start
 * as a fresh post. Merged sources are refused — repeat the survivor.
 */
export const repeat = memberMutationV({
  args: {
    fromId: v.id("requests"),
    neededBy: v.number(),
    unitsNeeded: v.number(),
  },
  handler: async (ctx, args) => {
    if (!(await featureOn(ctx, "repeatRequest"))) fail("ERR_VALIDATION", {}, "feature");
    const source = await ctx.db.get(args.fromId);
    if (!source || source.isDemo !== ctx.profile.isDemo) fail("ERR_NOT_FOUND");
    if (source.requesterId !== ctx.profile._id) fail("ERR_FORBIDDEN");
    if (source.status !== "closed") fail("ERR_VALIDATION", {}, "status");
    if (source.mergedIntoId) fail("ERR_VALIDATION", {}, "mergedIntoId");

    const formCheck = validateRequestForm(
      {
        bloodGroup: source.bloodGroup,
        component: source.component,
        isDengue: source.isDengue,
        unitsNeeded: args.unitsNeeded,
        neededBy: args.neededBy,
        hospitalId: source.hospitalId,
        districtId: source.districtId,
        upazilaId: source.upazilaId,
        placeText: source.placeText,
        contactPhone: source.contactPhone,
        patientName: source.patientName,
        ward: source.ward,
        note: source.note,
      },
      Date.now(),
    );
    if (!formCheck.ok) fail("ERR_VALIDATION", {}, formCheck.field);

    // The same creation limits as a fresh post (rules/limits).
    const settings = await getRulesSettings(ctx);
    const byStatus = async (status: "live" | "covered" | "closed") =>
      await ctx.db
        .query("requests")
        .withIndex("by_requester_status", (q) =>
          q.eq("requesterId", ctx.profile._id).eq("status", status),
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
      { open: live.length + covered.length, thisMonth, isVolunteerPosting: false },
      settings,
    );
    if (!limit.ok) fail(limit.code, limit.params);

    let publicSlug = randomSlug();
    for (let attempt = 0; attempt < 3; attempt++) {
      const clash = await ctx.db
        .query("requests")
        .withIndex("by_publicSlug", (q) => q.eq("publicSlug", publicSlug))
        .first();
      if (!clash) break;
      publicSlug = randomSlug();
    }

    const contactPhone = normalisePhone(source.contactPhone)!;
    const requestId = await ctx.db.insert("requests", {
      requesterId: ctx.profile._id,
      createdByVolunteerId: undefined,
      source: "form",
      clientId: `repeat-${source._id}-${Date.now()}`,
      bloodGroup: source.bloodGroup,
      component: source.component,
      isDengue: source.isDengue,
      unitsNeeded: args.unitsNeeded,
      unitsConfirmed: 0,
      hospitalId: source.hospitalId,
      placeText: source.placeText,
      divisionId: source.divisionId,
      districtId: source.districtId,
      upazilaId: source.upazilaId,
      approxLat: source.approxLat,
      approxLng: source.approxLng,
      neededBy: args.neededBy,
      urgency: deriveUrgency(args.neededBy, Date.now()),
      patientName: source.patientName,
      ward: source.ward,
      note: source.note,
      contactPhone,
      contactPhoneVerified: ctx.profile.phoneVerified && contactPhone === ctx.profile.phone,
      lang: source.lang,
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
      aiAssisted: false,
      isDemo: ctx.profile.isDemo,
    });
    await recordEvent(ctx, "request_published", {
      requestId,
      actorRole: ctx.profile.role,
      props: { source: "repeat", fromRequestId: source._id },
      isDemo: ctx.profile.isDemo,
    });
    await ctx.scheduler.runAfter(0, startRequestRef, { requestId });
    await scheduleAutoClose(ctx, requestId, args.neededBy);
    return { requestId };
  },
});

/**
 * requests.checkDuplicate (specs §6.2, F-208 / R12) — the pre-post
 * warning. Rules only: same blood group + same hospital (or upazila)
 * within the S-31 window. Behind `features.duplicateWarning`; when
 * the switch is off the query is inert and returns no match. The
 * result carries no personal data — slug, hospital, time only (P-12).
 */
export const checkDuplicate = memberQueryV({
  args: {
    bloodGroup: requestGroup,
    hospitalId: v.optional(v.id("hospitals")),
    // Required by specs §6.2; optional here because the form does not
    // know a picked hospital's upazila — with a hospitalId the
    // hospital is the key and the upazila is not needed.
    upazilaId: v.optional(v.id("places")),
    districtId: v.optional(v.id("places")),
  },
  handler: async (ctx, args) => {
    if (!(await featureOn(ctx, "duplicateWarning"))) return {};
    if (!args.hospitalId && !args.upazilaId) return {};
    const windowHours = await getSetting<number>(ctx, "duplicateWindowHours");
    const since = Date.now() - windowHours * 3_600_000;
    const rows = await openRequestsForDup(
      ctx, ctx.profile.isDemo, args.bloodGroup, args.hospitalId, args.districtId,
    );
    const match = findDuplicate(
      rows.map((r) => ({
        id: r._id, requesterId: r.requesterId, bloodGroup: r.bloodGroup,
        hospitalId: r.hospitalId, upazilaId: r.upazilaId,
        createdAt: r._creationTime, publicSlug: r.publicSlug,
      })),
      {
        bloodGroup: args.bloodGroup,
        hospitalId: args.hospitalId,
        upazilaId: args.upazilaId ?? "",
        since,
        excludeRequesterId: ctx.profile._id,
      },
    );
    if (!match) return {};
    const matched = rows.find((r) => r._id === match.id)!;
    return {
      match: {
        slug: matched.publicSlug,
        hospitalName: await dupHospitalName(ctx, matched),
        createdAt: matched._creationTime,
      },
    };
  },
});

/**
 * requests.generateSlipUploadUrl (specs §6.2, F-209) — owner only,
 * behind features.slips. The photo goes to PRIVATE Convex storage
 * (never Cloudinary — specs reserve that for public share cards).
 */
export const generateSlipUploadUrl = memberMutationV({
  args: { requestId: v.id("requests") },
  handler: async (ctx, args) => {
    if (!(await featureOn(ctx, "slips"))) fail("ERR_VALIDATION", {}, "feature");
    const request = await ctx.db.get(args.requestId);
    if (!request || request.isDemo !== ctx.profile.isDemo) fail("ERR_NOT_FOUND");
    if (request!.requesterId !== ctx.profile._id) fail("ERR_FORBIDDEN");
    if (request!.status === "closed") fail("ERR_REQUEST_CLOSED");
    return { uploadUrl: await ctx.storage.generateUploadUrl() };
  },
});

/**
 * requests.attachSlip (specs §6.2, F-209) — owner only; the slip
 * goes to pending for volunteer checks (F-706). Posting was never
 * blocked on a slip (R13); replacing a slip deletes the old file.
 */
export const attachSlip = memberMutationV({
  args: { requestId: v.id("requests"), storageId: v.id("_storage") },
  handler: async (ctx, args) => {
    if (!(await featureOn(ctx, "slips"))) fail("ERR_VALIDATION", {}, "feature");
    const request = await ctx.db.get(args.requestId);
    if (!request || request.isDemo !== ctx.profile.isDemo) fail("ERR_NOT_FOUND");
    if (request!.requesterId !== ctx.profile._id) fail("ERR_FORBIDDEN");
    if (request!.status === "closed") fail("ERR_REQUEST_CLOSED");
    const blob = await ctx.storage.get(args.storageId);
    if (!blob) fail("ERR_VALIDATION", {}, "storageId");
    if (request!.slipFileId && request!.slipFileId !== args.storageId) {
      await ctx.storage.delete(request!.slipFileId);
    }
    await ctx.db.patch(request!._id, {
      slipFileId: args.storageId,
      slipStatus: "pending",
      slipReviewedBy: undefined,
      slipReviewReason: undefined,
    });
    await recordEvent(ctx, "slip_attached", {
      requestId: request!._id,
      actorRole: "member",
      isDemo: request!.isDemo,
    });
    return null;
  },
});

/**
 * requests.claimAsFamily (F-211 / US-V04) — the family a volunteer
 * posted for can take over the request: the request's contact number
 * (from the public post) must be the caller's own VERIFIED number.
 * Ownership moves, the contact becomes verified, and the volunteer
 * provenance (createdByVolunteerId) stays on the record.
 */
export const claimAsFamily = memberMutationV({
  args: { requestId: v.id("requests") },
  handler: async (ctx, args) => {
    if (!(await featureOn(ctx, "volunteerPost"))) {
      fail("ERR_VALIDATION", {}, "feature");
    }
    const request = await ctx.db.get(args.requestId);
    if (
      !request ||
      request.isDemo !== ctx.profile.isDemo ||
      !request.createdByVolunteerId
    ) {
      fail("ERR_NOT_FOUND");
    }
    if (request!.requesterId === ctx.profile._id) return { ok: true as const };
    if (request!.status === "closed") fail("ERR_REQUEST_CLOSED");
    if (!ctx.profile.phoneVerified) fail("ERR_FORBIDDEN");
    if (normalisePhone(ctx.profile.phone) !== normalisePhone(request!.contactPhone)) {
      fail("ERR_FORBIDDEN");
    }
    await ctx.db.patch(request!._id, {
      requesterId: ctx.profile._id,
      contactPhoneVerified: true,
    });
    await writeAudit(ctx, {
      actor: ctx.profile,
      action: "request_claimed_by_family",
      targetType: "request",
      targetId: request!._id,
    });
    await recordEvent(ctx, "request_claimed_by_family", {
      requestId: request!._id,
      actorRole: "member",
      isDemo: request!.isDemo,
    });
    return { ok: true as const };
  },
});

/**
 * requests.claimableByMe (F-211) — open volunteer-posted requests
 * whose contact number is the caller's verified number: the family's
 * path to claiming. Summaries only; the number itself is the
 * caller's own, so nothing about anyone else is revealed.
 */
export const claimableByMe = memberQueryV({
  args: {},
  handler: async (ctx) => {
    if (!(await featureOn(ctx, "volunteerPost"))) return [];
    if (!ctx.profile.phoneVerified) return [];
    const mine = normalisePhone(ctx.profile.phone);
    if (!mine) return [];
    const out = [];
    for (const status of ["live", "covered"] as const) {
      const rows = await ctx.db
        .query("requests")
        .withIndex("by_status_neededBy", (q) => q.eq("status", status))
        .collect();
      for (const row of rows) {
        if (
          row.isDemo === ctx.profile.isDemo &&
          row.createdByVolunteerId &&
          row.requesterId !== ctx.profile._id &&
          normalisePhone(row.contactPhone) === mine
        ) {
          const hospital = row.hospitalId ? await ctx.db.get(row.hospitalId) : null;
          out.push({
            requestId: row._id,
            bloodGroup: row.bloodGroup,
            component: row.component,
            hospitalName: hospital?.nameEn ?? row.placeText ?? "",
            createdAt: row._creationTime,
          });
        }
      }
    }
    return out;
  },
});

/**
 * requests.publicView (specs §6.2, F-1002) — the anonymised public
 * view behind /r/<slug> (SCR-P02). Public (no sign-in), but ONLY when
 * features.sharedLinks is on, and never for practice requests or
 * moderation-hidden ones (both read as not-found). Returns no names,
 * no numbers, nothing about any person (P-12).
 */
export const publicView = queryGeneric({
  args: { slug: v.string() },
  handler: async (ctx, args) => {
    if (!(await featureOn(ctx, "sharedLinks"))) fail("ERR_NOT_FOUND");
    const request = await ctx.db
      .query("requests")
      .withIndex("by_publicSlug", (q) => q.eq("publicSlug", args.slug))
      .unique();
    if (!request || request.isDemo || request.hiddenByModerator) {
      fail("ERR_NOT_FOUND");
    }
    const hospital = request!.hospitalId
      ? await ctx.db.get(request!.hospitalId)
      : undefined;
    const upazila = await ctx.db.get(request!.upazilaId);
    return {
      bloodGroup: request!.bloodGroup,
      component: request!.component,
      isDengue: request!.isDengue,
      unitsNeeded: request!.unitsNeeded,
      unitsConfirmed: request!.unitsConfirmed,
      hospitalName: hospital?.nameEn ?? request!.hospitalFreeText ?? "",
      areaName: upazila?.nameEn ?? "",
      neededBy: request!.neededBy,
      status: request!.status,
      lang: request!.lang,
    };
  },
});

/**
 * requests.suggestedPairs (F-707 / V06) — volunteer-facing duplicate
 * suggestions from the same rule. Pairs of open requests (different
 * requesters) sharing group + hospital/upazila inside the S-31
 * window. Summaries only — no patient names, no phones (P-12).
 */
export const suggestedPairs = volunteerQueryV({
  args: {},
  handler: async (ctx) => {
    if (!(await featureOn(ctx, "duplicateWarning"))) return [];
    const windowHours = await getSetting<number>(ctx, "duplicateWindowHours");
    const since = Date.now() - windowHours * 3_600_000;
    const open: Doc<"requests">[] = [];
    for (const status of ["live", "covered"] as const) {
      const rows = await ctx.db
        .query("requests")
        .withIndex("by_status_neededBy", (q) => q.eq("status", status))
        .collect();
      open.push(...rows.filter((r) => r.isDemo === ctx.profile.isDemo && r._creationTime >= since));
    }
    const groups = new Map<string, Doc<"requests">[]>();
    for (const r of open) {
      const key = dupGroupKey(r);
      const list = groups.get(key) ?? [];
      list.push(r);
      groups.set(key, list);
    }
    const pairs: {
      aId: Id<"requests">; bId: Id<"requests">; bloodGroup: string;
      hospitalName: string; aCreatedAt: number; bCreatedAt: number;
    }[] = [];
    for (const list of groups.values()) {
      const sorted = [...list].sort((a, b) => a._creationTime - b._creationTime);
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          if (sorted[i].requesterId === sorted[j].requesterId) continue;
          pairs.push({
            aId: sorted[i]._id, bId: sorted[j]._id,
            bloodGroup: sorted[i].bloodGroup,
            hospitalName: await dupHospitalName(ctx, sorted[i]),
            aCreatedAt: sorted[i]._creationTime, bCreatedAt: sorted[j]._creationTime,
          });
        }
      }
    }
    return pairs.slice(0, 20);
  },
});

/**
 * requests.merge (specs §6.2, F-707 / V06) — a volunteer merges the
 * duplicate `fromId` into the surviving `intoId`:
 * - every response moves to the survivor; a donor present on both
 *   keeps their stronger state (a confirmed slot is never lost);
 * - contact reveals follow their request, so whoHasMyNumber stays
 *   truthful (visibility rules unchanged — no new phone exposure);
 * - the survivor's confirmed count is recomputed and capped at
 *   units + S-12 (newest surplus confirmations step back to standby);
 * - `from` closes with reason `merged` + mergedIntoId, which stops
 *   its waves (runWave/autoClose guard on status) — no more duplicate
 *   notifications. Both requesters see the outcome in-app: the merged
 *   request points at the survivor, and the survivor shows the moved
 *   donors. (No push template for merges exists in specs §6.8 — see
 *   the P7 report's copy-gap note.)
 */
export const merge = volunteerMutationV({
  args: { fromId: v.id("requests"), intoId: v.id("requests") },
  handler: async (ctx, args) => {
    if (!(await featureOn(ctx, "duplicateWarning"))) fail("ERR_VALIDATION", {}, "feature");
    if (args.fromId === args.intoId) fail("ERR_VALIDATION", {}, "intoId");
    const from = await ctx.db.get(args.fromId);
    const into = await ctx.db.get(args.intoId);
    if (
      !from || !into ||
      from!.isDemo !== ctx.profile.isDemo || into!.isDemo !== ctx.profile.isDemo
    ) {
      fail("ERR_NOT_FOUND");
    }
    const src = from!;
    const dst = into!;
    if (src.status === "closed" || dst.status === "closed") {
      fail("ERR_REQUEST_CLOSED");
    }

    // Move responses, deduping per donor by stronger state.
    const allFromResponses = await allResponses(ctx, src._id);
    const intoResponses = await allResponses(ctx, dst._id);
    const intoByDonor = new Map(intoResponses.map((r) => [r.donorProfileId, r]));
    let moved = 0;
    let deduped = 0;
    for (const response of allFromResponses) {
      const existing = intoByDonor.get(response.donorProfileId);
      if (!existing) {
        await ctx.db.patch(response._id, { requestId: dst._id });
        intoByDonor.set(response.donorProfileId, { ...response, requestId: dst._id });
        moved += 1;
        continue;
      }
      // Donor on both: the stronger state survives on the target row;
      // the weaker row is removed (its history is in the merge event).
      deduped += 1;
      if (responsePriority(response.state) > responsePriority(existing.state)) {
        await ctx.db.patch(existing._id, {
          state: response.state,
          wave: response.wave,
          acceptedAt: response.acceptedAt,
          confirmedAt: response.confirmedAt,
          openedAt: response.openedAt ?? existing.openedAt,
          stillComingAnswer: response.stillComingAnswer,
          stillComingAnsweredAt: response.stillComingAnsweredAt,
        });
        intoByDonor.set(response.donorProfileId, { ...existing, state: response.state });
      }
      await ctx.db.delete(response._id);
    }

    // Reveals follow the surviving request.
    const reveals = await ctx.db
      .query("contactReveals")
      .withIndex("by_request", (q) => q.eq("requestId", src._id))
      .collect();
    for (const reveal of reveals) {
      await ctx.db.patch(reveal._id, { requestId: dst._id });
    }

    // Recompute the survivor's confirmed count with the S-12 cap.
    const extraConfirmedSlots = await getSetting<number>(ctx, "extraConfirmedSlots");
    const survivors = await allResponses(ctx, dst._id);
    const confirmed = survivors
      .filter((r) => r.state === "confirmed")
      .sort((a, b) => (a.confirmedAt ?? a._creationTime) - (b.confirmedAt ?? b._creationTime));
    const cap = dst.unitsNeeded + extraConfirmedSlots;
    let demoted = 0;
    for (const surplus of confirmed.slice(cap)) {
      await ctx.db.patch(surplus._id, { state: "standby" });
      demoted += 1;
    }
    const confirmedCount = Math.min(confirmed.length, cap);
    const unitsConfirmed = Math.min(confirmedCount, dst.unitsNeeded);
    const covered = unitsConfirmed >= dst.unitsNeeded;
    await ctx.db.patch(dst._id, {
      unitsConfirmed,
      status: covered ? "covered" : "live",
      nextWaveAt: covered ? undefined : dst.nextWaveAt,
    });

    // Close the duplicate.
    await ctx.db.patch(src._id, {
      status: "closed",
      closeReason: "merged",
      mergedIntoId: dst._id,
      closedAt: Date.now(),
      nextWaveAt: undefined,
    });

    await writeAudit(ctx, {
      actor: ctx.profile,
      action: "request_merged",
      targetType: "request",
      targetId: dst._id,
      meta: { fromId: src._id, moved, deduped, demoted, revealsMoved: reveals.length },
    });
    await recordEvent(ctx, "request_merged", {
      requestId: dst._id,
      actorRole: ctx.profile.role,
      props: { fromId: src._id, moved, deduped, demoted },
      isDemo: dst.isDemo,
    });
    return null;
  },
});
