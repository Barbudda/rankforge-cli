import { connect, checkServerIdentity } from "node:tls";
import { assertUrlAllowed } from "./ssrf";

/**
 * HTTPS certificate probe: one TLS handshake, no HTTP request. Reports expiry
 * and whether browsers would trust the certificate for this hostname. An
 * expired or mismatched certificate takes a site out of search results and
 * scares visitors off, and it is the kind of thing nobody notices until it
 * breaks, which is why monitoring checks it every run.
 */

export interface TlsInfo {
  host: string;
  /** ISO date the certificate stops being valid. */
  validTo: string;
  /** Whole days until expiry (negative once expired). */
  daysLeft: number;
  issuer: string | null;
  /** Chain trusted and hostname matches. */
  trusted: boolean;
  /** Why it isn't trusted, when it isn't. */
  error: string | null;
}

export async function probeTls(rawUrl: string, timeoutMs = 6000): Promise<TlsInfo | null> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  try {
    await assertUrlAllowed(u.toString());
  } catch {
    return null;
  }
  const host = u.hostname.replace(/^\[|\]$/g, "");
  const port = Number(u.port) || 443;

  return new Promise((resolve) => {
    let settled = false;
    const done = (v: TlsInfo | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(v);
    };
    const socket = connect({ host, port, servername: host, rejectUnauthorized: false }, () => {
      const cert = socket.getPeerCertificate();
      if (!cert || !cert.valid_to) return done(null);
      const validTo = new Date(cert.valid_to);
      const daysLeft = Math.floor((validTo.getTime() - Date.now()) / 86_400_000);
      let error: string | null = socket.authorized ? null : String(socket.authorizationError ?? "untrusted certificate");
      if (!error) {
        const mismatch = checkServerIdentity(host, cert);
        if (mismatch) error = `certificate is not valid for ${host}`;
      }
      if (!error && daysLeft < 0) error = "certificate has expired";
      const issuerRaw = cert.issuer as unknown as Record<string, string | string[]> | undefined;
      const org = issuerRaw?.O ?? issuerRaw?.CN;
      done({
        host,
        validTo: validTo.toISOString(),
        daysLeft,
        issuer: Array.isArray(org) ? org.join(", ") : (org ?? null),
        trusted: error === null,
        error,
      });
    });
    const timer = setTimeout(() => done(null), timeoutMs);
    socket.on("error", () => done(null));
  });
}
