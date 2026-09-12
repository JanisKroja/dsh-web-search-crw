# dsh-web-search-crw

Self-hosted web search for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (dsh):
a `WebSearchProvider` plugin for the harness web seam (`ctx.web`) that points
the model-facing `web_search` tool at **your own**
[CRW](https://github.com/adambenhassen/crw-camofox)-compatible
([Firecrawl](https://github.com/firecrawl/firecrawl)-compatible) server instead
of a hosted search API. Single package — no companion plugins, no harness fork,
no build step. It is a client: a running backend is required, see
[Requirements](#requirements).

It registers one `WebSearchProvider` (id `crw`) into the harness web seam
(`ctx.web`) via the official provider convention — `inject: ["web"]` +
`ctx.settings.installSection` + `ctx.web.registerSearchProvider` — mirroring
the structure of the stock `@deepseek-ai/dsh-web-search-deepseek` plugin.
No stock harness code is modified; selection happens purely through the seam's
documented `searchProvider` config.

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
  `docker compose up -d` (publishes the server on `localhost:3000`).
- **Any [Firecrawl](https://github.com/firecrawl/firecrawl)-compatible**
  implementation of the search endpoint — self-hosted or hosted. Consult the
  [Firecrawl search API reference](https://docs.firecrawl.dev/api-reference/endpoint/search);
  note that hosted Firecrawl also requires a real API key (set `apiKey` or
  `CRW_SEARCH_API_KEY` below).

Other requirements:

- dsh web profile, Node ≥ 22.19 (same floor as dsh itself)
- No API key needed while the server runs without configured keys (the default
  for local compose stacks). Once the server has API keys configured, set
  `apiKey` (or `CRW_SEARCH_API_KEY`) to one of them — the plugin then sends
  `Authorization: Bearer <key>`.

## Install

```sh
# from this repo
npm run install:dsh      # = bash scripts/install-to-dsh.sh
```

The script copies the package into `$DSH_HOME/profiles/node_modules/dsh-web-search-crw`
— the harness's shared module-resolution anchor (see `@deepseek-ai/dsh-app-boot`
profile docs). A **copy** is required, not a symlink: Node resolves through a
symlink's realpath, so a linked plugin would resolve its `@deepseek-ai/*` bare
imports by walking up from this repo instead of the harness's hoisted closure.

Then register the provider in your profile patch (`$DSH_HOME/profiles/web/cordis.patch.yml`):

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
        baseURL: http://localhost:3000
        limit: 5
        timeoutMs: 55000
```

A `web` row patch replaces the whole config, so `fetchProvider` must be restated.
The `web` profile hot-reloads this file (`patchReload: live`) — no restart needed.

To switch back to the stock provider, set `searchProvider: deepseek-official`.

## Configuration

Settings namespace `web-search-crw` (also editable live under
**Settings → Plugins → Plugin configuration → Web search (CRW)**):

| Key | Default | Meaning |
|---|---|---|
| `baseURL` | `http://localhost:3000` | CRW base; `/v1/search` is appended. Env fallback: `CRW_SEARCH_BASE_URL` |
| `apiKey` | — | Optional bearer key. Env fallback: `CRW_SEARCH_API_KEY` |
| `limit` | `5` | Result-count fallback when the tool passes no `maxResults` |
| `timeoutMs` | `30000` | Per-search deadline; keep below the tool layer's `searchTimeoutMs` |

## Development

Two install modes:

```sh
npm run install:dsh            # copy — deploy-safe (default)
npm run install:dsh -- --link  # symlink — local dev, live-edit
```

**Copy mode** puts the package physically under
`$DSH_HOME/profiles/node_modules/dsh-web-search-crw`, so its bare
`@deepseek-ai/*` imports resolve through Node's parent-walk to the harness's
hoisted closure. Re-run after editing `lib/index.js`; the web profile
hot-reloads `cordis.patch.yml` (`patchReload: live`) — touch that file to
force a reload — or restart `dsh web`.

**`--link` mode** replaces the copy with a symlink into this repo (edit →
reload, no reinstall). Because Node resolves through a symlink's realpath, a
naive symlink would resolve the plugin's bare host imports from *this repo* —
so the script additionally links `@deepseek-ai/dsh-web` and
`@deepseek-ai/schemastery` into `node_modules/` here, pointing at the same
realpaths the running harness loaded (Node dedupes by realpath, preserving
class/service identity — never `npm install` your own copies of host
packages; a shadowing second copy breaks Cordis service identity). Switch
back any time with plain copy mode. If this repo moves or dsh is reinstalled,
re-run the script to repair the links.

## License

MIT
