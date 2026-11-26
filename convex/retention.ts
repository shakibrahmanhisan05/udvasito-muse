import { internalMutationGeneric, type GenericMutationCtx } from "convex/server";
import type { DataModel, Doc } from "./schemaTypes";
import { getSetting } from "./_lib/settings";
import { writeAudit } from "./_lib/audit";
import { eqRange } from "./_lib/db";

/**
 * Retention (specs §6.6, roadmap P3 F-603): the daily job that executes
 * PRD §5.9 — account deletions anonymised exactly as listed there,
 * request personal fields purged 30 days after close (S-35), slip
 * photos deleted at most 7 days after close (S-26), AI call logs kept
 * 30 days (S-36), events older than 90 days rolled up then deleted,
 * and the 12-month records (contact reveals, consents, audit log)
 * dropped once that period passes.
 */

const DAY = 86_400_000;
/** Events roll up after 90 days (specs §6.6). */
const EVENT_ROLLUP_DAYS = 90;
/** Reveal / consent / audit retention: 12 months (PRD §5.9). */
const LOG_RETENTION_DAYS = 365;

type MCtx = GenericMutationCtx<DataModel>;

/** The Asia/Dhaka calendar day (YYYY-MM-DD) an instant falls in. */
function dhakaDay(time: number): string {
  return new Date(time + 6 * 3_600_000).toISOString().slice(0, 10);
}

/**
 * Anonymise one account exactly per PRD §5.9: personal profile fields
 * scrubbed, donor/volunteer profiles and verification/device rows
 * deleted, the person's requests kept but scrubbed of personal fields;
 * consents, audit entries and reveal records stay for their 12-month
 * retention. Idempotent — a second run finds nothing left to scrub.
 */
async function anonymiseProfile(
  ctx: MCtx,
  profile: Doc<"profiles">,
  now: number,
): Promise<boolean> {
  if (profile.phone === "") return false; // already anonymised
  await ctx.db.patch(profile._id, {
    name: "Deleted user",
    firstName: "Deleted",
    dateOfBirth: "",
    phone: "",
    phoneVerified: false,
    phoneVerifiedAt: undefined,
    phoneVerifiedVia: undefined,
    phoneVerifiedBy: undefined,
    statusReason: "account_deleted",
    campaignCode: undefined,
    practiceId: undefined,
  });
  const donor = await ctx.db
    .query("donorProfiles")
    .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
    .unique();
  if (donor) await ctx.db.delete(donor._id);
  const volunteer = await ctx.db
    .query("volunteerProfiles")
    .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
    .unique();
  if (volunteer) await ctx.db.delete(volunteer._id);
  const verifications = await ctx.db
    .query("phoneVerifications")
    .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
    .collect();
  for (const row of verifications) await ctx.db.delete(row._id);
  const subscriptions = await ctx.db
    .query("webPushSubscriptions")
    .withIndex("by_profile", (q) => q.eq("profileId", profile._id))
    .collect();
  for (const row of subscriptions) await ctx.db.delete(row._id);
  const notifications = await ctx.db
    .query("notifications")
    .withIndex("by_recipient", (q) => q.eq("recipientId", profile._id))
    .collect();
  for (const row of notifications) await ctx.db.delete(row._id);
  const blocks = await ctx.db.query("blocks").collect();
  for (const block of blocks) {
    if (block.blockerId === profile._id || block.blockedId === profile._id) {
      await ctx.db.delete(block._id);
    }
  }
  const ownExports = await ctx.db
    .query("exports")
    .withIndex("by_requestedBy", (q) => q.eq("requestedBy", profile._id))
    .collect();
  for (const row of ownExports) {
    await ctx.storage.delete(row.fileId);
    await ctx.db.delete(row._id);
  }
  // The person's requests stay (anonymised history) but lose every
  // personal field — the same scrub as the S-35 purge below.
  const ownRequests = await ctx.db
    .query("requests")
    .withIndex("by_requester_status", eqRange([["requesterId", profile._id]]))
    .collect();
  for (const request of ownRequests) {
    if (request.personalDataPurgedAt === undefined) {
      await ctx.db.patch(request._id, {
        patientName: undefined,
        ward: undefined,
        note: undefined,
        contactPhone: "",
        personalDataPurgedAt: now,
      });
    }
  }
  await writeAudit(ctx, {
    actor: null,
    actorRole: "system",
    action: "deletion_completed",
    targetType: "profiles",
    targetId: profile._id,
  });
  return true;
}

/**
 * internal.retention.daily — runs 03:00 Asia/Dhaka (crons.ts).
 * Returns counts for the run log.
 */
