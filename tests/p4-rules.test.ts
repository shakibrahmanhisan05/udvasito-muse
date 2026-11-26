import { describe, expect, it } from "vitest";
import { extractContactPhone, redact, toLatinDigits } from "../convex/rules/redaction";
import { buildIntakePayload } from "../convex/ai/gemini";

/**
 * P4 rules tests — redaction (PRD §6.2, specs §7.7: every rule with
 * English, Bangla and Banglish examples; zero phones or labelled names
 * may survive). The 500-message payload test lives in p4.test.ts, where
 * the real Gemini request body is built.
 */

const PHONE_RE = /(?:\+?880|0)1[3-9]\d{8}/;

describe("redaction — phones (rule 1)", () => {
  const forms = [
    "01812345678",
    "+8801812345678",
    "8801812345678",
    "008801812345678",
    "01812-345678",
    "01812 345 678",
    "+880 1812-345678",
    "০১৮১২৩৪৫৬৭৮", // Bangla digits
    "+৮৮০১৮১২৩৪৫৬৭৮", // Bangla digits with +880
    "০১৮১২-৩৪৫৬৭৮", // Bangla digits with dash
  ];
  for (const form of forms) {
    it(`removes ${form}`, () => {
      const out = redact(`Call me at ${form} please`);
      expect(out.removed.phones).toBe(1);
      expect(out.text).not.toMatch(PHONE_RE);
      expect(toLatinDigits(out.text)).not.toContain("1812345678");
    });
  }

  it("removes two numbers in one message", () => {
    const out = redact("যোগাযোগ: 01812345678 অথবা 01987654321");
    expect(out.removed.phones).toBe(2);
  });

  it("does not eat a 4-digit ward number or a year", () => {
    const out = redact("Ward 1204, admitted in 2026");
    expect(out.removed.phones).toBe(0);
    expect(out.text).toContain("1204");
  });
});

describe("redaction — labelled names (rule 2)", () => {
  it("English: Patient label", () => {
    const out = redact("Patient: Abdul Karim, needs B+ blood");
    expect(out.removed.names).toBe(1);
    expect(out.text).not.toContain("Abdul Karim");
    expect(out.text).toContain("needs B+ blood");
  });

  it("English: Name label without colon", () => {
    const out = redact("Name Fatema Begum, ward 5");
    expect(out.text).not.toContain("Fatema Begum");
  });

  it("English: Mr. label", () => {
    const out = redact("Mr. Hasan Ali is admitted, urgent");
    expect(out.text).not.toContain("Hasan Ali");
  });

  it("Bangla: রোগীর নাম label", () => {
    const out = redact("রোগীর নাম: মোঃ আব্দুল করিম, বি পজিটিভ রক্ত লাগবে");
    expect(out.removed.names).toBe(1);
    expect(out.text).not.toContain("আব্দুল করিম");
    expect(out.text).toContain("রক্ত লাগবে");
  });

  it("Bangla: রোগী label with colon", () => {
    const out = redact("রোগী: ফাতেমা বেগম\nও পজিটিভ লাগবে");
    expect(out.text).not.toContain("ফাতেমা বেগম");
    expect(out.text).toContain("ও পজিটিভ লাগবে");
  });

  it("Bangla: জনাব label", () => {
    const out = redact("জনাব রফিকুল ইসলাম, চমেক হাসপাতালে আছেন");
    expect(out.text).not.toContain("রফিকুল ইসলাম");
  });

  it("Bangla possessive: রোগীর before a name phrase", () => {
    const out = redact("রোগীর নাম মোঃ সেলিম, আগামীকাল লাগবে");
    expect(out.text).not.toContain("সেলিম");
  });

  it("does NOT redact after নাম inside নামাজ (prayer)", () => {
    const out = redact("নামাজের পর রক্ত দিতে আসব, ইনশাআল্লাহ");
    expect(out.removed.names).toBe(0);
    expect(out.text).toContain("রক্ত দিতে আসব");
  });

  it("Banglish: 'rogir nam' label redacts; bare 'rogir' does not eat the sentence", () => {
    const labelled = redact("Rogir nam: Md Selim, B+ lagbe");
    expect(labelled.text).not.toContain("Md Selim");
    const plain = redact("rogir jonno rokto lagbe, ajkei");
    expect(plain.removed.names).toBe(0);
    expect(plain.text).toContain("rokto lagbe");
  });
});

