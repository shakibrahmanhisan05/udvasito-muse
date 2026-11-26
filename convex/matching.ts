import { internalMutationGeneric, makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Doc, Id } from "./schemaTypes";
import { getRulesSettings, getSetting, type RulesSettings } from "./_lib/settings";
import { recordEvent } from "./_lib/events";
import { recordContactReveal, requesterUnderRevealCap } from "./_lib/visibility";
import { notifyUser, COMPONENT_LABEL, formatTimeDhaka } from "./_lib/notify";
import { eqRange } from "./_lib/db";
import { groupsFor } from "./rules/compatibility";
import { canDonate } from "./rules/eligibility";
import { nextWaveSize, nextWaveAt } from "./rules/waves";
import { haversineKm, rankCandidates } from "./rules/ranking";
import { alertAllowed, noShowCountWithin, startOfDhakaDay } from "./rules/alertPolicy";

/**
 * Matching (specs §6.6, PRD §5.3–§5.4, roadmap P2 F-301/F-302/F-204/F-704):
 * the full deterministic filter set (live, verified phone, availability,
 * eligibility, group rule, platelet opt-in, blocks, verified-requests-only,
 * travel range, daily alert cap S-20, quiet hours S-21), ranked by place
 * tier → exact-before-compatible → recency → alert load → no-shows.
 * Waves 1..S-10 run on S-09 intervals; compatible groups appear ONLY in
 * the final wave (S-11, OQ-03) and are flagged `compatibleGroup` so the
 * alert can be labelled. After the final wave's interval, `escalate`
 * notifies admins and on-duty district volunteers (F-704, P3).
 */

type Ctx = GenericMutationCtx<DataModel>;
type Request = Doc<"requests">;

const volunteerHotlineRef = makeFunctionReference<"mutation">("matching:volunteerHotline");
const runWaveRef = makeFunctionReference<"mutation">("matching:runWave");
const escalateRef = makeFunctionReference<"mutation">("matching:escalate");
const stillComingCheckRef = makeFunctionReference<"mutation">("lifecycle:stillComingCheck");
const confirmationPromptRef = makeFunctionReference<"mutation">("lifecycle:confirmationPrompt");

export async function allResponses(
  ctx: Ctx | GenericQueryCtx<DataModel>,
  requestId: Id<"requests">,
) {
  return await ctx.db
    .query("responses")
    .withIndex("by_request_state", eqRange([["requestId", requestId]]))
    .collect();
}

export type Candidate = {
  donor: Doc<"donorProfiles">;
  profile: Doc<"profiles">;
  distanceKm: number;
  /** True when the donor's group is a compatible (not exact) match. */
  compatibleGroup: boolean;
};

/** Every response ever created for a donor (alert-load counting). */
async function donorResponses(ctx: Ctx, donorProfileId: Id<"profiles">) {
  return await ctx.db
    .query("responses")
    .withIndex("by_donor_state", eqRange([["donorId", donorProfileId]]))
    .collect();
}

/**
 * Eligible donors not yet notified for this request, fully ranked
 * (PRD §5.3). The candidate pool is the request's district: a donor's
 * travel range caps at their own district ("thana" caps at their
 * upazila), so tiers 0–2 apply inside the pool and neighbour thanas
 * (S-32, precomputed on `places`) rank above the rest of the district.
 */
