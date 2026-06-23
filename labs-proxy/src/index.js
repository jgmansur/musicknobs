/**
 * musicknobs-labs-proxy
 *
 * Reverse-proxies musicknobs.com/labs/* to the GitHub Pages "Musicknobs Labs"
 * site (https://jgmansur.github.io/musicknobs/*), so the labs content is served
 * as a subdirectory of the main domain. Subdirectory (vs subdomain) consolidates
 * SEO authority to the apex — the whole point of this route.
 *
 * Everything outside /labs is untouched and continues to hit the Vercel origin.
 */

const UPSTREAM_ORIGIN = "https://jgmansur.github.io";
const UPSTREAM_BASE = "/musicknobs"; // GitHub Pages project path
const PREFIX = "/labs";

// Old gear-guide pages that now live as redesigned articles at /blog.
// 301 the guide root only (not sub-assets like /labs/EQ/chart.png).
const GUIDE_REDIRECTS = {
  "/EQ": "/blog/eq-lab",
  "/compresores": "/blog/compressors",
  "/delays": "/blog/delays",
  "/flanger": "/blog/modulation",
  "/sintetizadores": "/blog/synthesizers",
  "/microfonos": "/blog/microphones",
  "/guitaramps": "/blog/guitar-amps",
};

export default {
  async fetch(request) {
    const url = new URL(request.url);

    // Bare "/labs" (no trailing slash): redirect to "/labs/" so relative assets
    // in the served HTML resolve under /labs/ instead of the domain root.
    if (url.pathname === PREFIX) {
      return Response.redirect(`${url.origin}${PREFIX}/`, 301);
    }

    // Map /labs/<rest> -> https://jgmansur.github.io/musicknobs/<rest>
    const rest = url.pathname.slice(PREFIX.length); // keeps a leading "/"

    // Private apps stay exclusively on github.io (their OAuth / Google Cloud
    // config is bound to that origin). Never mirror them under /labs.
    const EXCLUDED = ["/manager-app", "/finance-dashboard"];
    if (EXCLUDED.some((p) => rest === p || rest.startsWith(`${p}/`))) {
      return new Response("Not found", { status: 404 });
    }

    // Migrated gear guides: 301 the guide root to its new /blog article.
    const guideKey = rest.replace(/\/$/, "");
    if (GUIDE_REDIRECTS[guideKey]) {
      return Response.redirect(`${url.origin}${GUIDE_REDIRECTS[guideKey]}`, 301);
    }

    const upstreamUrl = `${UPSTREAM_ORIGIN}${UPSTREAM_BASE}${rest}${url.search}`;

    const upstreamReq = new Request(upstreamUrl, {
      method: request.method,
      headers: request.headers,
      body: request.body,
      redirect: "manual", // we rewrite redirects ourselves
    });

    const upstreamRes = await fetch(upstreamReq);

    // GitHub Pages issues redirects (e.g. dir without trailing slash). Rewrite
    // any Location pointing at the upstream path back onto our /labs subdirectory.
    if (upstreamRes.status >= 300 && upstreamRes.status < 400) {
      const location = upstreamRes.headers.get("Location");
      if (location) {
        const rewritten = location
          .replace(`${UPSTREAM_ORIGIN}${UPSTREAM_BASE}`, `${url.origin}${PREFIX}`)
          .replace(new RegExp(`^${UPSTREAM_BASE}`), PREFIX);
        const headers = new Headers(upstreamRes.headers);
        headers.set("Location", rewritten);
        return new Response(null, { status: upstreamRes.status, headers });
      }
    }

    return new Response(upstreamRes.body, {
      status: upstreamRes.status,
      statusText: upstreamRes.statusText,
      headers: upstreamRes.headers,
    });
  },
};
