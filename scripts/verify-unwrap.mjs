// Verify the Google click-redirect unwrap in lib/index.js.
//
//   node scripts/verify-unwrap.mjs            # offline: stubbed fetch, no network
//   node scripts/verify-unwrap.mjs --live     # against the real CRW server
//   node scripts/verify-unwrap.mjs --live "my query"
//
// Exits 1 on any failed assertion or (in --live) on any leaked wrapper URL.
import { CrwSearchProvider } from "../lib/index.js";

const argv = process.argv.slice(2);
const live = argv.includes("--live");
const query = argv.find((a) => !a.startsWith("--")) ?? "Blender 4.5 LTS release date";

const WRAPPER = /google\.[a-z0-9.]+\/(goto|url|aclk|imgurl)/i;

/** Options for one provider under test. */
function options(overrides) {
  return {
    baseURL: process.env.CRW_SEARCH_BASE_URL ?? "http://localhost:3000",
    apiKey: process.env.CRW_SEARCH_API_KEY,
    limit: 8,
    timeoutMs: 90000,
    resolveRedirects: true,
    resolveTimeoutMs: 1500,
    ...overrides,
  };
}

const DEST_TOKEN = "https://www.blender.org/download/releases/4-5/";
const DEST_DUP = "https://godotengine.org/article/godot-4-5/";
const DEST_META = "https://meta.example.com/go";
const PLAIN = "https://example.com/plain";
const NON_WRAPPER_GOOGLE = "https://www.google.com/search?q=blender";

/** CRW-shaped payload covering every unwrap path, in ranking order. */
const payload = {
  success: true,
  data: {
    answer: "Blender 4.5 LTS shipped July 15, 2025.",
    results: [
      { url: "https://www.google.com/goto?url=CAES_TOKEN", title: "Releases", description: "d1" },
      { url: "https://www.google.com/url?q=https%3A%2F%2Fwww.blender.org%2Fdownload%2Freleases%2F4-5%2F&ved=0abc", title: "4.5 LTS", snippet: "s2" },
      { url: "https://www.google.com/goto?url=CAES_DUP", title: "Godot 4.5", description: "d3" },
      { url: PLAIN, title: "Plain", description: "d4" },
      { url: "https://www.google.com/goto?url=CAES_SLOW", title: "Slow", description: "d5" },
      { url: "https://www.google.com/goto?url=CAES_META", title: "Meta", description: "d6" },
      { url: "https://www.google.com/goto?url=CAES_LOOP", title: "Loop", description: "d7" },
      { url: NON_WRAPPER_GOOGLE, title: "SERP", description: "d8" },
      { url: "   ", title: "Empty", description: "d9" },
    ],
  },
};

/** Stub upstream: /v1/search returns `payload`, wrappers answer as Google would. */
function installFakeFetch() {
  globalThis.fetch = async (url, init) => {
    const href = String(url);
    if (init?.method === "POST" && href.endsWith("/v1/search")) {
      return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
    }
    if (href.includes("CAES_SLOW")) {
      // Honour the abort signal so the per-wrapper deadline actually fires.
      return new Promise((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted by timer")));
      });
    }
    if (href.includes("CAES_TOKEN")) return new Response(null, { status: 302, headers: { location: DEST_TOKEN } });
    if (href.includes("CAES_DUP")) return new Response(null, { status: 302, headers: { location: DEST_DUP } });
    if (href.includes("CAES_LOOP")) {
      return new Response(null, { status: 302, headers: { location: "https://www.google.com/goto?url=CAES_TOKEN2" } });
    }
    if (href.includes("CAES_META")) {
      return new Response(`<!doctype html><html><head><meta http-equiv="refresh" content="0;url=${DEST_META}"></head>`, { status: 200 });
    }
    return new Response("nope", { status: 404 });
  };
}

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`${ok ? "ok  " : "FAIL"}  ${label}\n        actual   ${actual}\n      ${ok ? "" : "expected " + expected}`.replace(/\n\s+$/, ""));
}

const provider = new CrwSearchProvider(options);

if (!live) {
  installFakeFetch();
  const t0 = Date.now();
  const result = await provider.search({ query: "unused", maxResults: 8 });
  console.log(`offline run finished in ${Date.now() - t0}ms (resolveTimeoutMs=1500)\n`);

  check("answer surfaced as content", result.content, "Blender 4.5 LTS shipped July 15, 2025.");
  // 9 rows - 1 collapsed dupe - 1 empty-url row = 7
  check("dupe collapsed and empty row dropped", result.sources.length, 7);
  // row1 (goto→Location) and row3 (goto→Location) survive; row2 collapses into row1.
  check("row1 /goto resolved to destination", result.sources[0].url, DEST_TOKEN);
  check("row2 /url?q= dupe collapsed", result.sources[1].url, DEST_DUP);
  check("plain URL untouched", result.sources[2].url, PLAIN);
  check("unresolvable row keeps its wrapper", result.sources[3].url, "https://www.google.com/goto?url=CAES_SLOW");
  check("meta-refresh fallback", result.sources[4].url, DEST_META);
  check("second-hop wrapper rejected, original kept", result.sources[5].url, "https://www.google.com/goto?url=CAES_LOOP");
  check("google.com/search not treated as a wrapper", result.sources[6].url, NON_WRAPPER_GOOGLE);
  check("title preserved through unwrap", result.sources[0].title, "Releases");
  check("snippet fallback description->snippet kept", result.sources[1].description ?? result.sources[1].snippet, "d3");

  const off = await new CrwSearchProvider(() => options({ resolveRedirects: false })).search({ query: "unused", maxResults: 8 });
  check("resolveRedirects:false leaves every URL verbatim", off.sources.length, 8);
  check("resolveRedirects:false leaves the wrapper in place", off.sources[0].url, "https://www.google.com/goto?url=CAES_TOKEN");
} else {
  const t0 = Date.now();
  const result = await provider.search({ query, maxResults: 8 });
  console.log(`live query=${JSON.stringify(query)} in ${Date.now() - t0}ms, ${result.sources.length} sources, answer=${result.content === undefined ? "(none)" : "yes"}\n`);
  for (const [index, source] of result.sources.entries()) {
    console.log(`${WRAPPER.test(source.url) ? "WRAPPED" : "ok     "} ${index + 1}. ${source.url}`);
    if (source.title !== undefined) console.log(`           ${source.title}`);
  }
  const leaks = result.sources.filter((source) => WRAPPER.test(source.url)).length;
  console.log(`\nwrapper leaks: ${leaks}/${result.sources.length}`);
  if (leaks > 0) failures += 1;
}

if (failures > 0) {
  console.error(`\n${failures} check(s) failed`);
  process.exit(1);
}
console.log("\nall checks passed");