export async function eligibleCandidates(
  ctx: Ctx,
  request: Request,
  settings: RulesSettings,
  opts: { finalWave: boolean } = { finalWave: false },
): Promise<Candidate[]> {
  const { exact, compatible } = groupsFor(
    request.bloodGroup,
    request.component,
    opts.finalWave,
    settings,
  );
  const groups = [...exact, ...compatible];
  if (groups.length === 0) return [];
  const already = new Set((await allResponses(ctx, request._id)).map((r) => r.donorProfileId));
  const now = Date.now();
  const dayStart = startOfDhakaDay(now);
  const weekAgo = now - 7 * 86_400_000;
  const requestUpazila = await ctx.db.get(request.upazilaId);
  const neighbourIds = (requestUpazila?.neighbourIds ?? []).map(String);
  const out: (Candidate & {
    rank: {
      donorProfileId: string; upazilaId: string; districtId: string; divisionId: string;
      lastActiveAt: number; alertsLast7Days: number; exactGroup: boolean; noShowCount: number;
    };
  })[] = [];
  for (const group of groups) {
    const donors = await ctx.db
      .query("donorProfiles")
      .withIndex(
        "by_match",
        eqRange([
          ["isDemo", request.isDemo],
          ["live", true],
          ["bloodGroup", group],
          ["districtId", request.districtId],
        ]),
      )
      .collect();
    for (const donor of donors) {
      if (already.has(donor._id)) continue;
      const profile = await ctx.db.get(donor.profileId);
      if (!profile || profile.status !== "active" || !profile.phoneVerified) continue;
      if (profile._id === request.requesterId) continue;
      const blockedA = await ctx.db
        .query("blocks")
        .withIndex("by_pair", eqRange([["blockerId", request.requesterId], ["blockedId", profile._id]]))
        .first();
      const blockedB = await ctx.db
        .query("blocks")
        .withIndex("by_pair", eqRange([["blockerId", profile._id], ["blockedId", request.requesterId]]))
        .first();
      if (blockedA || blockedB) continue;
      // "Verified requests only" (F-301): the donor opted to hear only
      // about requests whose contact number is verified.
      if (donor.verifiedRequestsOnly && !request.contactPhoneVerified) continue;
      // Availability (F-602): paused donors are out until their pause ends
      // (the hourly cron flips them back; an elapsed pause counts as over).
      if (donor.availability === "unavailable") continue;
      if (
        donor.availability === "paused" &&
        (donor.pausedUntil === undefined || donor.pausedUntil > now)
      ) {
        continue;
      }
      // Travel range (F-601): "thana" donors only travel within their upazila.
      if (donor.travelRange === "thana" && donor.upazilaId !== request.upazilaId) continue;
      const check = canDonate(
        {
          gender: donor.gender,
          neverDonated: donor.neverDonated,
          lastDonationDate: donor.lastDonationDate,
          lastDonationType: donor.lastDonationType,
          plateletOptIn: donor.plateletOptIn,
        },
        request.component,
        now,
        settings,
        profile.dateOfBirth,
      );
      if (!check.ok) continue;
      // Alert cap (S-20) + quiet hours (S-21), per-donor values (PRD §5.3).
      const history = await donorResponses(ctx, profile._id);
      const alertsToday = history.filter((r) => r.notifiedAt >= dayStart).length;
      const allowed = alertAllowed({
        now,
        alertsToday,
        capPerDay: donor.alertCapPerDay,
        quietStart: donor.quietStart,
        quietEnd: donor.quietEnd,
        urgency: request.urgency,
        urgentOverride: donor.urgentOverride,
      });
      if (!allowed) continue;
      const place = await ctx.db.get(donor.upazilaId);
      const distanceKm = place
        ? haversineKm(place, { lat: request.approxLat, lng: request.approxLng })
        : Number.POSITIVE_INFINITY;
      out.push({
        donor,
        profile,
        distanceKm,
        compatibleGroup: !exact.includes(donor.bloodGroup as never),
        rank: {
          donorProfileId: String(donor._id),
          upazilaId: String(donor.upazilaId),
          districtId: String(donor.districtId),
          divisionId: String(donor.divisionId),
          lastActiveAt: profile.lastActiveAt,
          alertsLast7Days: history.filter((r) => r.notifiedAt >= weekAgo).length,
          exactGroup: exact.includes(donor.bloodGroup as never),
          noShowCount: noShowCountWithin(donor.noShowAt, now, settings.noShowPenalty.days),
        },
      });
    }
  }
  const ranked = rankCandidates(
    out.map((c) => c.rank),
    {
      upazilaId: String(request.upazilaId),
      districtId: String(request.districtId),
      divisionId: String(request.divisionId),
      neighbourUpazilaIds: neighbourIds,
    },
  );
  const byId = new Map(out.map((c) => [String(c.donor._id), c]));
  return ranked
    .map((r) => byId.get(r.donorProfileId)!)
    .filter((c) => c !== undefined)
    .map(({ donor, profile, distanceKm, compatibleGroup }) => ({
      donor, profile, distanceKm, compatibleGroup,
    }));
}

