/**
 * Core Web Vitals from real Chrome users, via Google's Chrome UX Report (CrUX)
 * API: p75 over the last 28 days. Free, but it needs a Google Cloud API key
 * (Chrome UX Report API enabled). Opt-in only: it sends the audited URL to
 * Google, and Septune otherwise never calls a third party.
 *
 * The PageSpeed Insights API is deliberately not used: it has no keyless
 * quota left and Google is removing CrUX field data from it.
 *
 * Low-traffic sites have no CrUX data. That is reported as such, never as a
 * score: an invented number would be worse than none.
 */

export type VitalsRating = "good" | "needs-improvement" | "poor";

export interface VitalsMetric {
  /** p75 value: milliseconds, except CLS (unitless). */
  p75: number;
  rating: VitalsRating;
}

export interface VitalsReport {
  /** Data for this exact URL, or the whole origin when the URL has too few visits. */
  scope: "url" | "origin";
  key: string;
  formFactor: "PHONE" | "DESKTOP" | "ALL";
  period: { first: string; last: string } | null;
  lcp?: VitalsMetric;
  inp?: VitalsMetric;
  cls?: VitalsMetric;
  fcp?: VitalsMetric;
  ttfb?: VitalsMetric;
}

export type VitalsResult =
  | { ok: true; report: VitalsReport }
  | { ok: false; reason: "no-key" | "no-data" | "error"; message: string };

/** Google's good / poor boundaries (web.dev). */
const THRESHOLDS: Record<string, [number, number]> = {
  largest_contentful_paint: [2500, 4000],
  interaction_to_next_paint: [200, 500],
  cumulative_layout_shift: [0.1, 0.25],
  first_contentful_paint: [1800, 3000],
  experimental_time_to_first_byte: [800, 1800],
};

const FIELD: Record<string, keyof Pick<VitalsReport, "lcp" | "inp" | "cls" | "fcp" | "ttfb">> = {
  largest_contentful_paint: "lcp",
  interaction_to_next_paint: "inp",
  cumulative_layout_shift: "cls",
  first_contentful_paint: "fcp",
  experimental_time_to_first_byte: "ttfb",
};

export function rate(metric: string, p75: number): VitalsRating {
  const [good, poor] = THRESHOLDS[metric] ?? [Infinity, Infinity];
  return p75 <= good ? "good" : p75 <= poor ? "needs-improvement" : "poor";
}

const ENDPOINT = "https://chromeuxreport.googleapis.com/v1/records:queryRecord";

async function query(
  body: Record<string, unknown>,
  apiKey: string,
): Promise<{ status: number; json: Record<string, unknown> | null }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    const res = await fetch(`${ENDPOINT}?key=${encodeURIComponent(apiKey)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

/** p75 field data for `url`, falling back to its origin. */
export async function fetchVitals(
  url: string,
  apiKey: string | undefined,
  opts?: { formFactor?: "PHONE" | "DESKTOP" },
): Promise<VitalsResult> {
  if (!apiKey) {
    return {
      ok: false,
      reason: "no-key",
      message:
        "Core Web Vitals need a free Google API key: enable the Chrome UX Report API in Google Cloud and set CRUX_API_KEY.",
    };
  }
  let origin: string;
  try {
    origin = new URL(url).origin;
  } catch {
    return { ok: false, reason: "error", message: "Not a valid URL." };
  }
  const metrics = Object.keys(THRESHOLDS);
  const formFactor = opts?.formFactor;
  try {
    for (const [scope, target] of [
      ["url", { url }],
      ["origin", { origin }],
    ] as const) {
      const { status, json } = await query({ ...target, ...(formFactor ? { formFactor } : {}), metrics }, apiKey);
      if (status === 404) continue; // not enough Chrome traffic at this level
      if (status !== 200 || !json) {
        const msg = (json?.error as { message?: string } | undefined)?.message ?? `HTTP ${status}`;
        return { ok: false, reason: "error", message: `CrUX API error: ${msg}` };
      }
      const record = json.record as
        | { metrics?: Record<string, { percentiles?: { p75?: number | string } }>; collectionPeriod?: Record<string, { year: number; month: number; day: number }> }
        | undefined;
      const report: VitalsReport = {
        scope,
        key: scope === "url" ? url : origin,
        formFactor: formFactor ?? "ALL",
        period: null,
      };
      const cp = record?.collectionPeriod;
      if (cp?.firstDate && cp?.lastDate) {
        const d = (x: { year: number; month: number; day: number }) =>
          `${x.year}-${String(x.month).padStart(2, "0")}-${String(x.day).padStart(2, "0")}`;
        report.period = { first: d(cp.firstDate), last: d(cp.lastDate) };
      }
      for (const [metric, field] of Object.entries(FIELD)) {
        const raw = record?.metrics?.[metric]?.percentiles?.p75;
        const p75 = typeof raw === "string" ? parseFloat(raw) : raw; // CLS p75 arrives as a string
        if (typeof p75 === "number" && Number.isFinite(p75)) report[field] = { p75, rating: rate(metric, p75) };
      }
      return { ok: true, report };
    }
    return {
      ok: false,
      reason: "no-data",
      message: "Google has no Chrome UX data for this site yet: it needs enough real Chrome visits over 28 days.",
    };
  } catch {
    return { ok: false, reason: "error", message: "The CrUX API could not be reached." };
  }
}

export function formatVital(field: "lcp" | "inp" | "cls" | "fcp" | "ttfb", m: VitalsMetric): string {
  const value = field === "cls" ? m.p75.toFixed(2) : m.p75 >= 1000 ? `${(m.p75 / 1000).toFixed(1)} s` : `${Math.round(m.p75)} ms`;
  return `${field.toUpperCase()} ${value} (${m.rating.replace("-", " ")})`;
}
