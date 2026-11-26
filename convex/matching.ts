import { internalMutationGeneric, makeFunctionReference } from "convex/server";
import { v } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Doc, Id } from "./schemaTypes";
import { getRulesSettings, getSetting, type RulesSettings } from "./_lib/settings";
import { recordEvent } from "./_lib/events";
import { recordContactReveal } from "./_lib/visibility";
import { notifyUser, COMPONENT_LABEL, formatTimeDhaka } from "./_lib/notify";
import { eqRange } from "./_lib/db";
import { groupsFor } from "./rules/compatibility";
import { canDonate } from "./rules/eligibility";
import { nextWaveSize, nextWaveAt } from "./rules/waves";
import { haversineKm } from "./rules/ranking";

/**
 * Matching v1 (specs §6.6, roadmap P1 F-301/F-302): eligibility + EXACT
 * group compatibility + same district, ranked by simple distance.
 * Waves 2–3, compatible groups, alert caps and quiet hours are P2.
 */

type Ctx = GenericMutationCtx<DataModel>;
type Request = Doc<"requests">;

const volunteerHotlineRef = makeFunctionReference<"mutation">("matching:volunteerHotline");

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
};

/** Eligible, exact-group, same-district donors not yet notified. */
export async function eligibleCandidates(
  ctx: Ctx,
  request: Request,
  settings: RulesSettings,
): Promise<Candidate[]> {
  const { exact } = groupsFor(request.bloodGroup, request.component, false, settings);
  if (exact.length === 0) return [];
  const already = new Set((await allResponses(ctx, request._id)).map((r) => r.donorProfileId));
  const out: Candidate[] = [];
  for (const group of exact) {
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
        Date.now(),
        settings,
        profile.dateOfBirth,
      );
      if (!check.ok) continue;
      const place = await ctx.db.get(donor.upazilaId);
      const distanceKm = place
        ? haversineKm(place, { lat: request.approxLat, lng: request.approxLng })
        : Number.POSITIVE_INFINITY;
      out.push({ donor, profile, distanceKm });
    }
  }
  // Simple distance ranking (P1); full PRD §5.3 tiers land in P2.
  out.sort((a, b) => a.distanceKm - b.distanceKm || b.profile.lastActiveAt - a.profile.lastActiveAt);
  return out;
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
  const settings = await getRulesSettings(ctx);
  const responses = await allResponses(ctx, request._id);
  const openedUnanswered = responses.filter((r) => r.state === "opened").length;
  const size = nextWaveSize(waveNumber, openedUnanswered, settings);
  if (size <= 0) return { sent: 0 };
  const candidates = await eligibleCandidates(ctx, request, settings);
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
  if (chosen.length > 0) {
    await ctx.db.patch(request._id, {
      wave: waveNumber,
      nextWaveAt: nextWaveAt(request, settings),
    });
    await recordEvent(ctx, "wave_sent", {
      requestId: request._id,
      actorRole: "system",
      props: { n: waveNumber, size: chosen.length },
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
    const delaySec = await getSetting<number>(ctx, "volunteerHotlineDelaySec");
    await ctx.scheduler.runAfter(delaySec * 1000, volunteerHotlineRef, {
      requestId: request._id,
    });
    // "not_sure" requests alert volunteers, not donors (PRD §5.2).
    if (request.bloodGroup === "not_sure") return { sent: 0 };
    return await doWave(ctx, request, 1);
  },
});

/** internal.matching.runWave (specs §6.6) — P1 runs wave 1 via startRequest. */
export const runWave = internalMutationGeneric({
  args: { requestId: v.id("requests"), wave: v.number() },
  handler: async (ctx, args) => {
    const request = await ctx.db.get(args.requestId);
    if (!request) return { sent: 0 };
    return await doWave(ctx, request, args.wave);
  },
});

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