export const daily = internalMutationGeneric({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const deletionDays = await getSetting<number>(ctx, "deletionDays");
    const purgeDays = await getSetting<number>(ctx, "purgePersonalFieldsDays");
    const slipDays = await getSetting<number>(ctx, "slipDeleteMaxDaysAfterClose");
    const aiLogDays = await getSetting<number>(ctx, "aiLogRetentionDays");

    // 1. Account deletions that are due (S-27).
    let deletions = 0;
    const pending = await ctx.db
      .query("profiles")
      .withIndex("by_status", (q) => q.eq("status", "deletion_pending"))
      .collect();
    for (const profile of pending) {
      if (
        profile.deletionRequestedAt !== undefined &&
        profile.deletionRequestedAt + deletionDays * DAY <= now
      ) {
        if (await anonymiseProfile(ctx, profile, now)) deletions += 1;
      }
    }

    // 2. Closed-request personal-field purge (S-35) + slip deletion (S-26).
    // (closedAt is only ever set on closed requests.)
    let purged = 0;
    let slipsDeleted = 0;
    const closedRequests = await ctx.db
      .query("requests")
      .withIndex("by_closedAt", (q) => q.lte("closedAt", now))
      .collect();
    for (const request of closedRequests) {
      if (request.closedAt === undefined) continue;
      if (
        request.personalDataPurgedAt === undefined &&
        request.closedAt + purgeDays * DAY <= now
      ) {
        await ctx.db.patch(request._id, {
          patientName: undefined,
          ward: undefined,
          note: undefined,
          contactPhone: "",
          personalDataPurgedAt: now,
        });
        purged += 1;
      }
      if (
        request.slipFileId !== undefined &&
        request.closedAt + slipDays * DAY <= now
      ) {
        await ctx.storage.delete(request.slipFileId);
        await ctx.db.patch(request._id, { slipFileId: undefined });
        slipsDeleted += 1;
      }
    }

    // 3. AI call log retention (S-36).
    let aiCallsDeleted = 0;
    const aiCalls = await ctx.db.query("aiCalls").collect();
    for (const call of aiCalls) {
      if (call._creationTime + aiLogDays * DAY <= now) {
        await ctx.db.delete(call._id);
        aiCallsDeleted += 1;
      }
    }

    // 4. Events older than 90 days → daily rollup, then delete (§6.6).
    let eventsRolledUp = 0;
    const events = await ctx.db.query("events").collect();
    const rollupCounts = new Map<string, { day: string; name: string; count: number }>();
    for (const event of events) {
      if (event._creationTime + EVENT_ROLLUP_DAYS * DAY > now) continue;
      const day = dhakaDay(event._creationTime);
      const key = `${day}|${event.name}`;
      const entry = rollupCounts.get(key) ?? { day, name: event.name, count: 0 };
      entry.count += 1;
      rollupCounts.set(key, entry);
      await ctx.db.delete(event._id);
      eventsRolledUp += 1;
    }
    for (const entry of rollupCounts.values()) {
      const existing = await ctx.db
        .query("dailyRollups")
        .withIndex(
          "by_metric_day",
          eqRange([["metric", "events"], ["day", entry.day]]),
        )
        .collect();
      const row = existing.find(
        (r) => (r.dims as { name?: string }).name === entry.name,
      );
      if (row) {
        await ctx.db.patch(row._id, { value: row.value + entry.count });
      } else {
        await ctx.db.insert("dailyRollups", {
          day: entry.day,
          metric: "events",
          dims: { name: entry.name },
          value: entry.count,
        });
      }
    }

    // 5. Expired data exports: file + row.
    let exportsDeleted = 0;
    const exportRows = await ctx.db.query("exports").collect();
    for (const row of exportRows) {
      if (row.expiresAt <= now) {
        await ctx.storage.delete(row.fileId);
        await ctx.db.delete(row._id);
        exportsDeleted += 1;
      }
    }

    // 6. Twelve-month records (PRD §5.9): reveals, consents, audit log.
    let logsDeleted = 0;
    for (const table of ["contactReveals", "consents", "auditLog"] as const) {
      const rows = await ctx.db.query(table).collect();
      for (const row of rows) {
        if (row._creationTime + LOG_RETENTION_DAYS * DAY <= now) {
          await ctx.db.delete(row._id);
          logsDeleted += 1;
        }
      }
    }

    return {
      deletions,
      purged,
      slipsDeleted,
      aiCallsDeleted,
      eventsRolledUp,
      exportsDeleted,
      logsDeleted,
    };
  },
});
