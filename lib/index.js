import z from "@deepseek-ai/schemastery";
import { WebError } from "@deepseek-ai/dsh-web";

//#region provider
/**
 * CRW search through its Firecrawl-compatible `POST /v1/search` endpoint.
 * CRW returns normalized result items (`url`/`title`/`description`/`snippet`,
 * optional `publishedDate`) inside `{ success, data: { results, answer? } }`,
 * where `results` is a flat array (no `sources` requested) or a grouped
 * `{ web, news, images }` object. The wire format and native `fetch` client
 * are provider-private and do not use `ctx.llm`.
 * @module dsh-web-search-crw/provider
 */
/** Stable id this provider registers under (`ctx.web.searchProvider: crw`). */
export const CRW_PROVIDER_ID = "crw";
/** Default CRW server base (the compose `crw` service publishes 3000). */
export const CRW_DEFAULT_BASE_URL = "http://localhost:3000";
/** Result-count fallback when the caller passes no `maxResults`. */
export const CRW_DEFAULT_LIMIT = 5;
/**
 * Per-search deadline default. One Camofox Google SERP leg measured ~45 s cold
 * (engines run sequentially on one warm tab), so the previous 30 s default
 * aborted real searches. This budget is nested inside the host tool layer's
 * `tool-web.searchTimeoutMs`, which bounds the same call first — raise that one
 * too or the host aborts at 30 s regardless of this value.
 */
export const CRW_DEFAULT_TIMEOUT_MS = 60000;
/** Per-wrapper deadline when resolving a Google click-redirect destination. */
export const CRW_DEFAULT_RESOLVE_TIMEOUT_MS = 4000;
/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = "dsh-web-search-crw/0.1.0";

/**
 * Normalize one CRW search result item into the portable citation shape.
 * `snippet` falls back to `description` (CRW emits both; the Firecrawl
 * convention is that they carry the same excerpt). Empty and whitespace-only
 * rows are dropped — a blank `url` would reach the model as an uncitable
 * citation that `web_fetch` can only fail on.
 * @param item - one entry of `data.results` (flat) or `data.results.web`.
 * @returns the source, or `undefined` when the row is not citable.
 */
function toSource(item) {
  if (item == null) return undefined;
  const url = pickText(item.url);
  if (url === undefined) return undefined;
  const snippet = pickText(item.snippet) ?? pickText(item.description);
  const title = pickText(item.title);
  const publishedAt = pickText(item.publishedDate) ?? pickText(item.published_date);
  return {
    url,
    ...(title !== undefined ? { title } : {}),
    ...(snippet !== undefined ? { snippet } : {}),
    ...(publishedAt !== undefined ? { publishedAt } : {}),
  };
}

