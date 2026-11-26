import { v } from "convex/values";
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel, Doc, Id } from "./schemaTypes";
import {
  memberMutationV,
  memberQueryV,
  volunteerMutationV,
  volunteerQueryV,
  type Profile,
} from "./_lib/auth";
import { fail } from "./_lib/errors";
import { getRulesSettings, getSetting } from "./_lib/settings";
import { writeAudit } from "./_lib/audit";
import { recordEvent } from "./_lib/events";
import { notifyUser, COMPONENT_LABEL, formatTimeDhaka } from "./_lib/notify";
import { recordContactReveal, phoneOf } from "./_lib/visibility";
import { limitOrThrow } from "./_lib/ratelimit";
import { eqRange } from "./_lib/db";
import { groupsFor } from "./rules/compatibility";
import { canDonate } from "./rules/eligibility";
import { haversineKm } from "./rules/ranking";
import { validateReason, validateVolunteerApplication } from "./rules/validation";
import { allResponses } from "./matching";

/**
 * Volunteers (specs §6.4, roadmap P3: F-701/F-702/F-703/F-705).
 *
 * Privacy contract (PRD §3.3, phase DoD): a volunteer receives the
 * REQUESTER's number only through `openCase` (one logged reveal per
 * request) or the hotline path in matching.ts — and a DONOR's number
 * only for donors who opted in (`volunteersMayCall`), through
 * `revealOptInDonor` with a typed reason (VAL-18). Every other payload
 * in this file is number-free by construction, and the tests scan them.
 */

type AnyCtx = GenericMutationCtx<DataModel> | GenericQueryCtx<DataModel>;
type VolunteerProfile = Doc<"volunteerProfiles">;
type Request = Doc<"requests">;

/** Display bound for donor-search results (a page size, not a rule). */
const SEARCH_RESULT_LIMIT = 50;
/** PRD §5.8: "Ask this donor" — at most 10 volunteer asks per request. */
const ASKS_PER_REQUEST = 10;

export async function volunteerProfileOf(
  ctx: AnyCtx,
  profileId: Id<"profiles">,
): Promise<VolunteerProfile | null> {
  return await ctx.db
    .query("volunteerProfiles")
    .withIndex("by_profile", (q) => q.eq("profileId", profileId))
    .unique();
}

/**
 * The volunteer gate (G7): admins/super-admins act with their role; a
 * `volunteer`-role caller must hold an APPROVED volunteer profile —
 * a pending/rejected/revoked application opens nothing.
 */
export async function requireVolunteer(
  ctx: AnyCtx,
  profile: Profile,
): Promise<VolunteerProfile | null> {
  const vp = await volunteerProfileOf(ctx, profile._id);
  if (profile.role === "admin" || profile.role === "superadmin") return vp;
  if (!vp || vp.status !== "approved") fail("ERR_FORBIDDEN");
  return vp!;
}

/** Claiming is recorded against a volunteer profile, so it needs one. */
async function requireClaimingVolunteer(
  ctx: AnyCtx,
  profile: Profile,
): Promise<VolunteerProfile> {
  const vp = await requireVolunteer(ctx, profile);
  if (!vp || vp.status !== "approved") fail("ERR_FORBIDDEN");
  return vp!;
}

async function requestFor(ctx: AnyCtx, profile: Profile, requestId: Id<"requests">) {
  const request = await ctx.db.get(requestId);
  if (!request || request!.isDemo !== profile.isDemo) fail("ERR_NOT_FOUND");
  return request!;
}

async function hospitalName(ctx: AnyCtx, request: Request): Promise<string> {
  if (request.hospitalId) {
    const hospital = await ctx.db.get(request.hospitalId);
    if (hospital) return hospital.nameEn;
  }
  return request.placeText ?? "";
}

