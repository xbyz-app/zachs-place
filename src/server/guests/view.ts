import type { Guest } from "../../lib/arrival/types";

export function siteUrl(): string {
  return (process.env.SITE_URL ?? "https://guest.xbyz.fun").replace(/\/$/, "");
}

export function pageUrl(site: string, g: Guest): string {
  return `${site}/arrive/${g.token}`;
}
