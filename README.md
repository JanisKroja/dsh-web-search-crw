# dsh-web-search-crw

Self-hosted web search for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh):
a `WebSearchProvider` plugin for the harness web seam (`ctx.web`) that points
the model-facing `web_search` tool at **your own**
[CRW](https://github.com/adambenhassen/crw-camofox)-compatible
([Firecrawl](https://github.com/firecrawl/firecrawl)-compatible) server instead
of a hosted search API. Single package — no companion plugin package, no
harness fork, no build step. It is a client: a running backend is required, see
[Requirements](#requirements).

It registers one `WebSearchProvider` (id `crw`) into the harness web seam
(`ctx.web`) via the official provider convention — `inject: ["web"]` +
`ctx.web.registerSearchProvider` — mirroring the structure of the stock
`@deepseek-ai/dsh-web-search-deepseek` plugin. No stock harness code is
modified; selection happens purely through the seam's documented
`searchProvider` config.

**Requires dsh ≥ 0.2** (`dsh -V`). On 0.2 the plugin also ships a browser half
(`lib/client.js`, declared via `dsh.client` in `package.json`) that mounts the
**auto-generated settings page** described under
[Configuration](#configuration) — still with no build step.

## What it calls

```
POST {baseURL}/v1/search   {"query": "...", "limit": N}
```

and normalizes the Firecrawl-shaped response — `{success, data: {results, answer?}}`,
where `results` is a flat array or a grouped `{web, news, images}` object — into
the seam's `sources[]` (`snippet || description`, `publishedDate → publishedAt`,
`data.answer → content`). Transport failures map to `WEB_PROVIDER_ERROR` (with
endpoint recovery hints), caller cancellation to `WEB_ABORTED`.

## Requirements

**You need a running CRW/Firecrawl-compatible search server — this plugin ships
no search backend of its own; it is a client.** Concretely, it requires a
server that implements `POST /v1/search` with the Firecrawl v1 search contract
(see [What it calls](#what-it-calls) for the exact request/response shapes
accepted).

Recommended backends:

- **[CRW](https://github.com/adambenhassen/crw-camofox)** — the reference
  backend this plugin was built for. A Rust, Firecrawl-compatible
  search/scrape/crawl server whose `/v1/search` drives Google through
  **[camofox-browser](https://github.com/redf0x1/camofox-browser)**, a REST
  wrapper around the **[Camoufox](https://github.com/daijro/camoufox)**
  anti-detect Firefox fork. The quick start is the repo's compose stack:
  `docker compose up -d` (publishes the server on port 3000 — on the same
  machine that is `http://localhost:3000`, on a LAN box
  `http://<server-ip>:3000`).
- **Any [Firecrawl](https://github.com/firecrawl/firecrawl)-compatible**
  implementation of the search endpoint — self-hosted or hosted. Consult the
  [Firecrawl search API reference](https://docs.firecrawl.dev/api-reference/endpoint/search);
  note that hosted Firecrawl also requires a real API key (set `apiKey` or
  `CRW_SEARCH_API_KEY` below).

Other requirements:

- dsh ≥ 0.2 web profile, Node ≥ 22.19 (same floor as dsh itself)
- No API key needed while the server runs without configured keys (the default
  for local compose stacks). Once the server has API keys configured, set
  `apiKey` (or `CRW_SEARCH_API_KEY`) to one of them — the plugin then sends
  `Authorization: Bearer <key>`.

## Install

```sh
# from this repo
npm run install:dsh                  # = bash scripts/install-to-dsh.sh (profile: web)
npm run install:dsh -- --profile NAME
```

The script wraps the supported 0.2 route — `dsh plugin --profile <name> add
file:<repo>` — which runs pnpm inside the profile project
(`$DSH_HOME/profiles/<profile>/`) and materializes the package under
`$DSH_HOME/profiles/<profile>/node_modules/dsh-web-search-crw/`. That
package-manager copy, not this repo, is what the harness imports; re-run the
script (or `pnpm install --force` in the profile dir) to re-sync after edits.
`@deepseek-ai/dsh-web` and `@deepseek-ai/cordis` stay peers: dsh-app-boot's
resolution interception routes the installed plugin's imports of them to the
harness's own copies, so there is never a second `WebError` class identity.
Never `npm install` private copies of host packages in this repo.

Then register the provider in your profile patch
(`$DSH_HOME/profiles/<profile>/cordis.patch.yml`):

```yaml
- id: web
  name: '@deepseek-ai/dsh-web'
  config:
    searchProvider: crw
    fetchProvider: http

- insert:
    - id: web-search-crw
      name: dsh-web-search-crw
      config:
        baseURL: http://<your-crw-server>:3000
```

A `web` row patch replaces the whole config, so `fetchProvider` must be
restated. The row `id` below must stay `web-search-crw` — the settings
namespace and the GUI page bind to it. First boot of a new entry needs a
`dsh web` restart; everything after that is live, see
[Reload vs restart](#reload-vs-restart).

To switch back to the stock provider, set `searchProvider: deepseek-official`.

## Configuration

Settings namespace `web-search-crw`. On dsh 0.2 the harness derives this
entry's settings form directly from the plugin's exported `Config` schema —
**every field the plugin declares is `.volatile()`, so the whole table below
is editable live** under

**Plugins page → dsh-web-search-crw → the `web-search-crw` row → Configure**

— one control per field, generated from the live schema (types, order,
descriptions; `apiKey` renders as a write-only secret field — its literal
never crosses the wire). Saving writes through the profile patch and commits
into the running process; no restart. This is the intended place to point
`baseURL` at your remote CRW server's IP and port. The values also live in
`cordis.patch.yml` under the `web-search-crw` row's `config:` and may be
edited by hand.

| Key | Default | Meaning |
|---|---|---|
| `baseURL` | env `CRW_SEARCH_BASE_URL`, else `http://localhost:3000` | CRW server base — remote IP and port; `/v1/search` is appended |
| `apiKey` | — | Optional bearer key. Stored outside the settings file (secret role). Env fallback: `CRW_SEARCH_API_KEY` |
| `limit` | `5` | Result-count fallback when the tool passes no `maxResults` |
| `timeoutMs` | `60000` | Per-search deadline. One Camofox Google SERP leg measures ~45 s cold, so the old `30000` default aborted real searches |
| `resolveRedirects` | `true` | Unwrap Google's click-redirect wrappers (`/url?q=`, `/goto?url=`, `/aclk`, `/imgurl`) into the real destination |
| `resolveTimeoutMs` | `4000` | Per-wrapper deadline; a row that cannot be resolved keeps its original URL rather than being dropped |
| `engines` | `[]` | Which Camofox engines to query: any of `google`, `bing`, `duckduckgo`, `wikipedia`, `youtube`, `reddit`, `amazon`, `github` (max 4, deduped). Results merge and dedupe by URL — a URL found by several engines ranks higher. Browser engines run sequentially on the warm tab, so N engines ≈ N× latency: raise `timeoutMs` (and `tool-web.searchTimeoutMs`) with it. Empty = server default (google only) |
| `categories` | `[]` | CRW category filters: curated `github`, `research`, `pdf`, or any native SearXNG category passed through (max 5) |
| `sources` | `[]` | Result groups to request: `web`, `news`, `images`. CRW returns them grouped; the plugin concatenates web → news → images. Empty = server default (flat web) |
| `junkTitlePatterns` | `[]` | Extra case-insensitive regexes treated as Google SERP UI chrome and replaced with a URL-derived title; added to the built-in en/lv list (AI-mode / People-also-ask / Related-searches headings). Invalid patterns are skipped |

### Title sanitization

The Camofox backend scrapes the Google SERP in the **exit-IP locale** (the
`lang` request param is honored by the SearXNG backend only), and its
extractor occasionally grabs a localized section heading instead of the link
text — e.g. `MI režīma atbilde:` ("AI Mode answer:") on an organic row. The
provider matches titles against the junk-title patterns and substitutes a
URL-derived title (`org/repo` for git hosts, humanized final path segment,
host fallback), so the model never cites a SERP-ui string as a page title.

`timeoutMs` is nested inside the host tool layer's own budget,
`tool-web.searchTimeoutMs` (default `30000`), which bounds the same
`web_search` call first. Raise both together — a provider deadline of 60 s behind
a 30 s host deadline still aborts at 30 s.

Why `resolveRedirects` exists: Google's SERP anchors point at
`google.com/goto?url=<opaque token>`, not at the destination, and the token
base64-decodes to opaque protobuf bytes — the target URL only exists in the
redirect's `Location`. The harness fetch client refuses cross-origin redirects by
design (an SSRF guard), so an unwrapped link is the difference between a citable
source and an extra resolve round trip per result. Turn it off only if CRW itself
starts returning clean URLs.

## How the 0.2 settings plumbing works

- **Host half** (`lib/index.js`): the harness's `@deepseek-ai/dsh-settings`
  service reads the plugin's exported `Config` schema from the live Loader
  entry — no `installSection` call exists anymore — and projects the
  **`.volatile()` fields** into an editable form (`volatileForm`). A config
  change touching only volatile fields is committed straight into the running
  fiber's volatile refs; `apply()` reads every field through `.get()` per
  search, so the next `web_search` uses the new endpoint with no restart.
- **Browser half** (`lib/client.js`, `dsh.client` in `package.json`): the host
  serves it through the client-module graph. It registers the Plugins page's
  keyed `plugins.row.config` cell (`dsh-web-search-crw#web-search-crw`)
  while the Host serves the `web-search-crw` namespace, and **generates the
  form from the live schema** the Host publishes: a control per field
  (text / number / checkbox / one-per-line textarea), secret fields write-only
  with a configured badge, descriptions as hints, saves as revision-fenced
  mutate ops. Adding a new volatile field to `Config` makes it appear in the
  GUI with no client change.

## Development

Two verify scripts (offline; the install script wires `node_modules/@deepseek-ai/*`
symlinks to the harness's own realpaths so their host imports resolve):

```sh
node scripts/verify-normalize.mjs   # offline unit assertions on lib/normalize.js (titles, sanitizing, row shapes)
node scripts/verify-unwrap.mjs      # offline assertions on the redirect unwrap
node scripts/verify-unwrap.mjs --live   # against the real CRW server; exits 1 on any leaked wrapper URL
```

## Reload vs restart

| Changed | Takes effect |
|---|---|
| Any config field (GUI Configure page, or `config:` of the `web-search-crw` / `web` rows in `cordis.patch.yml`) | live, no restart |
| First install of the entry (new `insert:` row) | after restarting `dsh web` |
| `lib/*.js` (any code change, including `lib/client.js`) | re-run `npm run install:dsh`, then restart `dsh web` |

## License

MIT