/** Districts a volunteer covers: explicit districts + their thanas' districts. */
export async function coveredDistrictIds(
  ctx: AnyCtx,
  vp: VolunteerProfile,
): Promise<Set<string>> {
  const districts = new Set<string>(vp.districtIds.map(String));
  for (const upazilaId of vp.upazilaIds) {
    const upazila = await ctx.db.get(upazilaId);
    if (upazila?.parentId) districts.add(String(upazila.parentId));
  }
  return districts;
}

async function notifyAdmins(
  ctx: GenericMutationCtx<DataModel>,
  isDemo: boolean,
  template: string,
  params: Record<string, string | number>,
  url: string,
): Promise<void> {
  for (const roleName of ["admin", "superadmin"] as const) {
    const rows = await ctx.db
      .query("profiles")
      .withIndex("by_role", (q) => q.eq("role", roleName))
      .collect();
    for (const admin of rows) {
      if (admin.status !== "active" || admin.isDemo !== isDemo) continue;
      await notifyUser(ctx, {
        recipient: admin,
        template,
        params,
        url,
        channelId: "updates",
      });
    }
  }
}

/**
 * volunteers.apply (specs §6.4, F-701, SCR-V01): a member with a verified
 * phone applies; the number-display consent (VAL-15) is recorded as a
 * `volunteer_number_display` consent row at the current consent version.
 */
export const apply = memberMutationV({
  args: {
    upazilaIds: v.array(v.id("places")),
    districtIds: v.array(v.id("places")),
    institution: v.optional(v.string()),
    motivation: v.string(),
    consentVersion: v.string(),
  },
  handler: async (ctx, args) => {
    if (!ctx.profile.phoneVerified) fail("ERR_PHONE_NOT_VERIFIED");
    const check = validateVolunteerApplication({
      areaCount: args.upazilaIds.length + args.districtIds.length,
      motivation: args.motivation,
    });
    if (!check.ok) fail("ERR_VALIDATION", {}, check.field);
    for (const id of [...args.upazilaIds, ...args.districtIds]) {
      const place = await ctx.db.get(id);
      if (!place || (place.level !== "upazila" && place.level !== "district")) {
        fail("ERR_VALIDATION", {}, "areas");
      }
    }
    const existing = await volunteerProfileOf(ctx, ctx.profile._id);
    if (existing && existing.status === "pending") {
      fail("ERR_VALIDATION", {}, "application");
    }
    if (existing && existing.status === "approved") {
      fail("ERR_VALIDATION", {}, "application");
    }
    const fields = {
      upazilaIds: args.upazilaIds,
      districtIds: args.districtIds,
      institution: args.institution,
      motivation: args.motivation.trim(),
      numberDisplayConsentAt: Date.now(),
      reviewedBy: undefined,
      reviewedAt: undefined,
      reviewReason: undefined,
    };
    if (existing) {
      // Re-application after a rejection/revocation reopens the same row.
      await ctx.db.patch(existing._id, { ...fields, status: "pending", onDuty: false });
    } else {
      await ctx.db.insert("volunteerProfiles", {
        profileId: ctx.profile._id,
        status: "pending",
        onDuty: false,
        activeClaims: 0,
        isDemo: ctx.profile.isDemo,
        ...fields,
      });
    }
    await ctx.db.insert("consents", {
      profileId: ctx.profile._id,
      kind: "volunteer_number_display",
      version: args.consentVersion,
      lang: ctx.profile.language,
      acceptedAt: Date.now(),
    });
    await notifyAdmins(ctx, ctx.profile.isDemo, "NTF-17", { kind: "volunteer_application" }, "/admin/people");
    await recordEvent(ctx, "volunteer_applied", {
      actorRole: ctx.profile.role,
      isDemo: ctx.profile.isDemo,
    });
    return null;
  },
});

/** volunteers.getMine (specs §6.4) — the caller's own volunteer profile. */
export const getMine = memberQueryV({
  args: {},
  handler: async (ctx) => {
    return await volunteerProfileOf(ctx, ctx.profile._id);
  },
});

