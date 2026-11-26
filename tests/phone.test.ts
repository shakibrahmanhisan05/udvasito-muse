import { describe, expect, it } from "vitest";
import {
  formatBdPhoneDisplay,
  isValidBdMobile,
  normalizeBdPhone,
  toBanglaDigits,
  toEnglishDigits,
} from "../src/lib/phone";

describe("phone helpers", () => {
  it("normalises every accepted BD mobile shape to +880 form", () => {
    for (const input of ["01712345678", "8801712345678", "+8801712345678", "01712-345 678", "+880 1712 345678"]) {
      expect(normalizeBdPhone(input)).toBe("+8801712345678");
    }
  });

  it("accepts Bangla digits", () => {
    expect(normalizeBdPhone("০১৭১২৩৪৫৬৭৮")).toBe("+8801712345678");
    expect(toEnglishDigits("০১২৩৪৫৬৭৮৯")).toBe("0123456789");
    expect(toBanglaDigits("01712345678")).toBe("০১৭১২৩৪৫৬৭৮");
  });

  it("rejects landlines, wrong prefixes and short numbers", () => {
    for (const input of ["02-41356220", "01212345678", "0171234567", "+88017123456789", "12345", ""]) {
      expect(normalizeBdPhone(input)).toBeNull();
      expect(isValidBdMobile(input)).toBe(false);
    }
  });

  it("formats the display form", () => {
    expect(formatBdPhoneDisplay("+8801712345678")).toBe("01712-345678");
  });
});