async function hospitalName(ctx: Ctx, request: Request): Promise<string> {
  if (request.hospitalId) {
    const hospital = await ctx.db.get(request.hospitalId);
    if (hospital) return hospital.nameEn;
  }
  return request.placeText ?? "";
}

async function doWave(ctx: Ctx, request: Request, waveNumber: number): Promise<{ sent: number }> {
  if (request.status !== "live") return { sent: 0 };
  if (waveNumber < 1) return { sent: 0 };
  if (request.wave >= waveNumber) return { sent: 0 }; // already ran (idempotent)
  const settings = await getRulesSettings(ctx);
  if (waveNumber > settings.waveCount) return { sent: 0 };
  const responses = await allResponses(ctx, request._id);
  const openedUnanswered = responses.filter((r) => r.state === "opened").length;
  const size = nextWaveSize(waveNumber, openedUnanswered, settings);
  const finalWave = waveNumber >= settings.waveCount;
  const candidates = size > 0
    ? await eligibleCandidates(ctx, request, settings, { finalWave })
    : [];
  const chosen = candidates.slice(0, size);
  const name = await hospitalName(ctx, request);
  for (const candidate of chosen) {
    await ctx.db.insert("responses", {
      requestId: request._id,
      donorProfileId: candidate.donor._id,
      donorId: candidate.profile._id,
      wave: waveNumber,
      state: "notified",
      notifiedAt: Date.now(),
      callMode: candidate.donor.callMode,
      isDemo: request.isDemo,
    });
    await notifyUser(ctx, {
      recipient: candidate.profile,
      template: "NTF-01",
      requestId: request._id,
      params: {
        group: request.bloodGroup === "any" ? candidate.donor.bloodGroup : request.bloodGroup,
        component: COMPONENT_LABEL[candidate.profile.language][request.component],
        hospital: name,
        units: request.unitsNeeded,
        time: formatTimeDhaka(request.neededBy),
        km: Math.round(candidate.distanceKm * 10) / 10,
        urgent: request.urgency === "now" ? "1" : "",
      },
      url: `/alerts/${request._id}`,
      channelId: "urgent-requests",
    });
  }
  // Advance the wave clock and chain the next step (specs §6.6): the next
  // wave after S-09, or escalation one interval after the final wave.
  const fresh = await ctx.db.get(request._id);
  if (fresh && fresh.status === "live") {
    const intervalMs = settings.waveIntervalMin[fresh.urgency] * 60_000;
    if (waveNumber < settings.waveCount) {
      await ctx.db.patch(request._id, {
        wave: waveNumber,
        nextWaveAt: nextWaveAt(fresh, settings),
      });
      await ctx.scheduler.runAfter(intervalMs, runWaveRef, {
        requestId: request._id,
        wave: waveNumber + 1,
      });
    } else {
      await ctx.db.patch(request._id, { wave: waveNumber, nextWaveAt: undefined });
      await ctx.scheduler.runAfter(intervalMs, escalateRef, { requestId: request._id });
    }
  }
  if (chosen.length > 0) {
    await recordEvent(ctx, "wave_sent", {
      requestId: request._id,
      actorRole: "system",
      props: {
        n: waveNumber,
        size: chosen.length,
        compatible: chosen.filter((c) => c.compatibleGroup).length,
      },
      isDemo: request.isDemo,
    });
  }
  return { sent: chosen.length };
}