describe("redaction — diagnoses (rule 3)", () => {
  it("removes English + Bangla diagnosis words", () => {
    const out = redact("He has cancer and needs surgery. ডায়ালাইসিস চলছে, থ্যালাসেমিয়া আছে।");
    expect(out.text.toLowerCase()).not.toContain("cancer");
    expect(out.text.toLowerCase()).not.toContain("surgery");
    expect(out.text).not.toContain("ডায়ালাইসিস");
    expect(out.text).not.toContain("থ্যালাসেমিয়া");
    expect(out.removed.diagnoses).toBeGreaterThanOrEqual(4);
  });

  it("keeps dengue (operational field, not in the PRD §6.2 list)", () => {
    const out = redact("ডেঙ্গু রোগীর জন্য প্লাটিলেট লাগবে, dengue patient");
    expect(out.text).toContain("ডেঙ্গু");
    expect(out.text.toLowerCase()).toContain("dengue");
  });

  it("word boundaries: 'hiv' does not hit other words", () => {
    const out = redact("archive the report, hiv test done");
    expect(out.text).toContain("archive");
    expect(out.text.toLowerCase()).not.toMatch(/\bhiv\b/);
  });
});

describe("redaction — emails and IDs (rule 4)", () => {
  it("removes emails", () => {
    const out = redact("mail me at karim.uddin+bd@gmail.com or fatema@yahoo.co.uk");
    expect(out.removed.emails).toBe(2);
    expect(out.text).not.toContain("@");
  });

  it("removes 10/13/17-digit ID numbers", () => {
    expect(redact("NID 1234567890").removed.ids).toBe(1);
    expect(redact("NID 1234567890123").removed.ids).toBe(1);
    expect(redact("NID 12345678901234567").removed.ids).toBe(1);
    expect(redact("NID 12345678901234567").text).not.toContain("12345678901234567");
  });

  it("removes spaced ID groups", () => {
    const out = redact("NID: 1234 5678 9012 34567, ward 3");
    expect(out.removed.ids).toBe(1);
    expect(out.text).not.toContain("5678");
  });

  it("removes Bangla-digit ID numbers (after digit conversion)", () => {
    const out = redact("এনআইডি ১২৩৪৫৬৭৮৯০");
    expect(out.removed.ids).toBe(1);
  });

  it("keeps ordinary short numbers (units, ward, dates)", () => {
    const out = redact("2 bags needed, ward 12, by 2026-12-05");
    expect(out.removed.ids).toBe(0);
    expect(out.text).toContain("2 bags");
  });
});

describe("extractContactPhone — the code-only phone path", () => {
  it("normalises every common form to 01XXXXXXXXX", () => {
    expect(extractContactPhone("যোগাযোগ: 01812-345678")).toBe("01812345678");
    expect(extractContactPhone("call +880 1812 345678 now")).toBe("01812345678");
    expect(extractContactPhone("ফোন: ০১৮১২৩৪৫৬৭৮")).toBe("01812345678");
    expect(extractContactPhone("8801812345678")).toBe("01812345678");
  });

  it("returns the FIRST number when several appear", () => {
    expect(extractContactPhone("01911111111 or 01812345678")).toBe("01911111111");
  });

  it("returns null when there is no mobile number", () => {
    expect(extractContactPhone("no number here, ward 5")).toBeNull();
    expect(extractContactPhone("landline 02-41356220")).toBeNull();
  });
});