/** Trim a provider-supplied string field; `undefined` for empty/absent. */
function pickText(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** Extract the citable rows from either results shape (flat array or grouped). */
function resultRows(data) {
  const results = data?.results;
  if (Array.isArray(results)) return results;
  if (results !== null && typeof results === "object") {
    if (Array.isArray(results.web)) return results.web;
    if (Array.isArray(results.news)) return results.news;
  }
  return [];
}

/**
 * Google's SERP wraps organic anchors in click-redirect paths rather than
 * emitting the destination, so a raw scrape yields `url` values the harness
 * fetch client cannot use (it deliberately refuses cross-origin redirects).
 * `/url` carries the destination; `/goto` (the current shape) and `/aclk`
 * carry an opaque token; `/imgurl` is the image-search variant.
 */
const WRAPPER_PATHS = ["/url", "/goto", "/aclk", "/imgurl"];

/** How many wrapper destinations to resolve at once. */
const RESOLVE_CONCURRENCY = 4;

/** True for a `*.google.*` host (google.com, google.co.uk, google.com.hk, …). */
function isGoogleWrapperHost(hostname) {
  return /^(?:www\.)?google\.[a-z0-9.]+$/i.test(hostname);
}

/**
 * Classify one result URL against Google's click-redirect wrappers. Two shapes
 * exist: `/url?q=<percent-encoded destination>`, decodable offline, and
 * `/goto?url=<opaque token>`, whose payload is NOT the destination — the token
 * base64-decodes to opaque protobuf bytes, so the real URL only exists in the
 * redirect's `Location`. Non-wrapper URLs yield `undefined` and pass through
 * untouched.
 * @param rawUrl - the `url` CRW returned for one result row.
 * @returns `{ kind: "direct", url }` when decodable now, `{ kind: "remote", url }`
 * when the wrapper must be followed, else `undefined`.
 */
function classifyRedirectWrapper(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
  if (!isGoogleWrapperHost(parsed.hostname)) return undefined;
  const path = parsed.pathname.replace(/\/+$/, "").toLowerCase();
  if (!WRAPPER_PATHS.some((wrapper) => path === wrapper || path.endsWith(wrapper))) return undefined;
  const embedded = parsed.searchParams.get("q") ?? parsed.searchParams.get("url") ?? parsed.searchParams.get("imgurl");
  if (embedded === null || embedded.length === 0) return undefined;
  if (/^https?:\/\//i.test(embedded) && URL.canParse(embedded)) return { kind: "direct", url: embedded };
  return { kind: "remote", url: parsed.toString() };
}

/**
 * Validate a candidate destination recovered from a wrapper: http(s) only, and
 * not another wrapper (a second hop is not followed).
 * @param candidate - a raw `Location` or meta-refresh value, possibly relative.
 * @param baseUrl - the wrapper URL, used to resolve relative targets.
 * @returns the absolute destination, or `undefined` when it is unusable.
 */
function toSafeDestination(candidate, baseUrl) {
  let parsed;
  try {
    parsed = new URL(candidate, baseUrl);
  } catch {
    return undefined;
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return undefined;
  if (classifyRedirectWrapper(parsed.toString()) !== undefined) return undefined;
  return parsed.toString();
}

/**
 * Follow one wrapper to its destination, reading `Location` under
 * `redirect: "manual"` and falling back to a `<meta http-equiv="refresh">`
 * target, which some `/goto` responses serve instead of a 3xx. Every failure
 * path returns `undefined` so an unresolvable row keeps its original URL
 * instead of losing the result.
 * @param wrapperUrl - the absolute wrapper URL of a `kind: "remote"` row.
 * @param timeoutMs - per-wrapper deadline.
 * @returns the destination URL, or `undefined` when not resolvable.
 */
async function resolveWrapperDestination(wrapperUrl, timeoutMs) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`CRW wrapper resolve exceeded ${timeoutMs}ms`)), timeoutMs);
  try {
    const response = await fetch(wrapperUrl, {
      method: "GET",
      redirect: "manual",
      headers: { accept: "*/*", "user-agent": USER_AGENT },
      signal: ctrl.signal,
    });
    const location = response.headers.get("location");
    if (location !== null && location.length > 0) {
      const direct = toSafeDestination(location, wrapperUrl);
      if (direct !== undefined) return direct;
    }
    if (!response.ok) return undefined;
    const body = (await response.text()).slice(0, 65536);
    const meta = body.match(/http-equiv\s*=\s*["']?refresh["']?[^>]*?url=([^"'\s>]+)/i)?.[1];
    return meta !== undefined ? toSafeDestination(meta, wrapperUrl) : undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** Dedupe key: no fragment, no trailing slash, host lowercased. */
function dedupeKey(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  parsed.hash = "";
  return parsed.toString().replace(/\/$/, "");
}

/**
 * Unwrap Google click-redirects across sources, then drop rows that collapse
 * onto the same destination (keeping the best-ranked one). Runs AFTER the SERP
 * returned, so a cancellation arriving mid-resolution stops starting new
 * resolutions and still yields the results already in hand — with their
 * original URLs — rather than discarding a completed search.
 * @param sources - normalized sources, in CRW's ranking order.
 * @param options - resolved config (unwrap switch + per-wrapper deadline).
 * @param signal - the caller's cancellation, polled between resolutions.
 * @returns the sources with destinations substituted, same order minus dupes.
 */
async function unwrapSourceUrls(sources, options, signal) {
  const pending = [];
  for (const [index, source] of sources.entries()) {
    if (options.resolveRedirects !== true) break;
    const wrapper = classifyRedirectWrapper(source.url);
    if (wrapper !== undefined) pending.push({ index, wrapper });
  }
  const destinations = new Map();
  let cursor = 0;
  async function worker() {
    while (cursor < pending.length) {
      if (signal?.aborted === true) return;
      const job = pending[cursor++];
      if (job.wrapper.kind === "direct") {
        destinations.set(job.index, job.wrapper.url);
        continue;
      }
      const destination = await resolveWrapperDestination(job.wrapper.url, options.resolveTimeoutMs);
      if (destination !== undefined) destinations.set(job.index, destination);
    }
  }
  await Promise.all(Array.from({ length: Math.min(RESOLVE_CONCURRENCY, pending.length) }, () => worker()));
  const out = [];
  const seen = new Set();
  for (const [index, source] of sources.entries()) {
    const url = destinations.get(index) ?? source.url;
    const key = dedupeKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(url === source.url ? source : { ...source, url });
  }
  return out;
}