/** volunteers.setOnDuty (specs §6.4, F-702) — SCR-V02 duty toggle. */
export const setOnDuty = volunteerMutationV({
  args: { onDuty: v.boolean() },
  handler: async (ctx, args) => {
    const vp = await requireVolunteer(ctx, ctx.profile);
    if (!vp) fail("ERR_FORBIDDEN");
    await ctx.db.patch(vp._id, {
      onDuty: args.onDuty,
      onDutySince: args.onDuty ? Date.now() : undefined,
    });
    await recordEvent(ctx, "volunteer_duty_changed", {
      actorRole: ctx.profile.role,
      props: { onDuty: args.onDuty },
      isDemo: ctx.profile.isDemo,
    });
    return null;
  },
});

/** volunteers.setAreas (specs §6.4, F-702) — duty areas (VAL-16). */
export const setAreas = volunteerMutationV({
  args: {
    upazilaIds: v.array(v.id("places")),
    districtIds: v.array(v.id("places")),
  },
  handler: async (ctx, args) => {
    const vp = await requireVolunteer(ctx, ctx.profile);
    if (!vp) fail("ERR_FORBIDDEN");
    if (args.upazilaIds.length + args.districtIds.length < 1) {
      fail("ERR_VALIDATION", {}, "areas");
    }
    for (const id of [...args.upazilaIds, ...args.districtIds]) {
      const place = await ctx.db.get(id);
      if (!place || (place.level !== "upazila" && place.level !== "district")) {
        fail("ERR_VALIDATION", {}, "areas");
      }
    }
    await ctx.db.patch(vp._id, {
      upazilaIds: args.upazilaIds,
      districtIds: args.districtIds,
    });
    return null;
  },
});

/**
 * volunteers.board (specs §6.4, F-703, SCR-V02): open requests in the
 * districts the volunteer covers, worst-first: urgency "now" first,
 * then the longest wait without a confirmed donor. Number-free.
 */
export const board = volunteerQueryV({
  args: {
    bloodGroup: v.optional(v.string()),
    component: v.optional(v.union(v.literal("whole_blood"), v.literal("platelets"))),
    claimStatus: v.optional(
      v.union(v.literal("unclaimed"), v.literal("mine"), v.literal("all")),
    ),
    hospitalText: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const vp = await requireVolunteer(ctx, ctx.profile);
    let districts: Set<string>;
    if (vp) {
      districts = await coveredDistrictIds(ctx, vp);
    } else {
      // Admins without a roster row (PRD §3.2 gives them the board too)
      // see every district on their side of the practice wall.
      const places = await ctx.db.query("places").collect();
      districts = new Set(
        places.filter((p) => p.level === "district").map((p) => String(p._id)),
      );
    }
    const waveCount = (await getRulesSettings(ctx)).waveCount;
    const now = Date.now();
    const rows: Doc<"requests">[] = [];
    for (const districtId of districts) {
      for (const status of ["live", "covered"] as const) {
        const found = await ctx.db
          .query("requests")
          .withIndex(
            "by_status_district",
            eqRange([
              ["isDemo", ctx.profile.isDemo],
              ["status", status],
              ["districtId", districtId],
            ]),
          )
          .collect();
        rows.push(...found);
      }
    }
    const claimStatus = args.claimStatus ?? "all";
    const filtered = rows.filter((r) => {
      if (r.hiddenByModerator) return false;
      if (args.bloodGroup && r.bloodGroup !== args.bloodGroup) return false;
      if (args.component && r.component !== args.component) return false;
      if (claimStatus === "unclaimed" && r.claimedByVolunteerId) return false;
      if (claimStatus === "mine" && (!vp || r.claimedByVolunteerId !== vp._id)) return false;
      return true;
    });
    filtered.sort((a, b) => {
      const urgencyRank = (r: Request) => (r.urgency === "now" ? 0 : r.urgency === "today" ? 1 : 2);
      const byUrgency = urgencyRank(a) - urgencyRank(b);
      if (byUrgency !== 0) return byUrgency;
      // Minutes without a confirmed donor, longest first: requests with
      // no confirmed donor outrank covered ones, oldest first within.
      const aWait = a.unitsConfirmed > 0 ? -1 : now - a._creationTime;
      const bWait = b.unitsConfirmed > 0 ? -1 : now - b._creationTime;
      return bWait - aWait;
    });
    const items = [];
    for (const request of filtered.slice(0, 100)) {
      const hospital = request.hospitalId ? await ctx.db.get(request.hospitalId) : null;
      const area = await ctx.db.get(request.upazilaId);
      if (
        args.hospitalText &&
        !(hospital?.nameEn ?? request.placeText ?? "")
          .toLowerCase()
          .includes(args.hospitalText.toLowerCase())
      ) {
        continue;
      }
      let claimedByFirstName: string | null = null;
      if (request.claimedByVolunteerId) {
        const claimer = await ctx.db.get(request.claimedByVolunteerId);
        const claimerProfile = claimer ? await ctx.db.get(claimer.profileId) : null;
        claimedByFirstName = claimerProfile?.firstName ?? null;
      }
      items.push({
        requestId: request._id,
        bloodGroup: request.bloodGroup,
        component: request.component,
        unitsNeeded: request.unitsNeeded,
        unitsConfirmed: request.unitsConfirmed,
        hospitalName: hospital?.nameEn ?? request.placeText ?? "",
        areaName: area?.nameEn ?? "",
        waitingMin: Math.max(0, Math.round((now - request._creationTime) / 60_000)),
        wave: request.wave,
        waveCount,
        claimedByFirstName,
        notSure: request.bloodGroup === "not_sure",
        contactPhoneVerified: request.contactPhoneVerified,
        slipPending: request.slipStatus === "pending",
        status: request.status,
        neededBy: request.neededBy,
      });
    }
    return items;
  },
});

