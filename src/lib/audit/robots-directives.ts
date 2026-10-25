/**
 * Indexing directives a page sends to search engines, from both places Google
 * reads them: the `<meta name="robots">` tag and the `X-Robots-Tag` HTTP
 * header. The header is the one teams forget: a CDN rule or a staging config
 * can noindex a whole site without a single line of HTML changing.
 *
 * Google applies the most restrictive rule when the two disagree, and a
 * header may scope rules to one crawler ("googlebot: noindex").
 */

// Directives that legitimately contain a colon: not crawler scopes.
const DIRECTIVE_WITH_VALUE = /^(max-snippet|max-image-preview|max-video-preview|unavailable_after)\s*:/i;

/** Directives in an X-Robots-Tag value that apply to `agent` (or to all crawlers). */
export function headerDirectives(value: string | null | undefined, agent = "googlebot"): string[] {
  if (!value) return [];
  const out: string[] = [];
  let scope: string | null = null; // null = every crawler
  for (const raw of value.split(",")) {
    let token = raw.trim().toLowerCase();
    if (!token) continue;
    const scoped = token.match(/^([a-z0-9_-]+)\s*:\s*(.*)$/);
    if (scoped && !DIRECTIVE_WITH_VALUE.test(token)) {
      scope = scoped[1]!;
      token = scoped[2]!.trim();
      if (!token) continue;
    }
    if (scope === null || scope === agent) out.push(token);
  }
  return out;
}

export interface RobotsSignals {
  metaRobots: string | null;
  metaGooglebot?: string | null;
  xRobotsTag?: string | null;
}

const NOINDEX = /\b(noindex|none)\b/;

/**
 * True when the page's own markup asks not to be indexed. Unlike the header,
 * the meta tag ships with the code: preview hosts add `X-Robots-Tag: noindex`
 * to every response, never a meta tag.
 */
export function isMetaNoindex(p: RobotsSignals): boolean {
  return NOINDEX.test((p.metaRobots ?? "").toLowerCase()) || NOINDEX.test((p.metaGooglebot ?? "").toLowerCase());
}

/** True when Google is told not to index the page (meta tag or header). */
export function isNoindex(p: RobotsSignals): boolean {
  if (isMetaNoindex(p)) return true;
  return headerDirectives(p.xRobotsTag).some((d) => d === "noindex" || d === "none");
}

/** Where the noindex comes from, for evidence ("meta robots: noindex, follow"). */
export function noindexSource(p: RobotsSignals): string {
  const parts: string[] = [];
  if (NOINDEX.test((p.metaRobots ?? "").toLowerCase())) parts.push(`meta robots: ${p.metaRobots}`);
  if (NOINDEX.test((p.metaGooglebot ?? "").toLowerCase())) parts.push(`meta googlebot: ${p.metaGooglebot}`);
  if (headerDirectives(p.xRobotsTag).some((d) => d === "noindex" || d === "none")) {
    parts.push(`X-Robots-Tag header: ${p.xRobotsTag}`);
  }
  return parts.join(" + ");
}
