/**
 * Pure, host-independent result normalization for the CRW search provider:
 * row → citation, Google SERP chrome-title detection, and URL-derived
 * fallback titles. No `@deepseek-ai/*` imports, so it is unit-testable
 * offline (`node scripts/verify-normalize.mjs`) without the harness loaded.
 * @module dsh-web-search-crw/normalize
 */

/**
 * Engine ids the Camofox search backend accepts (crw `SearchEngine`). Sent as
 * `engines` when the `engines` config is non-empty; the server's own default
 * (google only) applies otherwise. `github` is the only non-browser engine
 * (REST API); the browser engines run sequentially, so N engines ≈ N× latency.
 */
export const CRW_ENGINES = ["google", "bing", "duckduckgo", "wikipedia", "youtube", "reddit", "amazon", "github"];
/** Server-side cap on `engines` (crw rejects more than 4). */
export const CRW_MAX_ENGINES = 4;
/** Server-side cap on `categories` (crw rejects more than 5). */
export const CRW_MAX_CATEGORIES = 5;
/** The `sources` groups crw's grouped-results mode can return. */
export const CRW_SOURCES = ["web", "news", "images"];

/**
 * Case-insensitive regex sources for titles that are Google SERP UI chrome
 * rather than the page title. Needed because the Camofox backend scrapes the
 * SERP in the exit-IP locale (the `lang` param is SearXNG-only) and its
 * extractor can pick a neighboring section heading — e.g. the AI-mode teaser's
 * `MI režīma atbilde:` ("AI Mode answer:") landing on an organic row. Extend
 * via the `junkTitlePatterns` config; entries starting with `^` or ending with
 * `$` only match when they cover (nearly) the whole title, so write an
 * unanchored pattern for containment matching.
 */
export const CRW_JUNK_TITLE_PATTERNS = [
  "ai\\s*mode\\s*(answer|answered|replied|reply|response|overview|summary)\\b",
  "mi\\s+režīma\\s+atbilde\\b",
  "^people\\s+also\\s+ask\\b",
  "^related\\s+searches\\b",
  "^gaismklātie\\s+jautājumi\\b",
  "^saistītie\\s+meklē",
];

/** Compile the built-in + operator junk-title regexes. Bad patterns are skipped. */
export function compileJunkPatterns(custom) {
  const out = [];
  for (const source of [...CRW_JUNK_TITLE_PATTERNS, ...(Array.isArray(custom) ? custom : [])]) {
    if (typeof source !== "string" || source.length === 0) continue;
    try {
      out.push(new RegExp(source, "i"));
    } catch {
      // an invalid operator pattern must never break a search
    }
  }
  return out;
}

/**
 * For an anchored chrome-heading match, the leftover text beyond the heading
 * must be at most this many word characters for the title to count as chrome:
 * "People also ask: Blender LTS?" is a heading + first question (chrome);
 * "People also ask: a long documentary-style title ..." is a real page title.
 */
const JUNK_TAIL_MAX = 40;

