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
/** Attribution header sent on every request. Bump with the package version. */
const USER_AGENT = "dsh-web-search-crw/0.1.0";

/**
 * Normalize one CRW search result item into the portable citation shape.
 * `snippet` falls back to `description` (CRW emits both; the Firecrawl
 * convention is that they carry the same excerpt). Empty rows are dropped.
 * @param item - one entry of `data.results` (flat) or `data.results.web`.
 * @returns the source, or `undefined` when the row is not citable.
 */
function toSource(item) {
  if (item == null || typeof item.url !== "string" || item.url.length === 0) return undefined;
  const snippet = pickText(item.snippet) ?? pickText(item.description);
  const title = pickText(item.title);
  const publishedAt = pickText(item.publishedDate) ?? pickText(item.published_date);
  return {
    url: item.url,
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
      sources,
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

/** Link the caller's cancellation with a provider-side timeout. */
function linkSignal(signal, timeoutMs) {
  const ctrl = new AbortController();
  if (signal !== undefined) {
    if (signal.aborted) return signal;
    const onAbort = () => ctrl.abort(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    ctrl.signal.addEventListener("abort", () => signal.removeEventListener("abort", onAbort), { once: true });
  }
  const timer = setTimeout(() => ctrl.abort(new Error(`CRW search exceeded ${timeoutMs}ms`)), timeoutMs);
  return ctrl.signal;
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
  timeoutMs: z.number().step(1).min(1000).default(30000),
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
    timeoutMs: config.timeoutMs ?? 30000,
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