/** internal.matching.startRequest (specs §6.6) — scheduled by requests.create. */
export const startRequest = internalMutationGeneric({
  args: { requestId: v.id("requests") },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request || request.status === "closed") return { sent: 0 };
    const settings = await getRulesSettings(ctx);
    const candidates = await eligibleCandidates(ctx, request, settings);
    await ctx.db.patch(request._id, { zeroEligibleAtPublish: candidates.length === 0 });
    // F-702/V09: on-duty volunteers covering the area are told about the
    // new request at the same moment it publishes (NTF-03).
    await notifyOnDutyVolunteers(ctx, request, "NTF-03");
    const delaySec = await getSetting<number>(ctx, "volunteerHotlineDelaySec");
    await ctx.scheduler.runAfter(delaySec * 1000, volunteerHotlineRef, {
      requestId: request._id,
    });
    // "not_sure" requests alert volunteers, not donors (PRD §5.2).
    if (request.bloodGroup === "not_sure") return { sent: 0 };
    return await doWave(ctx, request, 1);
  },
});

/**
 * On-duty, approved volunteers covering a request's area (its upazila,
 * or its whole district), on the same side of the practice wall.
 * Shared by the publish fan-out (NTF-03) and escalation (NTF-07, F-704).
 */
export async function onDutyVolunteersCovering(
  ctx: Ctx,
  request: Request,
): Promise<{ vp: Doc<"volunteerProfiles">; profile: Doc<"profiles"> }[]> {
  const onDuty = await ctx.db
    .query("volunteerProfiles")
    .withIndex(
      "by_duty",
      eqRange([["isDemo", request.isDemo], ["status", "approved"], ["onDuty", true]]),
    )
    .collect();
  const out: { vp: Doc<"volunteerProfiles">; profile: Doc<"profiles"> }[] = [];
  for (const vp of onDuty) {
    let covers = vp.districtIds.includes(request.districtId) || vp.upazilaIds.includes(request.upazilaId);
    if (!covers) {
      // A thana-level roster in the same district still counts as
      // covering the district for escalation (V03: "volunteers of that
      // district") — resolve the thanas' parent districts.
      for (const upazilaId of vp.upazilaIds) {
        const upazila = await ctx.db.get(upazilaId);
        if (upazila?.parentId === request.districtId) {
          covers = true;
          break;
        }
      }
    }
    if (!covers) continue;
    const profile = await ctx.db.get(vp.profileId);
    if (profile && profile.status === "active") out.push({ vp, profile });
  }
  return out;
}

async function notifyOnDutyVolunteers(
  ctx: Ctx,
  request: Request,
  template: "NTF-03" | "NTF-07",
): Promise<number> {
  const covering = await onDutyVolunteersCovering(ctx, request);
  const name = await hospitalName(ctx, request);
  const area = await ctx.db.get(request.upazilaId);
  const minutes = Math.max(1, Math.round((Date.now() - request._creationTime) / 60_000));
  for (const { profile } of covering) {
    await notifyUser(ctx, {
      recipient: profile,
      template,
      requestId: request._id,
      params:
        template === "NTF-03"
          ? {
              area: area?.nameEn ?? "",
              group: request.bloodGroup,
              component: COMPONENT_LABEL[profile.language][request.component],
              hospital: name,
              time: formatTimeDhaka(request.neededBy),
            }
          : { group: request.bloodGroup, hospital: name, min: minutes },
      url: `/volunteer/request/${request._id}`,
      channelId: template === "NTF-07" ? "urgent-requests" : "updates",
    });
  }
  return covering.length;
}

/** internal.matching.runWave (specs §6.6). */
export const runWave = internalMutationGeneric({
  args: { requestId: v.id("requests"), wave: v.number() },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request) return { sent: 0 };
    return await doWave(ctx, request, args.wave);
  },
});

/**
 * internal.matching.escalate (specs §6.6, F-704): one interval after
 * the final wave, if the request is still live with no confirmed donor
 * and no volunteer claim, notify the on-duty volunteers in the district
 * AND the admins (NTF-07). `escalatedAt` makes it fire exactly once.
 */
