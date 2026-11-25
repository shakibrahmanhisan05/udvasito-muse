import type { GenericMutationCtx } from "convex/server";
import type { DataModel, Id } from "../schemaTypes";

/**
 * Backend-only event recording (specs §1.8, PRD §2.2). `props` must NEVER
 * contain a phone number, a name or free text — enforced here by key check.
 */
export async function recordEvent(
  ctx: GenericMutationCtx<DataModel>,
  name: string,
  opts: {
    requestId?: Id<"requests">;
    actorRole?: string;
    props?: Record<string, unknown>;
    isDemo: boolean;
  },
): Promise<void> {
  if (opts.props) {
    for (const key of Object.keys(opts.props)) {
      if (/phone|name|note|address/i.test(key)) {
        throw new Error(`recordEvent: props key "${key}" is not allowed (specs §1.8)`);
      }
    }
  }
  await ctx.db.insert("events", {
    name,
    requestId: opts.requestId,
    actorRole: opts.actorRole,
    props: opts.props,
    isDemo: opts.isDemo,
  });
}
