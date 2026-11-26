import { v } from "convex/values";
import { memberMutationV } from "./_lib/auth";
import { fail } from "./_lib/errors";

/** notifications.markOpened (specs §6.4) — recipient only. */
export const markOpened = memberMutationV({
  args: { notificationId: v.id("notifications") },
  handler: async (ctx, args) => {
    const notification = await ctx.db.get(args.notificationId);
    if (!notification || notification!.recipientId !== ctx.profile._id) {
      fail("ERR_NOT_FOUND");
    }
    if (!notification!.openedAt) {
      await ctx.db.patch(args.notificationId, { openedAt: Date.now() });
    }
    return null;
  },
});
