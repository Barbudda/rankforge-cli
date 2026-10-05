/**
 * Runtime configuration. The whole product runs in "mock" mode by
 * default — every service has a realistic mock implementation, so the
 * app is fully functional with zero external credentials. Flip
 * RANKFORGE_MODE=live (and provide the env vars) to wire real adapters.
 */

export type RuntimeMode = "mock" | "live";

/**
 * Resolve and normalize the absolute site origin. `new URL(...).origin`
 * validates the env var and strips trailing slashes/paths so every concat
 * site (sitemap, robots, canonicals, JSON-LD) gets a clean origin. Fails
 * loudly at build/prerender time if production would ship localhost URLs.
 */
function resolveAppUrl(): string {
  const raw =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : "http://localhost:3000");
  // Tolerate a bare domain (a very common paste, e.g. "my-app.vercel.app"):
  // add a scheme rather than crashing the whole build with `Invalid URL`.
  const withScheme = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let origin: string;
  try {
    origin = new URL(withScheme).origin;
  } catch {
    throw new Error(
      `[config] NEXT_PUBLIC_APP_URL is not a valid URL: "${raw}". Use e.g. https://your-app.vercel.app`,
    );
  }
  if (
    process.env.NODE_ENV === "production" &&
    typeof window === "undefined" &&
    new URL(origin).hostname === "localhost"
  ) {
    // Fires on Vercel too — a localhost app URL there ships wrong canonical/OG
    // URLs. (A local `next build` is fine; it just won't be crawled.)
    console.warn(
      "[config] appUrl resolved to localhost in a production build — set NEXT_PUBLIC_APP_URL to your deployed URL.",
    );
  }
  return origin;
}

export const config = {
  mode: (process.env.RANKFORGE_MODE as RuntimeMode) ?? "mock",
  // Absolute site origin used for metadataBase, canonicals, sitemap, robots
  // and JSON-LD. Prefer the explicit env var; fall back to the Vercel
  // production host so absolute URLs are correct on deploy even if the var
  // is missing; finally localhost for dev. Never ship localhost to crawlers.
  appUrl: resolveAppUrl(),

  github: {
    clientId: process.env.GITHUB_CLIENT_ID,
    clientSecret: process.env.GITHUB_CLIENT_SECRET,
    appId: process.env.GITHUB_APP_ID,
    privateKey: process.env.GITHUB_APP_PRIVATE_KEY,
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
  },

  llm: {
    anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  },
} as const;

export const isLive = config.mode === "live";
export const isMock = config.mode === "mock";

/** True only when live mode AND the required GitHub credentials exist. */
export const canUseLiveGitHub =
  isLive && Boolean(config.github.appId && config.github.privateKey);