describe("redaction — 500 generated messages, zero PII reaches the AI payload (P4 DoD)", () => {
  // Deterministic LCG so the set is identical on every run.
  let state = 42;
  const rnd = () => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  const pick = <T,>(arr: readonly T[]): T => arr[Math.floor(rnd() * arr.length)]!;

  const NAMES = [
    "করিম উদ্দিন", "ফাতেমা বেগম", "মোঃ আব্দুল সেলিম", "রফিকুল ইসলাম",
    "Abdul Karim", "Fatema Begum", "Md Selim Uddin", "Nasrin Akter",
  ];
  const CUES = ["রোগীর নাম:", "রোগী:", "নাম:", "Patient:", "Name:", "জনাব"];
  const DIAGNOSES = ["ক্যান্সার", "ডায়ালাইসিস", "cancer", "surgery", "থ্যালাসেমিয়া"];
  const NEEDS = [
    "B+ রক্ত লাগবে ২ ব্যাগ, আগামীকাল সকালে, চট্টগ্রাম মেডিকেল কলেজ হাসপাতাল",
    "O- blood needed, 1 bag, today, Parkview Hospital",
    "এ পজিটিভ প্লাটিলেট লাগবে আজকেই, ডেঙ্গু রোগী",
    "AB+ blood lagbe 3 bag, ekhoni, Imperial Hospital",
  ];
  const toBnDigits = (s: string) => s.replace(/\d/g, (d) => "০১২৩৪৫৬৭৮৯"[Number(d)]!);

  function phoneForms(core: string): string[] {
    // core = 10 digits starting 1[3-9] (the part after the leading 0).
    return [
      `0${core}`,
      `+880${core}`,
      `880${core}`,
      `0${core.slice(0, 4)}-${core.slice(4)}`,
      `0${core.slice(0, 4)} ${core.slice(4, 7)} ${core.slice(7)}`,
      toBnDigits(`0${core}`),
      toBnDigits(`+880${core}`),
    ];
  }

  it("plants a phone, a labelled name, an email, an ID and a diagnosis in 500 messages — none survives into the payload", () => {
    for (let i = 0; i < 500; i++) {
      const core = `1${pick(["3", "4", "5", "6", "7", "8", "9"])}${String(
        Math.floor(rnd() * 1e8),
      ).padStart(8, "0")}`;
      const phone = pick(phoneForms(core));
      const name = pick(NAMES);
      const cue = pick(CUES);
      const email = `person${i}.test@examplemail.com`;
      const idLen = pick([10, 13, 17]);
      // Leading 9 keeps the planted ID out of phone-number shape, so the
      // per-category counts stay meaningful (a 01… ID would be removed by
      // the phone rule first — still removed, just counted as a phone).
      const id =
        "9" + Array.from({ length: idLen - 1 }, () => Math.floor(rnd() * 10)).join("");
      const diagnosis = pick(DIAGNOSES);
      const text =
        `${cue} ${name}, ${diagnosis} — ${pick(NEEDS)}। ` +
        `যোগাযোগ: ${phone}, ইমেইল: ${email}, এনআইডি: ${id}`;

      const { text: redacted, removed } = redact(text);
      expect(removed.phones, `msg ${i}`).toBeGreaterThanOrEqual(1);
      expect(removed.names, `msg ${i}`).toBeGreaterThanOrEqual(1);
      expect(removed.emails, `msg ${i}`).toBe(1);
      // A random ID can contain a phone-shaped substring; the phone rule
      // (which runs first) then removes that span and the ID counter
      // never sees it. Either way the digits are gone — the payload
      // assertions below are the actual zero-leak invariant.
      expect(removed.ids + removed.phones, `msg ${i}`).toBeGreaterThanOrEqual(2);
      expect(redacted, `msg ${i} id-in-redacted`).not.toContain(id);

      // The EXACT body the action POSTs to Gemini.
      const payload = JSON.stringify(buildIntakePayload(redacted, "2026-12-03"));
      expect(payload, `msg ${i} phone`).not.toContain(core);
      expect(payload, `msg ${i} phone`).not.toContain(`880${core}`);
      expect(payload, `msg ${i} phone-raw`).not.toContain(phone);
      expect(payload, `msg ${i} name`).not.toContain(name);
      expect(payload, `msg ${i} email`).not.toContain(email);
      expect(payload, `msg ${i} id`).not.toContain(id);
      expect(payload, `msg ${i} diagnosis`).not.toContain(diagnosis);
    }
  });
});

// ── Web Push crypto (F-303): VAPID JWT (RFC 8292) ─────────────────────

describe("P4 — VAPID authorization", () => {
  it("produces an ES256 JWT that verifies against the public key", async () => {
    const { generateVapidKeys, vapidAuthorization } = await import(
      "../convex/_lib/webPushCrypto"
    );
    const { createPublicKey, verify } = await import("node:crypto");
    const keys = generateVapidKeys();
    const header = vapidAuthorization(
      "https://push.example.com",
      "https://udvasito.example",
      keys.privateKey,
      keys.publicKey,
    );
    const match = /^vapid t=([\w.-]+), k=([\w-]+)$/.exec(header);
    expect(match).not.toBeNull();
    const [, jwt, k] = match!;
    expect(k).toBe(keys.publicKey);
    const [h, p, s] = jwt!.split(".");
    const claims = JSON.parse(Buffer.from(p!, "base64url").toString("utf8")) as {
      aud: string; sub: string; exp: number;
    };
    expect(claims.aud).toBe("https://push.example.com");
    expect(claims.sub).toBe("https://udvasito.example");
    expect(claims.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
    const pub = createPublicKey({
      key: {
        kty: "EC", crv: "P-256",
        x: Buffer.from(keys.publicKey, "base64url").subarray(1, 33).toString("base64url"),
        y: Buffer.from(keys.publicKey, "base64url").subarray(33, 65).toString("base64url"),
      },
      format: "jwk",
    });
    const ok = verify(
      "sha256",
      Buffer.from(`${h}.${p}`),
      { key: pub, dsaEncoding: "ieee-p1363" },
      Buffer.from(s!, "base64url"),
    );
    expect(ok).toBe(true);
    void h;
  });
});
