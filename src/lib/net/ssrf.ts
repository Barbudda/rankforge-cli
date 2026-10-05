import { isIP } from "node:net";
import { lookup } from "node:dns/promises";

/**
 * SSRF protection for the crawler and resource prober.
 *
 * These modules fetch arbitrary URLs — safe when RankForge runs locally
 * (auditing your own dev server is the point), dangerous on a hosted instance
 * where a caller could steer it at cloud-metadata or internal services.
 *
 * The guard is enforced everywhere EXCEPT explicit local development, and it
 * validates the *resolved IP addresses* (not just the hostname string), so it
 * can't be bypassed by a public DNS name that resolves to a private address.
 * Callers additionally re-validate on every redirect hop, so a public URL that
 * 3xx-redirects to an internal host is caught too.
 */

/**
 * Fail closed: enforced everywhere except (a) explicit local development and
 * (b) a trusted local runtime that opts out — the CLI sets
 * RANKFORGE_ALLOW_LOCAL=1 because it runs on the user's own machine, where
 * auditing http://localhost is the whole point and there's no server to
 * protect. A hosted deployment must never set this variable.
 */
export function ssrfEnforced(): boolean {
  if (process.env.RANKFORGE_ALLOW_LOCAL === "1") return false;
  return process.env.NODE_ENV !== "development";
}

/** Parse a dotted IPv4 string to its 4 octets, or null. */
function ipv4Octets(ip: string): [number, number, number, number] | null {
  const m = ip.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return null;
  const o = [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] as const;
  if (o.some((n) => n > 255)) return null;
  return [o[0], o[1], o[2], o[3]];
}

function ipv4Blocked(a: number, b: number): boolean {
  return (
    a === 0 || // "this" network
    a === 10 || // private
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT 100.64/10
    (a === 169 && b === 254) || // link-local + cloud metadata (169.254.169.254)
    (a === 172 && b >= 16 && b <= 31) || // private
    (a === 192 && b === 168) || // private
    (a === 192 && b === 0) || // 192.0.0/24 + 192.0.2/24 (special-use)
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast + reserved (224+)
  );
}

/** True if an IP literal is private/loopback/link-local/reserved. */
export function ipIsBlocked(ip: string): boolean {
  const host = ip.toLowerCase().replace(/^\[|\]$/g, "");

  const v4 = ipv4Octets(host);
  if (v4) return ipv4Blocked(v4[0], v4[1]);

  if (isIP(host) === 6) {
    // IPv4-mapped IPv6 — check the embedded v4 (dotted or hex forms).
    const mappedDotted = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
    if (mappedDotted) return ipIsBlocked(mappedDotted[1]!);
    const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1]!, 16);
      const lo = parseInt(mappedHex[2]!, 16);
      return ipv4Blocked((hi >> 8) & 0xff, hi & 0xff);
    }
    if (host === "::1" || host === "::") return true; // loopback / unspecified
    if (host.startsWith("fe80:") || host.startsWith("fe9") || host.startsWith("fea") || host.startsWith("feb")) return true; // link-local
    if (host.startsWith("fc") || host.startsWith("fd")) return true; // unique local (fc00::/7)
    return false;
  }

  return false; // not an IP literal
}

/**
 * Assert a URL is safe to fetch from a hosted server: http/https, and its
 * hostname resolves ONLY to public addresses. No-op in local development.
 * Throws with a caller-safe message otherwise.
 */
export async function assertUrlAllowed(rawUrl: string): Promise<void> {
  const u = new URL(rawUrl);
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new Error("Only http/https URLs are allowed.");
  }
  if (!ssrfEnforced()) return;

  const host = u.hostname.replace(/^\[|\]$/g, "");

  // Literal IP — validate directly (covers IPv4, IPv6, IPv4-mapped).
  if (isIP(host) !== 0) {
    if (ipIsBlocked(host)) throw new Error("This host is not allowed (private/internal address).");
    return;
  }

  // Obvious internal names.
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("This host is not allowed (internal name).");
  }

  // Resolve the name and reject if ANY address is private/reserved.
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw new Error("Could not resolve the host.");
  }
  if (addrs.length === 0) throw new Error("Host did not resolve.");
  for (const a of addrs) {
    if (ipIsBlocked(a.address)) {
      throw new Error("This host resolves to a private/internal address.");
    }
  }
}

/**
 * fetch() with SSRF protection: validates the target (and every redirect hop)
 * against private/internal addresses before connecting. In local development
 * it degrades to a plain redirect-following fetch.
 *
 * NOTE: there is a residual DNS-rebinding window between validation and the
 * kernel connect for public names; connection-level IP pinning would close it
 * fully. For RankForge's threat model (a hosted auditor behind a bearer key)
 * per-hop resolved-IP validation is the pragmatic guard.
 */
export async function guardedFetch(
  url: string,
  init: RequestInit & { maxHops?: number } = {},
): Promise<Response> {
  const { maxHops = 5, ...rest } = init;
  if (!ssrfEnforced()) {
    return fetch(url, { ...rest, redirect: "follow" });
  }
  let current = url;
  for (let hop = 0; hop <= maxHops; hop++) {
    await assertUrlAllowed(current);
    const res = await fetch(current, { ...rest, redirect: "manual" });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc || hop === maxHops) return res;
      // Release the redirect body; follow to the (re-validated) next hop.
      res.body?.cancel().catch(() => {});
      current = new URL(loc, current).toString();
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects.");
}
