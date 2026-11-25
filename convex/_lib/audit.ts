import type { GenericMutationCtx } from "convex/server";
import type { DataModel, Doc, Id } from "../schemaTypes";

type Profile = Doc<"profiles">;

/** Audit actions are listed in docs/specs.md §6.9 — never log phone numbers. */
export async function writeAudit(
  ctx: GenericMutationCtx<DataModel>,
  args: {
    actor?: Profile | null;
    actorRole?: string;
    action: string;
    targetType: string;
    targetId: string;
    reason?: string;
    meta?: unknown;
  },
): Promise<void> {
  await ctx.db.insert("auditLog", {
    actorId: args.actor?._id,
    actorRole: args.actorRole ?? args.actor?.role ?? "system",
    action: args.action,
    targetType: args.targetType,
    targetId: args.targetId,
    reason: args.reason,
    meta: args.meta,
  });
}