export const escalate = internalMutationGeneric({
  args: { requestId: v.id("requests") },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request || request.status !== "live" || request.escalatedAt) return;
    if (request.claimedByVolunteerId) return;
    const responses = await allResponses(ctx, request._id);
    if (responses.some((r) => r.state === "confirmed")) return;
    const name = await hospitalName(ctx, request);
    const minutes = Math.max(1, Math.round((Date.now() - request._creationTime) / 60_000));
    const admins: Doc<"profiles">[] = [];
    for (const roleName of ["admin", "superadmin"] as const) {
      const rows = await ctx.db
        .query("profiles")
        .withIndex("by_role", (q) => q.eq("role", roleName))
        .collect();
      admins.push(
        ...rows.filter((p) => p.status === "active" && p.isDemo === request.isDemo),
      );
    }
    for (const admin of admins) {
      await notifyUser(ctx, {
        recipient: admin,
        template: "NTF-07",
        requestId: request._id,
        params: { group: request.bloodGroup, hospital: name, min: minutes },
        url: `/volunteer/request/${request._id}`,
        channelId: "urgent-requests",
      });
    }
    const volunteersNotified = await notifyOnDutyVolunteers(ctx, request, "NTF-07");
    await ctx.db.patch(request._id, { escalatedAt: Date.now() });
    await recordEvent(ctx, "request_escalated", {
      requestId: request._id,
      actorRole: "system",
      props: { admins: admins.length, volunteers: volunteersNotified },
      isDemo: request.isDemo,
    });
  },
});

/**
 * Shared confirm side-effects for a standby → confirmed promotion
 * (specs §6.3/§6.6): reveals through visibility only, units/status
 * recompute, NTF-16 to the donor, NTF-04 to the requester, still-coming
 * checks and the first-reveal confirmation prompt. Used by withdraw,
 * not-responding and still-coming-timeout flows.
 */
export async function confirmStandbyResponse(
  ctx: Ctx,
  request: Request,
  response: Doc<"responses">,
): Promise<void> {
  const now = Date.now();
  const donorProfile = await ctx.db.get(response.donorId);
  const donor = await ctx.db.get(response.donorProfileId);
  const requester = await ctx.db.get(request.requesterId);
  if (!donorProfile || !requester) return;
  const hadReveals =
    (await ctx.db
      .query("contactReveals")
      .withIndex("by_request", eqRange([["requestId", request._id]]))
      .collect()).length > 0;
  await ctx.db.patch(response._id, { state: "confirmed", confirmedAt: now });
  let revealed = false;
  if (!request.revealsFrozen) {
    const visibleDays = await getSetting<number>(ctx, "contactVisibleAfterCloseDays");
    const expiresAt = now + visibleDays * 86_400_000;
    await recordContactReveal(ctx, {
      viewer: donorProfile,
      subject: requester,
      subjectRole: "requester",
      requestId: request._id,
      reason: "confirmed_slot",
      expiresAt,
      isDemo: request.isDemo,
    });
    revealed = true;
    if (response.callMode === "mutual") {
      // S-23 applies on EVERY reveal path (P2 review S3-F1): a promotion
      // must not push the requester past the daily reveal cap.
      if (await requesterUnderRevealCap(ctx, requester._id, now)) {
        await recordContactReveal(ctx, {
          viewer: requester,
          subject: donorProfile,
          subjectRole: "donor",
          requestId: request._id,
          reason: "confirmed_slot",
          expiresAt,
          isDemo: request.isDemo,
        });
      } else {
        await recordEvent(ctx, "reveal_cap_reached", {
          requestId: request._id,
          actorRole: "system",
          props: {
            cap: await getSetting<number>(ctx, "revealsPerRequesterPerDay"),
            via: "promotion",
          },
          isDemo: request.isDemo,
        });
      }
    }
    await recordEvent(ctx, "contact_shared", {
      requestId: request._id,
      actorRole: "system",
      props: { mode: response.callMode },
      isDemo: request.isDemo,
    });
  }
  const responses = await allResponses(ctx, request._id);
  const confirmedCount = responses.filter((r) => r.state === "confirmed").length;
  const unitsConfirmed = Math.min(confirmedCount, request.unitsNeeded);
  await ctx.db.patch(request._id, {
    unitsConfirmed,
    status: unitsConfirmed >= request.unitsNeeded ? "covered" : "live",
  });
  await recordEvent(ctx, "donor_confirmed", {
    requestId: request._id,
    actorRole: "system",
    isDemo: request.isDemo,
  });
  const name = await hospitalName(ctx, request);
  await notifyUser(ctx, {
    recipient: donorProfile,
    template: "NTF-16",
    requestId: request._id,
    params: {
      group: request.bloodGroup === "any" ? (donor?.bloodGroup ?? "") : request.bloodGroup,
      hospital: name,
    },
    url: `/alerts/${request._id}`,
    channelId: "urgent-requests",
  });
  await notifyUser(ctx, {
    recipient: requester,
    template: "NTF-04",
    requestId: request._id,
    params: { name: donorProfile.firstName },
    url: `/request/${request._id}`,
    channelId: "updates",
    donorCallsBody: response.callMode === "donor_calls",
  });
  await scheduleStillComingChecks(ctx, { ...request, unitsConfirmed }, response._id);
  // Only arm the confirmation prompt when a reveal actually happened
  // (P2 review S4-F7 — mirrors the accept path's `revealed &&` guard).
  if (revealed && !hadReveals) await scheduleConfirmationPrompt(ctx, request);
}