/**
 * volunteers.getRequest (specs §6.4, SCR-V03): the volunteer case view —
 * request basics, patient details (PRD §3.3), confirmed donors' FIRST
 * NAMES only, who has been asked, and the requester's phone ONLY when
 * this volunteer already holds an unexpired `volunteer_case` reveal
 * (from `openCase`) for the request. Never a donor's number.
 */
export const getRequest = volunteerQueryV({
  args: { requestId: v.id("requests") },
  handler: async (ctx, args) => {
    await requireVolunteer(ctx, ctx.profile);
    const request = await requestFor(ctx, ctx.profile, args.requestId);
    const requester = await ctx.db.get(request.requesterId);
    if (!requester) fail("ERR_NOT_FOUND");
    const hospital = request.hospitalId ? await ctx.db.get(request.hospitalId) : null;
    const area = await ctx.db.get(request.upazilaId);
    const responses = await allResponses(ctx, request._id);
    const confirmedDonors = [];
    for (const response of responses) {
      if (response.state !== "confirmed") continue;
      const donorProfile = await ctx.db.get(response.donorId);
      if (donorProfile) confirmedDonors.push({ firstName: donorProfile.firstName });
    }
    const reveals = await ctx.db
      .query("contactReveals")
      .withIndex(
        "by_viewer_request",
        eqRange([["viewerId", ctx.profile._id], ["requestId", request._id]]),
      )
      .collect();
    const caseReveal = reveals.find(
      (r) => r.reason === "volunteer_case" && r.expiresAt > Date.now(),
    );
    let claimedByFirstName: string | null = null;
    let claimedByMe = false;
    if (request.claimedByVolunteerId) {
      const claimer = await ctx.db.get(request.claimedByVolunteerId);
      const claimerProfile = claimer ? await ctx.db.get(claimer.profileId) : null;
      claimedByFirstName = claimerProfile?.firstName ?? null;
      claimedByMe = claimer?.profileId === ctx.profile._id;
    }
    return {
      request: {
        requestId: request._id,
        bloodGroup: request.bloodGroup,
        component: request.component,
        isDengue: request.isDengue,
        unitsNeeded: request.unitsNeeded,
        unitsConfirmed: request.unitsConfirmed,
        hospitalName: hospital?.nameEn ?? request.placeText ?? "",
        areaName: area?.nameEn ?? "",
        neededBy: request.neededBy,
        urgency: request.urgency,
        status: request.status,
        wave: request.wave,
        patientName: request.patientName,
        ward: request.ward,
        note: request.note,
        contactPhoneVerified: request.contactPhoneVerified,
        verifiedBadge: request.verifiedBadge,
        slipStatus: request.slipStatus,
        revealsFrozen: request.revealsFrozen,
        claimedByFirstName,
        claimedByMe,
      },
      requester: {
        firstName: requester!.firstName,
        // The ONLY volunteer path to this number is openCase (below).
        phone: caseReveal ? phoneOf(requester!) : undefined,
        memberSince: requester!._creationTime,
      },
      confirmedDonors,
      askedDonorProfileIds: responses.map((r) => r.donorProfileId),
      progress: {
        notified: responses.filter((r) =>
          ["notified", "opened", "accepted", "confirmed", "standby"].includes(r.state),
        ).length,
        confirmed: responses.filter((r) => r.state === "confirmed").length,
      },
    };
  },
});

