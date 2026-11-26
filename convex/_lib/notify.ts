import type { GenericMutationCtx } from "convex/server";
import { PushNotifications } from "@convex-dev/expo-push-notifications";
import { makeFunctionReference } from "convex/server";
import { components } from "../_generated/api";
import type { DataModel, Doc, Id } from "../schemaTypes";
import { recordEvent } from "./events";
import { featureOn } from "./settings";

/**
 * Notification delivery (specs §6.8). Templates below are copied verbatim
 * from specs §6.8 (the same source the client i18n files were extracted
 * from — Convex functions cannot import src/i18n). Lock-screen privacy:
 * no phone numbers, no patient names, no requester names in any push —
 * NTF-04's {{name}} is the donor's FIRST name, which specs §6.8 itself
 * specifies for the requester's in-app notification.
 *
 * Every send writes a `notifications` row and a `notification_sent` event
 * (PRD §2.2), then attempts Expo push through the component. A recipient
 * with no registered token simply gets the in-app row (inbox is driven by
 * `responses`, so nothing is lost).
 */

type Lang = "en" | "bn";

type Template = {
  title: string;
  body: string;
  bodyDonorCalls?: string;
  urgentPrefix?: string;
  /** Alternate wording for the same template id (NTF-15 rejection). */
  rejected?: { title: string; body: string };
};

