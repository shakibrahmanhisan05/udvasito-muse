import { v } from "convex/values";
import { adminMutationV, adminQueryV } from "../_lib/auth";
import { fail } from "../_lib/errors";
import { featureOn } from "../_lib/settings";
import { writeAudit } from "../_lib/audit";

/**
 * FAQ management (F-907, SCR-A12, switch `faqUi`). The assistant
 * (F-604) answers ONLY from approved entries, so approval is the
 * gate that matters: VAL-24 — question ≤ 200 chars, answer ≤ 1,000,
 * and BOTH languages complete before an entry can be approved; the
 * approver and the date are recorded on the entry. Drafts may be
 * incomplete while being written. Un-approving returns an entry to
 * draft and clears the approval record.
 */

const QUESTION_MAX = 200;
const ANSWER_MAX = 1_000;

function checkLengths(fields: {
  questionEn: string;
  questionBn: string;
  answerEn: string;
  answerBn: string;
}) {
  if (fields.questionEn.length > QUESTION_MAX || fields.questionBn.length > QUESTION_MAX) {
    fail("ERR_VALIDATION", {}, "question");
  }
  if (fields.answerEn.length > ANSWER_MAX || fields.answerBn.length > ANSWER_MAX) {
    fail("ERR_VALIDATION", {}, "answer");
  }
}

export const list = adminQueryV({
  args: {},
  handler: async (ctx) => {
    if (!(await featureOn(ctx, "faqUi"))) return [];
    const rows = await ctx.db.query("faqEntries").collect();
    return rows
      .sort((a, b) => a.questionEn.localeCompare(b.questionEn))
      .map((row) => ({
        _id: row._id,
        questionEn: row.questionEn,
        questionBn: row.questionBn,
        answerEn: row.answerEn,
        answerBn: row.answerBn,
        tags: row.tags,
        status: row.status,
        approvedBy: row.approvedBy ?? null,
        approvedAt: row.approvedAt ?? null,
      }));
  },
});

export const save = adminMutationV({
  args: {
    faqId: v.optional(v.id("faqEntries")),
    questionEn: v.string(),
    questionBn: v.string(),
    answerEn: v.string(),
    answerBn: v.string(),
    tags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    if (!(await featureOn(ctx, "faqUi"))) fail("ERR_VALIDATION", {}, "feature");
    const fields = {
      questionEn: args.questionEn.trim(),
      questionBn: args.questionBn.trim(),
      answerEn: args.answerEn.trim(),
      answerBn: args.answerBn.trim(),
    };
    if (!fields.questionEn && !fields.questionBn) fail("ERR_VALIDATION", {}, "question");
    checkLengths(fields);
    const tags = args.tags.map((tag) => tag.trim()).filter(Boolean).slice(0, 8);

    if (args.faqId) {
      const existing = await ctx.db.get(args.faqId);
      if (!existing) fail("ERR_NOT_FOUND");
      // Editing an approved entry returns it to draft: the approval
      // covered the old wording, not the new one.
      await ctx.db.patch(args.faqId, {
        ...fields,
        tags,
        status: "draft",
        approvedBy: undefined,
        approvedAt: undefined,
      });
      await writeAudit(ctx, {
        actor: ctx.profile,
        action: "faq_saved",
        targetType: "faq",
        targetId: args.faqId,
      });
      return { faqId: args.faqId };
    }
    const faqId = await ctx.db.insert("faqEntries", {
      ...fields,
      tags,
      status: "draft",
    });
    await writeAudit(ctx, {
      actor: ctx.profile,
      action: "faq_saved",
      targetType: "faq",
      targetId: faqId,
    });
    return { faqId };
  },
});

export const setStatus = adminMutationV({
  args: {
    faqId: v.id("faqEntries"),
    status: v.union(v.literal("draft"), v.literal("approved")),
  },
  handler: async (ctx, args) => {
    if (!(await featureOn(ctx, "faqUi"))) fail("ERR_VALIDATION", {}, "feature");
    const entry = await ctx.db.get(args.faqId);
    if (!entry) fail("ERR_NOT_FOUND");
    if (args.status === "approved") {
      // VAL-24: both languages complete before approval.
      if (
        !entry.questionEn.trim() ||
        !entry.questionBn.trim() ||
        !entry.answerEn.trim() ||
        !entry.answerBn.trim()
      ) {
        fail("ERR_VALIDATION", {}, "bilingual");
      }
      checkLengths(entry);
      await ctx.db.patch(args.faqId, {
        status: "approved",
        approvedBy: ctx.profile._id,
        approvedAt: Date.now(),
      });
    } else {
      await ctx.db.patch(args.faqId, {
        status: "draft",
        approvedBy: undefined,
        approvedAt: undefined,
      });
    }
    await writeAudit(ctx, {
      actor: ctx.profile,
      action: "faq_status",
      targetType: "faq",
      targetId: args.faqId,
      meta: { status: args.status },
    });
    return null;
  },
});