/**
 * The CRW-backed search provider. Redirects and transport failures surface as
 * `WEB_PROVIDER_ERROR` naming the endpoint, with recovery guidance pointing at
 * this plugin's Settings section.
 */
export class CrwSearchProvider {
  /**
   * @param resolveOptions - the options for the NEXT operation, snapshotted
   * once at each operation's entry so one search never mixes two config sections.
   */
  constructor(resolveOptions) {
    this.resolveOptions = resolveOptions;
  }
  id = CRW_PROVIDER_ID;
  available() {
    const options = this.resolveOptions();
    return URL.canParse(options.baseURL) && /^https?:/i.test(options.baseURL);
  }
  async search(request, signal) {
    const options = this.resolveOptions();
    throwIfSearchAborted(signal);
    const endpoint = `${options.baseURL.replace(/\/+$/, "")}/v1/search`;
    const limit = Math.max(1, request.maxResults ?? options.limit);
    const headers = {
      "content-type": "application/json",
      accept: "application/json",
      "user-agent": USER_AGENT,
    };
    if (options.apiKey !== undefined && options.apiKey.length > 0) {
      headers.authorization = `Bearer ${options.apiKey}`;
    }
    const merged = linkSignal(signal, options.timeoutMs);
    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        redirect: "error",
        headers,
        body: JSON.stringify({ query: request.query, limit }),
        signal: merged,
      });
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
      if (merged.aborted) {
        throw new WebError(`CRW search timed out after ${options.timeoutMs}ms against ${JSON.stringify(endpoint)}`, "WEB_PROVIDER_ERROR", { cause: error });
      }
      throw searchEndpointError(endpoint, `CRW search request failed: ${String(error)}`, error);
    }
    if (!response.ok) {
      let message = `CRW API error (HTTP ${response.status})`;
      try {
        const parsed = await response.json();
        const detail = typeof parsed.error === "string" ? parsed.error : parsed.message;
        if (detail !== undefined && detail.length > 0) message += `: ${detail}`;
      } catch {
        // body-less error statuses keep the generic message
      }
      if (response.status === 401) {
        message += ' — the CRW server has API keys configured. Set "apiKey" in the web-search-crw config (or the CRW_SEARCH_API_KEY environment variable) to one of its server keys.';
      }
      throw searchEndpointError(endpoint, message);
    }
    let payload;
    try {
      payload = await response.json();
    } catch (error) {
      if (signal?.aborted === true || isAbortError(error)) throw searchAborted(signal, error);
      throw searchEndpointError(endpoint, `CRW returned an unprocessable response body: ${String(error)}`, error);
    }
    if (payload?.success !== true) {
      throw searchEndpointError(endpoint, typeof payload?.error === "string" && payload.error.length > 0 ? `CRW search failed: ${payload.error}` : "CRW search reported success=false without an error message");
    }
    const data = payload.data ?? {};
    const sources = [];
    for (const row of resultRows(data)) {
      const source = toSource(row);
      if (source !== undefined) sources.push(source);
    }
    const answer = pickText(data.answer);
    return {
      ...(answer !== undefined ? { content: answer } : {}),
      sources: await unwrapSourceUrls(sources, options, merged),
      // The seam owns final maxResults truncation, so it is always false here.
      truncated: false,
    };
  }
}

/** Add endpoint recovery instructions to failures that occur after dispatch. */
function searchEndpointError(endpoint, message, cause) {
  return new WebError(
    `${message}\n\nThe web search request used endpoint ${JSON.stringify(endpoint)}. If that endpoint is not intended, make sure the CRW compose stack is up (docker compose ps) or change Endpoint in Settings > Plugins > Plugin configuration > Web search (CRW), or set CRW_SEARCH_BASE_URL / web-search-crw.baseURL. Only the user should choose or change the endpoint.`,
    "WEB_PROVIDER_ERROR",
    cause === undefined ? undefined : { cause },
  );
}

/**
 * Link the caller's cancellation with a provider-side timeout.
 * `AbortSignal.timeout` is deliberate: its timer is unref'd, so a search that
 * finished normally leaves no live handle behind. The previous hand-rolled
 * `setTimeout` was never cleared, which kept a (timeoutMs) handle — 60-90 s by
 * default — pinned on the event loop after every search, and left a dangling
 * listener on the caller's signal.
 */
function linkSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (signal === undefined) return timeout;
  return AbortSignal.any([signal, timeout]);
}

/** Throw the provider's stable cancellation error when the caller already aborted. */
function throwIfSearchAborted(signal) {
  if (signal?.aborted === true) throw searchAborted(signal);
}

/** Build the provider's stable cancellation error while retaining the caller's reason. */
function searchAborted(signal, fallback) {
  return new WebError("CRW search aborted", "WEB_ABORTED", { cause: signal?.aborted === true ? signal.reason : fallback });
}

/** True for a fetch/`AbortSignal` abort, surfaced as `WEB_ABORTED`. */
function isAbortError(error) {
  return error instanceof DOMException && error.name === "AbortError";
}
//#endregion

//#region plugin
/**
 * Register a CRW-backed search provider in `ctx.web`. The model-facing
 * `web_search` tool keeps working unchanged; selection is pinned by
 * `web.searchProvider: crw` in the profile's cordis.patch.yml.
 * @module dsh-web-search-crw
 */
/** Cordis plugin name used by loader diagnostics. */
export const name = "web-search-crw";
/** The web seam this provider registers into. */
export const inject = ["web"];
/** Environment variable naming this provider's endpoint and optional key. */
const SEARCH_BASE_URL_ENV = "CRW_SEARCH_BASE_URL";
const SEARCH_API_KEY_ENV = "CRW_SEARCH_API_KEY";
/** Settings namespace carrying this provider's endpoint and key reference. */
export const WEB_SEARCH_CRW_SETTINGS_NAMESPACE = "web-search-crw";

export const Config = z.object({
  /** CRW server base URL; `/v1/search` is appended. */
  baseURL: z.string().default(CRW_DEFAULT_BASE_URL),
  /** Optional bearer key, only needed when the CRW server has API keys configured. */
  apiKey: z.string().role("secret"),
  /** Result-count fallback when the tool passes no `maxResults`. */
  limit: z.number().step(1).min(1).max(50).default(CRW_DEFAULT_LIMIT),
  /** Per-search timeout; the tool layer bounds it separately. */
  timeoutMs: z.number().step(1).min(1000).default(CRW_DEFAULT_TIMEOUT_MS),
  /**
   * Unwrap Google's click-redirect wrappers (`/url?q=`, `/goto?url=`) into the
   * real destination. The harness fetch client refuses cross-origin redirects by
   * design, so an unwrapped link is the difference between a citable source and
   * an extra resolve round trip per result. Set false to pass CRW's URLs through
   * verbatim.
   */
  resolveRedirects: z.boolean().default(true),
  /** Deadline for one wrapper's destination lookup; a miss keeps its original URL. */
  resolveTimeoutMs: z.number().step(1).min(250).default(CRW_DEFAULT_RESOLVE_TIMEOUT_MS),
});

/**
 * Project one resolved config section into the options the provider serves its
 * next search with. Environment fallbacks stay here rather than in the
 * provider: every value the provider reads is already fully defaulted.
 * @param config - the currently authoritative section.
 * @returns options for one search.
 */
function resolveOptions(config) {
  return {
    baseURL: config.baseURL ?? globalThis.process?.env?.[SEARCH_BASE_URL_ENV] ?? CRW_DEFAULT_BASE_URL,
    apiKey: config.apiKey ?? globalThis.process?.env?.[SEARCH_API_KEY_ENV],
    limit: config.limit ?? CRW_DEFAULT_LIMIT,
    timeoutMs: config.timeoutMs ?? CRW_DEFAULT_TIMEOUT_MS,
    resolveRedirects: config.resolveRedirects ?? true,
    resolveTimeoutMs: config.resolveTimeoutMs ?? CRW_DEFAULT_RESOLVE_TIMEOUT_MS,
  };
}

/** Register the CRW search provider with `ctx.web`. */
export function apply(ctx, config) {
  let current = () => config;
  ctx.inject(["settings"], (settingsCtx) => {
    settingsCtx.settings.installSection(ctx, WEB_SEARCH_CRW_SETTINGS_NAMESPACE, Config, config, {
      setSource: (source) => {
        current = source;
      },
      onChange: () => {},
    });
  });
  ctx.web.registerSearchProvider(new CrwSearchProvider(() => resolveOptions(current())));
}
//#endregion
