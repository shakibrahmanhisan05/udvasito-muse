import { describe, expect, it } from "vitest";
import { scrubPhoneNumbers, scrubValue } from "../src/lib/scrub";

describe("Sentry phone scrubber (CLAUDE.md rule 3)", () => {
  it("removes Latin-digit numbers in common forms", () => {
    expect(scrubPhoneNumbers("call 01712345678 now")).toBe("call [phone] now");
    expect(scrubPhoneNumbers("+8801712-345678")).toBe("[phone]");
    expect(scrubPhoneNumbers("880 1812 345 678")).toContain("[phone]");
  });
  it("removes Bangla-digit numbers", () => {
    const out = scrubPhoneNumbers("নম্বর ০১৭১২৩৪৫৬৭৮");
    expect(out).not.toContain("০১৭১২");
    expect(out).toContain("[phone]");
  });
  it("deep-scrubs nested event payloads", () => {
    const event = { message: "donor 01712345678", extra: { list: ["০১৮১২৩৪৫৬৭৮"] } };
    const out = scrubValue(event);
    expect(JSON.stringify(out)).not.toContain("01712345678");
    expect(JSON.stringify(out)).not.toContain("০১৮১২");
  });
  it("leaves non-phone text alone", () => {
    expect(scrubPhoneNumbers("B+ needed at CMCH, 2 bags")).toBe("B+ needed at CMCH, 2 bags");
  });
});

describe("Sentry scrubber — P6 widening (specs §7.4: phones, emails, tokens)", () => {
  it("removes separator-variant phones like the server redaction engine", () => {
    for (const v of [
      "01812.345.678", "01812/345678", "01812 345 678",
      "+880 1812-345678", "008801812345678", "0 1 8 1 2 3 4 5 6 7 8",
    ]) {
      const out = scrubPhoneNumbers(`call ${v} now`);
      expect(out, v).toBe("call [phone] now");
    }
    // Parenthesised form: the digits are removed (a stray "(" is
    // punctuation, not PII — same match boundary as the server engine).
    expect(scrubPhoneNumbers("call (01812) 345678 now")).not.toContain("01812");
    expect(scrubPhoneNumbers("call (01812) 345678 now")).toContain("[phone]");
    // Controls the server engine also spares: a date and a landline.
    expect(scrubPhoneNumbers("on 2026-12-05")).toBe("on 2026-12-05");
    expect(scrubPhoneNumbers("ward 02-9611010")).toBe("ward 02-9611010");
  });

  it("removes email addresses", () => {
    expect(scrubValue("mail me at hisan1070@gmail.com please")).toContain("[email]");
    expect(scrubValue("mail me at hisan1070@gmail.com please")).not.toContain("gmail.com");
  });

  it("removes bearer tokens, JWTs and labelled secrets from strings", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3AAA";
    const out = scrubValue(`auth Bearer abcDEF123-_.~+/= and ${jwt} plus token: hunter2hunter2`);
    expect(out).not.toContain("abcDEF123");
    expect(out).not.toContain("eyJhbGciOiJIUzI1NiJ9");
    expect(out).not.toContain("hunter2hunter2");
    expect(out).toContain("Bearer [redacted]");
  });

  it("redacts credential-shaped keys wholesale in events and breadcrumbs", () => {
    const event = {
      message: "sign-in failed for 01712345678",
      request: { headers: { Authorization: "Bearer abc.def.ghi", "Content-Type": "application/json" } },
      extra: { apiKey: "AIzaSyA-fake-google-key-1234567890", nested: [{ refresh_token: "1//0gFakeToken" }] },
      breadcrumbs: [{ message: "POST /api?key=AIzaSyA-fake", data: { password: "p@ssw0rd!" } }],
    };
    const out = scrubValue(event) as typeof event;
    const flat = JSON.stringify(out);
    expect(flat).not.toContain("01712345678");
    expect(flat).not.toContain("abc.def.ghi");
    expect(flat).not.toContain("AIzaSyA-fake-google-key-1234567890");
    expect(flat).not.toContain("1//0gFakeToken");
    expect(flat).not.toContain("p@ssw0rd!");
    expect(flat).not.toContain("key=AIzaSyA-fake");
    // Non-sensitive structure survives untouched.
    expect(out.request.headers["Content-Type"]).toBe("application/json");
    expect(out.message).toBe("sign-in failed for [phone]");
  });
});