const TEMPLATES: Record<string, Record<Lang, Template>> = {
  "NTF-01": {
    en: {
      title: "{{urgent}}{{group}} {{component}} needed · {{hospital}}",
      urgentPrefix: "URGENT · ",
      body: "{{units}} bag(s) by {{time}} · {{km}} km. Tap to answer.",
    },
    bn: {
      title: "{{urgent}}{{group}} {{component}} প্রয়োজন · {{hospital}}",
      urgentPrefix: "জরুরি · ",
      body: "{{units}} ব্যাগ, {{time}}-এর মধ্যে · {{km}} কিমি। উত্তর দিতে ট্যাপ করুন।",
    },
  },
  "NTF-02": {
    en: {
      title: "A volunteer asked you: {{group}} {{component}} · {{hospital}}",
      urgentPrefix: "URGENT · ",
      body: "{{units}} bag(s) by {{time}} · {{km}} km. Tap to answer.",
    },
    bn: {
      title: "একজন স্বেচ্ছাসেবক অনুরোধ করেছেন: {{group}} {{component}} · {{hospital}}",
      urgentPrefix: "জরুরি · ",
      body: "{{units}} ব্যাগ, {{time}}-এর মধ্যে · {{km}} কিমি। উত্তর দিতে ট্যাপ করুন।",
    },
  },
  "NTF-03": {
    en: {
      title: "New request in {{area}}: {{group}} {{component}}",
      body: "{{hospital}} · needed by {{time}}",
    },
    bn: {
      title: "{{area}}-এ নতুন অনুরোধ: {{group}} {{component}}",
      body: "{{hospital}} · {{time}}-এর মধ্যে",
    },
  },
  "NTF-14": {
    en: { title: "Message from UDVASITO", body: "{{action}}: {{reason}}" },
    bn: { title: "উদ্ভাসিতের বার্তা", body: "{{action}}: {{reason}}" },
  },
  "NTF-15": {
    en: {
      title: "Volunteer application approved",
      body: "Open UDVASITO to start.",
      rejected: { title: "Volunteer application update", body: "Open UDVASITO to start." },
    },
    bn: {
      title: "স্বেচ্ছাসেবক আবেদন অনুমোদিত",
      body: "শুরু করতে উদ্ভাসিত খুলুন।",
      rejected: { title: "স্বেচ্ছাসেবক আবেদনের হালনাগাদ", body: "শুরু করতে উদ্ভাসিত খুলুন।" },
    },
  },
  "NTF-04": {
    en: {
      title: "{{name}} can donate!",
      body: "Open UDVASITO to call them now.",
      bodyDonorCalls: "{{name}} will call you soon.",
    },
    bn: {
      title: "{{name}} রক্ত দিতে পারবেন!",
      body: "এখনই কল করতে উদ্ভাসিত খুলুন।",
      bodyDonorCalls: "{{name}} শিগগিরই আপনাকে কল করবেন।",
    },
  },
  "NTF-05": {
    en: {
      title: "Your number was shared with a family",
      body: "{{group}} at {{hospital}} — they may call you.",
    },
    bn: {
      title: "আপনার নম্বর একটি পরিবারকে দেওয়া হয়েছে",
      body: "{{hospital}}-এ {{group}} — তারা আপনাকে কল করতে পারেন।",
    },
  },
  "NTF-06": {
    en: { title: "A volunteer can help you now", body: "Open UDVASITO to call them." },
    bn: { title: "একজন স্বেচ্ছাসেবক এখন সাহায্য করতে পারেন", body: "কল করতে উদ্ভাসিত খুলুন।" },
  },
  "NTF-07": {
    en: {
      title: "No donor yet: {{group}} at {{hospital}}",
      body: "Waiting {{min}} min. Can you help?",
    },
    bn: {
      title: "এখনো রক্তদাতা নেই: {{hospital}}-এ {{group}}",
      body: "{{min}} মিনিট ধরে অপেক্ষায়। সাহায্য করতে পারবেন?",
    },
  },
  "NTF-08": {
    en: {
      title: "Still coming to {{hospital}}?",
      body: "Tap to answer — the family is waiting.",
    },
    bn: {
      title: "আপনি কি {{hospital}}-এ আসছেন?",
      body: "উত্তর দিতে ট্যাপ করুন — পরিবারটি অপেক্ষা করছে।",
    },
  },
  "NTF-10": {
    en: {
      title: "Did the donation happen?",
      body: "One tap helps us count real donations.",
    },
    bn: {
      title: "রক্তদান কি হয়েছে?",
      body: "এক ট্যাপে আমরা আসল রক্তদান গুনতে পারি।",
    },
  },
  "NTF-11": {
    en: { title: "You can donate again from today", body: "Thank you for staying ready." },
    bn: { title: "আজ থেকে আবার রক্ত দিতে পারবেন", body: "প্রস্তুত থাকার জন্য ধন্যবাদ।" },
  },
  "NTF-12": {
    en: { title: "Still available to donate?", body: "Tap to confirm in one second." },
    bn: { title: "এখনো রক্ত দিতে প্রস্তুত?", body: "এক সেকেন্ডে নিশ্চিত করতে ট্যাপ করুন।" },
  },
  "NTF-13": {
    en: { title: "Your pause has ended", body: "You'll receive requests again." },
    bn: { title: "আপনার বিরতি শেষ", body: "আবার অনুরোধ পাবেন।" },
  },
  "NTF-17": {
    en: { title: "New item to review", body: "{{kind}}" },
    bn: { title: "পর্যালোচনার জন্য নতুন বিষয়", body: "{{kind}}" },
  },
  "NTF-09": {
    en: {
      title: "No longer needed — thank you",
      body: "The {{group}} request at {{hospital}} has been arranged.",
    },
    bn: {
      title: "আর প্রয়োজন নেই — ধন্যবাদ",
      body: "{{hospital}}-এর {{group}} অনুরোধটির ব্যবস্থা হয়ে গেছে।",
    },
  },
  "NTF-16": {
    en: {
      title: "You're now confirmed: {{group}} at {{hospital}}",
      body: "Please contact the family now.",
    },
    bn: {
      title: "আপনি এখন নিশ্চিত: {{hospital}}-এ {{group}}",
      body: "অনুগ্রহ করে এখনই পরিবারের সঙ্গে যোগাযোগ করুন।",
    },
  },
  "NTF-18": {
    en: { title: "Test alert from UDVASITO", body: "If you can see this, alerts work." },
    bn: { title: "উদ্ভাসিতের পরীক্ষামূলক অ্যালার্ট", body: "এটি দেখতে পেলে অ্যালার্ট কাজ করছে।" },
  },
};

export const COMPONENT_LABEL: Record<Lang, Record<string, string>> = {
  en: { whole_blood: "Whole blood", platelets: "Platelets" },
  bn: { whole_blood: "সম্পূর্ণ রক্ত", platelets: "প্লাটিলেট" },
};

function render(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) =>
    params[key] === undefined ? "" : String(params[key]),
  );
}