/**
 * volunteers.openCase 📞 (specs §6.4, F-705): the volunteer takes
 * responsibility for a request and receives the REQUESTER's number —
 * exactly one logged reveal per (volunteer, request); repeat calls
 * return the number from the existing reveal without logging again.
 */
export const openCase = volunteerMutationV({
  args: { requestId: v.id("requests") },
  handler: async (ctx, args) => {
    await requireVolunteer(ctx, ctx.profile);
    const request = await requestFor(ctx, ctx.profile, args.requestId);
    if (request.status === "closed") fail("ERR_REQUEST_CLOSED");
    if (request.revealsFrozen) fail("ERR_REVEALS_FROZEN");
    const requester = await ctx.db.get(request.requesterId);
    if (!requester) fail("ERR_NOT_FOUND");
    const existing = await ctx.db
      .query("contactReveals")
      .withIndex(
        "by_viewer_request",
        eqRange([["viewerId", ctx.profile._id], ["requestId", request._id]]),
      )
      .collect();
    if (existing.some((r) => r.reason === "volunteer_case")) {
      return { requesterPhone: phoneOf(requester!) };
    }
    const visibleDays = await getSetting<number>(ctx, "contactVisibleAfterCloseDays");
    const phone = await recordContactReveal(ctx, {
      viewer: ctx.profile,
      subject: requester!,
      subjectRole: "requester",
      requestId: request._id,
      reason: "volunteer_case",
      auditAction: "volunteer_case_opened",
      expiresAt: Date.now() + visibleDays * 86_400_000,
      isDemo: request.isDemo,
    });
    return { requesterPhone: phone };
  },
});

/** volunteers.claim (specs §6.4, F-703) — "I'm on it". */
export const claim = volunteerMutationV({
  args: { requestId: v.id("requests") },
  handler: async (ctx, args) => {
    const vp = await requireClaimingVolunteer(ctx, ctx.profile);
    const request = await requestFor(ctx, ctx.profile, args.requestId);
    if (request.status === "closed") fail("ERR_REQUEST_CLOSED");
    if (request.claimedByVolunteerId && request.claimedByVolunteerId !== vp._id) {
      fail("ERR_VALIDATION", {}, "requestId");
    }
    if (request.claimedByVolunteerId === vp._id) return null; // idempotent
    await ctx.db.patch(request._id, { claimedByVolunteerId: vp._id });
    await ctx.db.patch(vp._id, { activeClaims: vp.activeClaims + 1 });
    await recordEvent(ctx, "volunteer_claimed", {
      requestId: request._id,
      actorRole: ctx.profile.role,
      props: { claimed: true },
      isDemo: request.isDemo,
    });
    return null;
  },
});

