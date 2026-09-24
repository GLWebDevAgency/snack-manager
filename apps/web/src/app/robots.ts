import type { MetadataRoute } from "next";
import { headers } from "next/headers";
import { isPublicSearchHost } from "@/lib/search-indexing";
import { urlAbsolue } from "@/lib/site";

/**
 * Keep HTML routes crawlable: the proxy's X-Robots-Tag excludes administration,
 * demos and non-public deployments from the index. Disallowing them would hide
 * that directive from crawlers. API crawling remains blocked to avoid useless
 * requests; authentication and the tenant boundary are unchanged.
 *
 * Reading Host keeps this route dynamic: restaurant domains and previews must
 * never inherit the marketing sitemap from a build-time cached robots.txt.
 */
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get("host");
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: ["/api$", "/api/"],
    },
    ...(isPublicSearchHost(host) ? { sitemap: urlAbsolue("/sitemap.xml") } : {}),
  };
}
