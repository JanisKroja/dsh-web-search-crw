// Verify the pure normalization in lib/normalize.js — offline, no network,
// no harness (lib/normalize.js has no @deepseek-ai/* imports).
//
//   node scripts/verify-normalize.mjs
//
// Exits 1 on any failed assertion.
import {
  compileJunkPatterns,
  deriveTitleFromUrl,
  isJunkTitle,
  resultRows,
  toSource,
} from "../lib/normalize.js";

let failures = 0;
function check(label, actual, expected) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a === e) {
    console.log(`ok   ${label}`);
  } else {
    console.error(`FAIL ${label}\n  expected: ${e}\n  actual:   ${a}`);
    failures++;
  }
}

const junk = compileJunkPatterns(["^custom\\s+junk\\b"]);

// --- junk-title detection ---------------------------------------------------
check("lv AI-mode heading is junk", isJunkTitle("MI režīma atbilde:", junk), true);
check("en AI-mode heading is junk", isJunkTitle("AI Mode answer", junk), true);
check("AI Mode Overview is junk", isJunkTitle("AI Mode Overview", junk), true);
check("People also ask (bare) is junk", isJunkTitle("People also ask", junk), true);
check("People also ask: topic is junk", isJunkTitle("People also ask: Blender LTS?", junk), true);
check("Related searches is junk", isJunkTitle("Related searches", junk), true);
check("custom pattern is honored", isJunkTitle("Custom Junk — skip me", junk), true);
check("invalid custom pattern is skipped, not fatal", Array.isArray(compileJunkPatterns(["[unclosed"])), true);

// A real title must NEVER be rewritten just because it merely contains/starts
// with similar words.
check("real title starting like chrome survives", isJunkTitle("People also ask: the documentary about search engines and privacy", junk), false);
check("real title about AI overviews survives", isJunkTitle("How Google's AI overviews change publishing in 2026", junk), false);
check("plain title survives", isJunkTitle("Blender 4.5 LTS release notes", junk), false);

// --- URL-derived titles -------------------------------------------------------
check("github repo → org/repo", deriveTitleFromUrl("https://github.com/deepseek-ai/deepseek-harness"), "deepseek-ai/deepseek-harness");
check("www stripped, slug humanized", deriveTitleFromUrl("https://godotengine.org/article/godot-4-5-release/"), "godot 4 5 release");
check("html extension stripped", deriveTitleFromUrl("https://example.com/docs/getting-started.html"), "getting started");
check("numeric id falls back to host", deriveTitleFromUrl("https://news.ycombinator.com/item?id=12345"), "news.ycombinator.com");
check("hash-like segment falls back to host", deriveTitleFromUrl("https://gist.github.com/1a2b3c4d5e6f7a8b"), "gist.github.com");
check("root page → host", deriveTitleFromUrl("https://example.com/"), "example.com");
check("percent-decoded slug", deriveTitleFromUrl("https://dev.to/user/hello%20world-2f1c"), "hello world 2f1c");

// --- row normalization ---------------------------------------------------------
check("junk title replaced by URL title",
  toSource({ url: "https://github.com/deepseek-ai/deepseek-harness", title: "MI režīma atbilde:", snippet: "" }, junk),
  { url: "https://github.com/deepseek-ai/deepseek-harness", title: "deepseek-ai/deepseek-harness" });
check("empty title gets URL title, snippet kept",
  toSource({ url: "https://note.com/a/b", title: "", description: "note description" }, junk),
  { url: "https://note.com/a/b", title: "note.com", snippet: "note description" });
check("good title untouched",
  toSource({ url: "https://x.dev/post", title: "Real Title", snippet: "s", publishedDate: "2026-01-01" }, junk),
  { url: "https://x.dev/post", title: "Real Title", snippet: "s", publishedAt: "2026-01-01" });
check("blank-url row dropped", toSource({ url: "  ", title: "T" }, junk), undefined);
check("null row dropped", toSource(null, junk), undefined);

// --- grouped results ------------------------------------------------------------
check("flat results pass through",
  resultRows({ results: [{ url: "https://a" }] }).length, 1);
check("grouped results concatenate web+news+images",
  resultRows({ results: { web: [{ url: "https://w1" }], news: [{ url: "https://n1" }], images: [{ url: "https://i1" }] } }).map(r => r.url),
  ["https://w1", "https://n1", "https://i1"]);
check("missing groups yield empty list", resultRows({ results: {} }).length, 0);

if (failures > 0) {
  console.error(`\n${failures} assertion(s) failed`);
  process.exit(1);
}
console.log("\nall normalize assertions passed");
