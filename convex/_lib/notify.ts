import type { GenericMutationCtx } from "convex/server";
import { PushNotifications } from "@convex-dev/expo-push-notifications";
import { components } from "../_generated/api";
import type { DataModel, Doc, Id } from "../schemaTypes";
import { recordEvent } from "./events";

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

type Template = { title: string; body: string; bodyDonorCalls?: string; urgentPrefix?: string };

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
  if (!tpl) {
    failure = "unknown_template";
  } else {
    const params = { ...args.params };
    if (args.template === "NTF-01") {
      params.urgent = params.urgent === "1" ? tpl.urgentPrefix ?? "" : "";
    }
    const title = render(tpl.title, params);
    const body = render(args.donorCallsBody && tpl.bodyDonorCalls ? tpl.bodyDonorCalls : tpl.body, params);
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
  await recordEvent(ctx, "notification_sent", {
    requestId: args.requestId,
    actorRole: "system",
    props: { template: args.template, channel: "expo" },
    isDemo: args.recipient.isDemo,
  });
  return notificationId;
}