/** Format a timestamp as HH:mm in Asia/Dhaka (push bodies, §6.8 {{time}}). */
export function formatTimeDhaka(ms: number): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(ms));
}

const push = new PushNotifications<string>(components.pushNotifications);

const sendWebPushRef = makeFunctionReference<"action">("pushWeb:sendToProfile");

export async function notifyUser(
  ctx: GenericMutationCtx<DataModel>,
  args: {
    recipient: Doc<"profiles">;
    template: string;
    requestId?: Id<"requests">;
    params: Record<string, string | number>;
    url: string;
    /** "urgent-requests" for NTF-01/02/07/08/16, else "updates" (§6.8). */
    channelId: "urgent-requests" | "updates";
    donorCallsBody?: boolean;
    /** Alternate template wording (NTF-15: "rejected"). */
    variant?: string;
  },
): Promise<Id<"notifications">> {
  const lang: Lang = args.recipient.language === "bn" ? "bn" : "en";
  const tpl = TEMPLATES[args.template]?.[lang];
  const notificationId = await ctx.db.insert("notifications", {
    recipientId: args.recipient._id,
    template: args.template,
    requestId: args.requestId,
    channel: "expo",
    status: "queued",
    isDemo: args.recipient.isDemo,
  });
  let status: "sent" | "failed" = "failed";
  let failure: string | undefined;
  let rendered: { title: string; body: string } | null = null;
  if (!tpl) {
    failure = "unknown_template";
  } else {
    const params = { ...args.params };
    if (args.template === "NTF-01" || args.template === "NTF-02") {
      params.urgent = params.urgent === "1" ? tpl.urgentPrefix ?? "" : "";
    }
    const wording =
      args.variant === "rejected" && tpl.rejected ? tpl.rejected : tpl;
    const title = render(wording.title, params);
    const body = render(args.donorCallsBody && tpl.bodyDonorCalls ? tpl.bodyDonorCalls : wording.body, params);
    rendered = { title, body };
    try {
      const pushId = await push.sendPushNotification(ctx, {
        userId: args.recipient.authUserId,
        notification: {
          title,
          body,
          channelId: args.channelId,
          data: { url: args.url, notificationId: String(notificationId) },
        },
        allowUnregisteredTokens: true,
      });
      if (pushId) status = "sent";
      else failure = "no_token_or_paused";
    } catch {
      failure = "push_error";
    }
  }
  await ctx.db.patch(notificationId, { status, failure });
  // Web Push fan-out (F-303): the same rendered, privacy-safe wording
  // goes to the recipient's browser subscriptions via the Node sender.
  // The notification row above stays the single inbox record.
  if (rendered) {
    const webSubs = await ctx.db
      .query("webPushSubscriptions")
      .withIndex("by_profile", (q) => q.eq("profileId", args.recipient._id))
      .collect();
    if (webSubs.length > 0) {
      await ctx.scheduler.runAfter(0, sendWebPushRef, {
        profileId: args.recipient._id,
        title: rendered.title,
        body: rendered.body,
        url: args.url,
        tag: String(notificationId),
      });
    }
  }
  // F-307 email copy (P7, switch `emailAlerts`): a donor who opted in
  // gets a second row on the email channel for alert templates. The
  // row stays `queued` until an email provider is configured (the
  // Step-5 free-channel choice is still open — see P7-REPORT); the
  // queue is the deliverable interface, visible in admin usage.
  if (
    (args.template === "NTF-01" || args.template === "NTF-02") &&
    (await featureOn(ctx, "emailAlerts"))
  ) {
    const donor = await ctx.db
      .query("donorProfiles")
      .withIndex("by_profile", (q) => q.eq("profileId", args.recipient._id))
      .unique();
    if (donor?.emailCopyOptIn === true) {
      await ctx.db.insert("notifications", {
        recipientId: args.recipient._id,
        template: args.template,
        requestId: args.requestId,
        channel: "email",
        status: "queued",
        isDemo: args.recipient.isDemo,
      });
    }
  }
  await recordEvent(ctx, "notification_sent", {
    requestId: args.requestId,
    actorRole: "system",
    props: { template: args.template, channel: "expo" },
    isDemo: args.recipient.isDemo,
  });
  return notificationId;
}