/** volunteers.unclaim (specs §6.4, F-703) — release the request. */
export const unclaim = volunteerMutationV({
  args: { requestId: v.id("requests") },
  handler: async (ctx, args) => {
    const vp = await requireClaimingVolunteer(ctx, ctx.profile);
    const request = await requestFor(ctx, ctx.profile, args.requestId);
    if (request.claimedByVolunteerId !== vp._id) {
      fail("ERR_VALIDATION", {}, "requestId");
    }
    await ctx.db.patch(request._id, { claimedByVolunteerId: undefined });
    await ctx.db.patch(vp._id, { activeClaims: Math.max(0, vp.activeClaims - 1) });
    await recordEvent(ctx, "volunteer_claimed", {
      requestId: request._id,
      actorRole: ctx.profile.role,
      props: { claimed: false },
      isDemo: request.isDemo,
    });
    return null;
  },
});

/**
 * volunteers.searchDonors (specs §6.4, F-705, SCR-V03): search the donor
 * pool FROM INSIDE an open request. Results carry first name, group,
 * area, last-active and eligibility — NEVER a phone number (PRD §3.3).
 * Rate-limited (PRD §5.8: 30/hour) and audit-logged (§6.9).
 */
export const searchDonors = volunteerMutationV({
  args: {
    requestId: v.id("requests"),
    group: v.optional(v.string()),
    upazilaId: v.optional(v.id("places")),
    districtId: v.optional(v.id("places")),
    availableNow: v.optional(v.boolean()),
    eligibleNow: v.optional(v.boolean()),
    platelets: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    await requireVolunteer(ctx, ctx.profile);
    const request = await requestFor(ctx, ctx.profile, args.requestId);
    if (request.status === "closed") fail("ERR_REQUEST_CLOSED");
    await limitOrThrow(ctx, "volunteerSearch", String(ctx.profile._id));

    const settings = await getRulesSettings(ctx);
    // Default group set = the request's exact + compatible groups
    // (PRD §5.2); a `group` filter narrows to that single group.
    const { exact, compatible } = groupsFor(
      request.bloodGroup,
      request.component,
      true,
      settings,
    );
    const groups = args.group ? [args.group] : [...exact, ...compatible];
    const districtId = args.districtId ?? request.districtId;
    const component = args.platelets ? "platelets" : request.component;
    const now = Date.now();
    const responses = await allResponses(ctx, request._id);
    const alreadyNotified = new Set(responses.map((r) => String(r.donorProfileId)));

    type Row = {
      donorProfileId: Id<"donorProfiles">;
      firstName: string;
      group: string;
      areaName: string;
      lastActive: number;
      eligible: boolean;
      alreadyNotified: boolean;
      canBeCalled: boolean;
      exactGroup: boolean;
      distanceKm: number;
    };
    const rows: Row[] = [];
    for (const group of groups) {
      const donors = await ctx.db
        .query("donorProfiles")
        .withIndex(
          "by_match",
          eqRange([
            ["isDemo", request.isDemo],
            ["live", true],
            ["bloodGroup", group],
            ["districtId", districtId],
          ]),
        )
        .collect();
      for (const donor of donors) {
        if (donor.hidden) continue;
        if (args.upazilaId && donor.upazilaId !== args.upazilaId) continue;
        const profile = await ctx.db.get(donor.profileId);
        if (!profile || profile.status !== "active" || !profile.phoneVerified) continue;
        if (profile._id === request.requesterId) continue;
        const check = canDonate(
          {
            gender: donor.gender,
            neverDonated: donor.neverDonated,
            lastDonationDate: donor.lastDonationDate,
            lastDonationType: donor.lastDonationType,
            plateletOptIn: donor.plateletOptIn,
          },
          component,
          now,
          settings,
          profile.dateOfBirth,
        );
        const available =
          donor.availability === "available" ||
          (donor.availability === "paused" &&
            donor.pausedUntil !== undefined &&
            donor.pausedUntil <= now);
        const eligible = check.ok && available;
        if (args.availableNow && !available) continue;
        if (args.eligibleNow && !eligible) continue;
        const place = await ctx.db.get(donor.upazilaId);
        rows.push({
          donorProfileId: donor._id,
          firstName: profile.firstName,
          group: donor.bloodGroup,
          areaName: place?.nameEn ?? "",
          lastActive: profile.lastActiveAt,
          eligible,
          alreadyNotified: alreadyNotified.has(String(donor._id)),
          canBeCalled: donor.volunteersMayCall,
          exactGroup: exact.includes(donor.bloodGroup as never),
          distanceKm: place
            ? Math.round(haversineKm(place, { lat: request.approxLat, lng: request.approxLng }) * 10) / 10
            : Number.POSITIVE_INFINITY,
        });
      }
    }
    rows.sort(
      (a, b) =>
        Number(b.exactGroup) - Number(a.exactGroup) ||
        a.distanceKm - b.distanceKm ||
        b.lastActive - a.lastActive,
    );
    await writeAudit(ctx, {
      actor: ctx.profile,
      action: "volunteer_donor_search",
      targetType: "requests",
      targetId: request._id,
      meta: { results: rows.length },
    });
    await recordEvent(ctx, "volunteer_donor_search", {
      requestId: request._id,
      actorRole: ctx.profile.role,
      props: { results: rows.length },
      isDemo: request.isDemo,
    });
    return rows.slice(0, SEARCH_RESULT_LIMIT).map(({ exactGroup, distanceKm, ...rest }) => ({
      ...rest,
      distanceKm: Number.isFinite(distanceKm) ? distanceKm : 0,
    }));
  },
});

