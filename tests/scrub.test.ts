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