/** True when the title is (only) Google SERP UI chrome rather than a page title. */
export function isJunkTitle(title, patterns) {
  for (const re of patterns ?? []) {
    const m = title.match(re);
    if (m === null) continue;
    // Anchored patterns must cover (nearly) the whole title, or leave only a
    // short tail — "People also ask: <first question>" is chrome; a real page
    // title merely starting with those words is not. Unanchored entries match
    // as substrings by design.
    const anchored = re.source.startsWith("^") || re.source.endsWith("$") || re.source.startsWith("(?:^");
    if (!anchored) return true;
    const rest = title.slice(0, m.index) + title.slice(m.index + m[0].length);
    if (rest.replace(/[\s:;,.\-–—·|»"'()\[\]?]+/g, "").length <= JUNK_TAIL_MAX) return true;
  }
  return false;
}

const GIT_HOSTS = ["github.com", "gitlab.com", "bitbucket.org", "gitea.com", "try.gitea.io"];

/** Path segments that are routing scaffolding, not content — never a title. */
const GENERIC_SEGMENTS = new Set(["index", "home", "main", "page", "post", "p", "item", "items", "view", "detail", "details", "story", "watch", "read", "s", "wp"]);

/**
 * Build a usable title from the URL when the scraped one is empty or SERP
 * chrome. Repos get `org/repo`; article slugs get the humanized final segment
 * (`godot-4-5-release` → `godot 4 5 release`); anything else falls back to the
 * host. Pure offline — no fetch.
 */
export function deriveTitleFromUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return undefined;
  }
  const host = parsed.hostname.replace(/^www\./i, "");
  const segments = parsed.pathname.split("/").filter((s) => s.length > 0);
  if (GIT_HOSTS.includes(host) && segments.length >= 2) {
    return `${segments[0]}/${segments[1]}`.replace(/\.(git|tree|blob|releases|actions)$/i, "");
  }
  // Walk from the last segment backwards, skipping routing scaffolding
  // (`/item?id=…`, `/page/3`, bare ids), and take the first segment that
  // reads as a title.
  for (let i = segments.length - 1; i >= 0; i--) {
    const human = decodeURIComponent(segments[i])
      .replace(/\.(html?|php|aspx?|jsp|md|rst)$/i, "")
      .replace(/[-_+]+/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (human.length < 3) continue;
    if (GENERIC_SEGMENTS.has(human.toLowerCase())) continue;
    // Reject opaque ids (pure digits/hashes/base64-ish tokens) — opaque text
    // does not read as a title.
    if (/^[\d\s._#-]+$/.test(human) || /^[0-9a-f]{8,}$/i.test(human) || /^[0-9a-z]{20,}$/i.test(human)) continue;
    return human;
  }
  return host;
}

/** Trim a provider-supplied string field; `undefined` for empty/absent. */
export function pickText(value) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

/** De-dupe, filter against an allow-list, and cap — for pass-through arrays. */
export function sanitizeList(value, allowed, max) {
  if (!Array.isArray(value)) return [];
  const seen = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const lower = entry.trim().toLowerCase();
    if (lower.length === 0 || !allowed.includes(lower) || seen.includes(lower)) continue;
    seen.push(lower);
    if (seen.length >= max) break;
  }
  return seen;
}

/** Filter free-form category strings: trim, drop empties/dupes, cap by max. */
export function sanitizeCategories(value, max = CRW_MAX_CATEGORIES) {
  if (!Array.isArray(value)) return [];
  const seen = [];
  for (const entry of value) {
    if (typeof entry !== "string") continue;
    const trimmed = entry.trim().toLowerCase();
    if (trimmed.length === 0 || seen.includes(trimmed)) continue;
    seen.push(trimmed);
    if (seen.length >= max) break;
  }
  return seen;
}

/**
 * Normalize one CRW search result item into the portable citation shape.
 * `snippet` falls back to `description` (CRW emits both; the Firecrawl
 * convention is that they carry the same excerpt). Empty and whitespace-only
 * rows are dropped — a blank `url` would reach the model as an uncitable
 * citation that `web_fetch` can only fail on. A title that is empty or Google
 * SERP UI chrome (see `isJunkTitle`) is replaced with a URL-derived title.
 * @param item - one entry of `data.results` (flat) or `data.results.web`.
 * @param junkPatterns - compiled junk-title regexes for this search.
 * @returns the source, or `undefined` when the row is not citable.
 */
export function toSource(item, junkPatterns) {
  if (item == null) return undefined;
  const url = pickText(item.url);
  if (url === undefined) return undefined;
  const snippet = pickText(item.snippet) ?? pickText(item.description);
  let title = pickText(item.title);
  if (title !== undefined && isJunkTitle(title, junkPatterns)) title = undefined;
  if (title === undefined) title = deriveTitleFromUrl(url);
  const publishedAt = pickText(item.publishedDate) ?? pickText(item.published_date);
  return {
    url,
    ...(title !== undefined ? { title } : {}),
    ...(snippet !== undefined ? { snippet } : {}),
    ...(publishedAt !== undefined ? { publishedAt } : {}),
  };
}

/** Extract the citable rows from either results shape (flat array or grouped). */
export function resultRows(data) {
  const results = data?.results;
  if (Array.isArray(results)) return results;
  if (results !== null && typeof results === "object") {
    // Grouped mode (`sources` requested): concatenate the groups in web →
    // news → images order, each already server-ranked.
    const groups = [];
    for (const key of ["web", "news", "images"]) {
      if (Array.isArray(results[key])) groups.push(...results[key]);
    }
    if (groups.length > 0) return groups;
  }
  return [];
}