/**
 * volunteers.askDonor (specs §6.4, F-705): send ONE chosen donor a direct
 * alert for this request (a wave-0 response). If they accept, the normal
 * confirm/reveal flow applies. At most 10 asks per request (PRD §5.8);
 * the donor must be eligible for the request right now.
 */
export const askDonor = volunteerMutationV({
  args: { requestId: v.id("requests"), donorProfileId: v.id("donorProfiles") },
  handler: async (ctx, args) => {
    await requireVolunteer(ctx, ctx.profile);
    const request = await requestFor(ctx, ctx.profile, args.requestId);
    if (request.status === "closed") fail("ERR_REQUEST_CLOSED");
    const donor = await ctx.db.get(args.donorProfileId);
    if (!donor || donor!.isDemo !== request.isDemo) fail("ERR_NOT_FOUND");
    const donorProfile = await ctx.db.get(donor!.profileId);
    if (!donorProfile) fail("ERR_NOT_FOUND");

    const responses = await allResponses(ctx, request._id);
    const asks = responses.filter((r) => r.wave === 0).length;
    if (asks >= ASKS_PER_REQUEST) {
      fail("ERR_RATE_LIMITED", { minutes: 60 });
    }
    const existing = responses.find((r) => r.donorProfileId === donor!._id);
    if (existing && !["declined", "withdrew", "not_responding"].includes(existing.state)) {
      fail("ERR_ALREADY_RESPONDED");
    }

    const settings = await getRulesSettings(ctx);
    const { exact, compatible } = groupsFor(
      request.bloodGroup,
      request.component,
      true,
      settings,
    );
    const groupOk =
      exact.includes(donor!.bloodGroup as never) ||
      compatible.includes(donor!.bloodGroup as never);
    const eligibility = canDonate(
      {
        gender: donor!.gender,
        neverDonated: donor!.neverDonated,
        lastDonationDate: donor!.lastDonationDate,
        lastDonationType: donor!.lastDonationType,
        plateletOptIn: donor!.plateletOptIn,
      },
      request.component,
      Date.now(),
      settings,
      donorProfile!.dateOfBirth,
    );
    const blockedA = await ctx.db
      .query("blocks")
      .withIndex(
        "by_pair",
        eqRange([["blockerId", request.requesterId], ["blockedId", donorProfile!._id]]),
      )
      .first();
    const blockedB = await ctx.db
      .query("blocks")
      .withIndex(
        "by_pair",
        eqRange([["blockerId", donorProfile!._id], ["blockedId", request.requesterId]]),
      )
      .first();
    if (!donor!.live || !groupOk || !eligibility.ok || blockedA || blockedB) {
      fail("ERR_NOT_ELIGIBLE", { reason: "ask" });
    }

    const place = await ctx.db.get(donor!.upazilaId);
    const distanceKm = place
      ? Math.round(haversineKm(place, { lat: request.approxLat, lng: request.approxLng }) * 10) / 10
      : 0;
    await ctx.db.insert("responses", {
      requestId: request._id,
      donorProfileId: donor!._id,
      donorId: donorProfile!._id,
      wave: 0,
      viaVolunteerId: ctx.profile._id,
      state: "notified",
      notifiedAt: Date.now(),
      callMode: donor!.callMode,
      isDemo: request.isDemo,
    });
    await notifyUser(ctx, {
      recipient: donorProfile!,
      template: "NTF-02",
      requestId: request._id,
      params: {
        group: request.bloodGroup === "any" ? donor!.bloodGroup : request.bloodGroup,
        component: COMPONENT_LABEL[donorProfile!.language][request.component],
        hospital: await hospitalName(ctx, request),
        units: request.unitsNeeded,
        time: formatTimeDhaka(request.neededBy),
        km: distanceKm,
        urgent: request.urgency === "now" ? "1" : "",
      },
      url: `/alerts/${request._id}`,
      channelId: "urgent-requests",
    });
    await recordEvent(ctx, "volunteer_asked_donor", {
      requestId: request._id,
      actorRole: ctx.profile.role,
      isDemo: request.isDemo,
    });
    return null;
  },
});