/** First standby (earliest acceptor) for a request, if any. */
export async function firstStandby(ctx: Ctx, requestId: Id<"requests">) {
  const responses = await allResponses(ctx, requestId);
  return responses
    .filter((r) => r.state === "standby")
    .sort((a, b) => (a.acceptedAt ?? 0) - (b.acceptedAt ?? 0))[0];
}

/**
 * After a confirmed slot frees up: promote the first standby, or — with
 * no standby — run the next wave at once (specs §6.6). Also restores
 * `live` when a covered request drops below its needed units (PRD §5.6).
 */
export async function promoteStandbyOrWave(ctx: Ctx, request: Request): Promise<void> {
  const fresh = await ctx.db.get(request._id);
  if (!fresh || fresh.status === "closed") return;
  const responses = await allResponses(ctx, fresh._id);
  const confirmedCount = responses.filter((r) => r.state === "confirmed").length;
  const unitsConfirmed = Math.min(confirmedCount, fresh.unitsNeeded);
  const standby = await firstStandby(ctx, fresh._id);
  if (standby) {
    await ctx.db.patch(fresh._id, { unitsConfirmed });
    await confirmStandbyResponse(ctx, { ...fresh, unitsConfirmed }, standby);
    return;
  }
  await ctx.db.patch(fresh._id, {
    unitsConfirmed,
    status: unitsConfirmed >= fresh.unitsNeeded ? fresh.status : "live",
  });
  const settings = await getRulesSettings(ctx);
  if (fresh.wave < settings.waveCount) {
    await doWave(ctx, { ...fresh, status: "live" }, fresh.wave + 1);
  }
}

/**
 * Schedule the two "Still coming?" checks for a confirmed response
 * (specs §6.6): S-15 after confirmation (urgency-aware) and S-15c before
 * needed-by. The checks themselves are idempotent.
 */
