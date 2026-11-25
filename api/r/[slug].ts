/**
 * GET /r/<slug> — share-link preview (specs §6.5, ADR-006). Served by Vercel
 * (vercel.json rewrites /r/:slug to this function before the SPA fallback).
 * Returns HTML with Open Graph tags for the anonymised shared request, then
 * meta-refreshes into the app route /r/<slug> (SCR-P02). No personal data is
 * ever in the preview (P-12): only blood group, component, hospital, area.
 *
 * Data comes from the Convex public query `public:sharedRequestBySlug`
 * (lands with SCR-P02). Until it exists — or if the slug is unknown — this
 * returns the branded 404 page, exactly as specs §6.5 specifies; it never
 * fabricates request details.
 */
type SharedRequest = {
  bloodGroup: string;
  component: string;
  hospitalName: string;
  area: string;
  neededByText?: string;
};

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);
}

const APP_ORIGIN = "https://udvasito.vercel.app";

function page(opts: { status: number; title: string; description: string; slug?: string }): Response {
  const refresh = opts.slug
    ? `<meta http-equiv="refresh" content="0; url=${APP_ORIGIN}/r/${encodeURIComponent(opts.slug)}" />`
    : "";
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(opts.title)}</title>
<meta name="description" content="${escapeHtml(opts.description)}" />
<meta property="og:title" content="${escapeHtml(opts.title)}" />
<meta property="og:description" content="${escapeHtml(opts.description)}" />
<meta property="og:image" content="${APP_ORIGIN}/og-image.png" />
<meta property="og:type" content="website" />
${refresh}
</head>
<body style="font-family: system-ui, sans-serif; background: #FDECEE; color: #1D3557; display: grid; place-items: center; min-height: 100vh; margin: 0;">
<main style="text-align: center; padding: 24px;">
<h1 style="color: #C1121F;">UDVASITO</h1>
<p>${escapeHtml(opts.description)}</p>
${opts.slug ? `<p><a href="${APP_ORIGIN}/r/${encodeURIComponent(opts.slug)}">Open the request</a></p>` : ""}
</main>
</body>
</html>`;
  return new Response(html, {
    status: opts.status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const slug = url.pathname.split("/").filter(Boolean).pop() ?? "";
  const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;
  if (!slug || !convexUrl) {
    return page({ status: 404, title: "UDVASITO — link not found", description: "This shared link was not found. Open UDVASITO to see current requests." });
  }
  try {
    const res = await fetch(`${convexUrl}/api/query`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: "public:sharedRequestBySlug", args: { slug }, format: "json" }),
    });
    const data = (await res.json()) as { status?: string; value?: SharedRequest | null };
    const shared = data.status === "success" ? data.value : null;
    if (!shared) {
      return page({ status: 404, title: "UDVASITO — link not found", description: "This shared link was not found. Open UDVASITO to see current requests." });
    }
    const title = `${shared.bloodGroup} ${shared.component} needed · ${shared.hospitalName}`;
    const description = `Blood needed at ${shared.hospitalName}, ${shared.area}. Open UDVASITO to respond — your number is shared only if you agree.`;
    return page({ status: 200, title, description, slug });
  } catch {
    return page({ status: 404, title: "UDVASITO — link not found", description: "This shared link was not found. Open UDVASITO to see current requests." });
  }
}
