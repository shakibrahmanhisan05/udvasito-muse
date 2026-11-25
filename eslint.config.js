// ESLint flat config (eslint-config-expo) + i18n literal-string discipline.
// specs.md §1.6 rule 1 / CLAUDE.md rule 13 / roadmap §2.3 DoD: every
// user-facing string comes from src/i18n/*.json via t('key'). The
// i18next/no-literal-string rule (eslint-plugin-i18next) is enforced for
// app/ + src/ below — `npm run check` fails on a planted literal.
const { defineConfig } = require("eslint/config");
const expoConfig = require("eslint-config-expo/flat");
const i18next = require("eslint-plugin-i18next");

module.exports = defineConfig([
  expoConfig,
  {
    ignores: [
      "dist/*",
      "node_modules/*",
      "convex/_generated/**",
      ".expo/*",
      "src/content/generated/**",
    ],
  },
  {
    // No literal user-facing strings in app code (JSX text + checked props).
    files: ["app/**/*.{ts,tsx}", "src/**/*.{ts,tsx}"],
    plugins: { i18next },
    rules: {
      "i18next/no-literal-string": [
        "error",
        {
          mode: "jsx-only",
          "jsx-attributes": {
            include: ["title", "placeholder", "accessibilityLabel", "headerTitle", "alt", "label"],
          },
          callees: {
            exclude: [
              "t", "i18n.t", "require", "Error", "ConvexError",
              "StyleSheet.create", "StyleSheet.flatten",
              "Linking.openURL", "router.push", "router.replace", "makeFunctionReference",
            ],
          },
          words: {
            // Language names are proper nouns shown in their own script
            // (CMP-LanguageToggle, specs §3.0) — not translatable copy.
            exclude: ["বাংলা", "EN", "UDVASITO", "উদ্ভাসিত", "✓", "•"],
          },
        },
      ],
    },
  },
]);