export async function scheduleStillComingChecks(
  ctx: Ctx,
  request: Request,
  responseId: Id<"responses">,
): Promise<void> {
  const after = await getSetting<{ now: number; other: number }>(ctx, "stillComingAfterMin");
  const delayMin = request.urgency === "now" ? after.now : after.other;
  await ctx.scheduler.runAfter(delayMin * 60_000, stillComingCheckRef, {
    responseId,
    round: 1,
  });
  const beforeMin = await getSetting<number>(ctx, "stillComingBeforeNeededMin");
  const at = request.neededBy - beforeMin * 60_000;
  if (at > Date.now()) {
    await ctx.scheduler.runAfter(at - Date.now(), stillComingCheckRef, {
      responseId,
      round: 2,
    });
  }
}

/** Schedule the S-19 donation-confirmation prompt (first reveal only). */
export async function scheduleConfirmationPrompt(ctx: Ctx, request: Request): Promise<void> {
  const hours = await getSetting<number>(ctx, "confirmPromptHours");
  await ctx.scheduler.runAfter(hours * 3_600_000, confirmationPromptRef, {
    requestId: request._id,
    reminder: false,
  });
}

/**
 * internal.matching.volunteerHotline (specs §6.6, F-504/V09 fallback part):
 * at +S-13, if no donor has accepted, show up to S-14 on-duty volunteers
 * covering the area (least-busy rotation); if none are on duty, flag the
 * fallback so the requester is offered the helpline (D-R3).
 */
export const volunteerHotline = internalMutationGeneric({
  args: { requestId: v.id("requests") },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request || request.status !== "live") return;
    const responses = await allResponses(ctx, request._id);
    if (responses.some((r) => r.state === "accepted" || r.state === "confirmed")) return;

    const maxShown = await getSetting<number>(ctx, "maxVolunteersShown");
    const onDuty = await ctx.db
      .query("volunteerProfiles")
      .withIndex(
        "by_duty",
        eqRange([["isDemo", request.isDemo], ["status", "approved"], ["onDuty", true]]),
      )
      .collect();
    const covering = onDuty
      .filter(
        (vp) => vp.districtIds.includes(request.districtId) || vp.upazilaIds.includes(request.upazilaId),
      )
      .sort((a, b) => (a.lastShownAt ?? 0) - (b.lastShownAt ?? 0) || a.activeClaims - b.activeClaims)
      .slice(0, maxShown);

    if (covering.length === 0) {
      await ctx.db.patch(request._id, { fallbackShown: true });
      return;
    }
    const requester = await ctx.db.get(request.requesterId);
    if (!requester) return;
    const visibleDays = await getSetting<number>(ctx, "contactVisibleAfterCloseDays");
    const name = await hospitalName(ctx, request);
    const shownIds = [...request.volunteerShownIds];
    for (const vp of covering) {
      const volunteer = await ctx.db.get(vp.profileId);
      if (!volunteer) continue;
      await recordContactReveal(ctx, {
        viewer: requester,
        subject: volunteer,
        subjectRole: "volunteer",
        requestId: request._id,
        reason: "volunteer_hotline",
        expiresAt: Date.now() + visibleDays * 86_400_000,
        isDemo: request.isDemo,
      });
      await ctx.db.patch(vp._id, { lastShownAt: Date.now() });
      shownIds.push(vp._id);
      await notifyUser(ctx, {
        recipient: volunteer,
        template: "NTF-05",
        requestId: request._id,
        params: { group: request.bloodGroup, hospital: name },
        url: `/volunteer/request/${request._id}`,
        channelId: "updates",
      });
    }
    await ctx.db.patch(request._id, {
      volunteerShownIds: shownIds,
      volunteerShownAt: Date.now(),
      fallbackShown: false,
    });
    await notifyUser(ctx, {
      recipient: requester,
      template: "NTF-06",
      requestId: request._id,
      params: {},
      url: `/request/${request._id}`,
      channelId: "updates",
    });
    await recordEvent(ctx, "volunteer_notified", {
      requestId: request._id,
      actorRole: "system",
      props: { count: covering.length },
      isDemo: request.isDemo,
    });
    await recordEvent(ctx, "volunteer_shown", {
      requestId: request._id,
      actorRole: "system",
      props: { count: covering.length },
      isDemo: request.isDemo,
    });
  },
});