/**
 * volunteers.revealOptInDonor 📞 (specs §6.4, F-705, V10): the ONLY
 * volunteer path to a donor's number — the donor opted in
 * (`volunteersMayCall`), a typed reason is required (VAL-18), and the
 * reveal is logged with the S-24 volume check inside visibility.
 */
export const revealOptInDonor = volunteerMutationV({
  args: {
    requestId: v.id("requests"),
    donorProfileId: v.id("donorProfiles"),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    await requireVolunteer(ctx, ctx.profile);
    const check = validateReason(args.reason);
    if (!check.ok) fail("ERR_VALIDATION", {}, check.field);
    const request = await requestFor(ctx, ctx.profile, args.requestId);
    if (request.status === "closed") fail("ERR_REQUEST_CLOSED");
    if (request.revealsFrozen) fail("ERR_REVEALS_FROZEN");
    const donor = await ctx.db.get(args.donorProfileId);
    if (!donor || donor!.isDemo !== request.isDemo) fail("ERR_NOT_FOUND");
    if (!donor!.volunteersMayCall) fail("ERR_FORBIDDEN");
    const donorProfile = await ctx.db.get(donor!.profileId);
    if (!donorProfile) fail("ERR_NOT_FOUND");
    const visibleDays = await getSetting<number>(ctx, "contactVisibleAfterCloseDays");
    const phone = await recordContactReveal(ctx, {
      viewer: ctx.profile,
      subject: donorProfile!,
      subjectRole: "donor",
      requestId: request._id,
      reason: "volunteer_optin_call",
      reasonText: args.reason.trim(),
      auditAction: "volunteer_optin_revealed",
      expiresAt: Date.now() + visibleDays * 86_400_000,
      isDemo: request.isDemo,
    });
    await recordEvent(ctx, "volunteer_revealed_optin_donor", {
      requestId: request._id,
      actorRole: ctx.profile.role,
      isDemo: request.isDemo,
    });
    return { phone };
  },
});
