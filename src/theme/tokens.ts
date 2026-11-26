/**
 * Design tokens — docs/specs.md §1.3. Light theme only in v1.
 * `brand.logoRed` is for the logo and illustrations ONLY — never behind text.
 */
export const colors = {
  brand: {
    primary: "#C1121F",
    primaryPressed: "#A50F1A",
    primarySoft: "#FDECEE",
    logoRed: "#E63946",
    navy: "#1D3557",
  },
  text: { primary: "#111827", muted: "#4B5563" },
  border: { input: "#8A94A6", subtle: "#E5E7EB" },
  bg: { app: "#FFFFFF", surface: "#F6F7F9" },
  status: {
    success: "#1B7F3B",
    successText: "#1B6B34",
    successBg: "#E8F5EC",
    warning: "#8A4B00",
    warningBg: "#FFF4E0",
    info: "#1D4ED8",
  },
  component: { platelets: "#6D28D9", dengue: "#92400E", dengueBg: "#FEF3C7" },
  focus: { ring: "#1D4ED8" },
} as const;

/** Typography (§1.3.2) — size / lineHeight EN / lineHeight BN / weight. */
export const typography = {
  display: { fontSize: 28, lineHeight: 34, lineHeightBn: 40, fontWeight: "700" as const },
  title: { fontSize: 22, lineHeight: 28, lineHeightBn: 34, fontWeight: "700" as const },
  heading: { fontSize: 18, lineHeight: 24, lineHeightBn: 30, fontWeight: "600" as const },
  body: { fontSize: 16, lineHeight: 24, lineHeightBn: 28, fontWeight: "400" as const },
  bodyStrong: { fontSize: 16, lineHeight: 24, lineHeightBn: 28, fontWeight: "600" as const },
  small: { fontSize: 14, lineHeight: 20, lineHeightBn: 24, fontWeight: "400" as const },
  caption: { fontSize: 12, lineHeight: 16, lineHeightBn: 20, fontWeight: "400" as const },
} as const;

/** Spacing scale 4/8/12/16/24/32/48 (§1.3.3). */
export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { input: 8, chip: 8, card: 12, pill: 999 } as const;
/** Touch targets ≥ 48dp; primary buttons 52dp tall (§1.3.3, §1.7). */
export const touch = { min: 48, buttonHeight: 52 } as const;

export const fonts = {
  regular: "NotoSans_400Regular",
  semiBold: "NotoSans_600SemiBold",
  bold: "NotoSans_700Bold",
  bengaliRegular: "NotoSansBengali_400Regular",
  bengaliSemiBold: "NotoSansBengali_600SemiBold",
  bengaliBold: "NotoSansBengali_700Bold",
} as const;
