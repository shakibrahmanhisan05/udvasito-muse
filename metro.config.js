const { getDefaultConfig } = require("expo/metro-config");
const { withNativeWind } = require("nativewind/metro");

const config = getDefaultConfig(__dirname);

// ── Web bundle: prune unused zod locales (P7/X03) ─────────────────────
// zod v4's root export re-exports all 64 locale files (~300 KB raw).
// They enter the web graph through @better-auth/core's schema modules,
// which use zod schemas but never its localised error strings — and
// this app never surfaces raw zod messages anywhere (Convex errors are
// code-mapped, Better Auth has its own error codes). On web only, every
// non-English zod locale module resolves to the English one (Metro
// dedupes it to a single copy). Native bundles are untouched.
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  const resolve = defaultResolveRequest ?? context.resolveRequest;
  const result = resolve(context, moduleName, platform);
  if (
    platform === "web" &&
    result &&
    result.type === "sourceFile" &&
    /zod\/v4\/locales\/(?!en\.js$)[a-z-]+\.js$/.test(result.filePath)
  ) {
    return {
      ...result,
      filePath: result.filePath.replace(/zod\/v4\/locales\/[a-z-]+\.js$/, "zod/v4/locales/en.js"),
    };
  }
  return result;
};

module.exports = withNativeWind(config, { input: "./global.css" });
