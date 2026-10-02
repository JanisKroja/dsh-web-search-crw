#!/usr/bin/env bash
# Install/update dsh-web-search-crw into a DSH 0.2 profile.
#
# 0.2 PROFILE LAYOUT: a profile at $DSH_HOME/profiles/<profile>/ is its own pnpm
# project (package.json + pnpm-workspace.yaml + node_modules). The supported
# install route is the dsh CLI, which runs pnpm inside the profile:
#
#   dsh plugin --profile <profile> add file:<this repo>
#
# That adds "dsh-web-search-crw": "file:<repo>" to the profile's package.json
# and materializes the package under
#   $DSH_HOME/profiles/<profile>/node_modules/dsh-web-search-crw/
# as a real directory (a package-manager copy) — that copy, not this repo, is
# what the harness imports. Re-sync after edits by re-running this script (or
# `pnpm install --force` inside the profile dir).
#
# HOST PACKAGE IDENTITY: @deepseek-ai/dsh-web and @deepseek-ai/cordis are
# peerDependencies only. dsh-app-boot's resolution interception routes a
# profile-installed plugin's bare imports of those to the SAME installation
# copies the harness loaded — one class identity per host class (WebError, the
# service tokens). Never `npm install` private copies of host packages in this
# repo. @deepseek-ai/schemastery is a plain dependency: the profile's hoisted
# copy is the supported pattern for schema data (the same way the shipped
# dsh-chrome-mcp plugin takes it).
#
# RESTART SEMANTICS (0.2):
#   - the FIRST install (a new entry row + new code): restart `dsh <profile>`;
#     cordis imports plugin modules once at startup, and the entry must exist.
#   - afterwards, config edits apply LIVE: the GUI's Configure page (or any
#     change to a volatile field in cordis.patch.yml) is committed into the
#     running fiber's volatile config refs — no restart, no re-registration.
#   - lib/*.js changes: re-run this script, then restart `dsh <profile>`.
#
# The script also repairs this repo's node_modules/@deepseek-ai/* symlinks so
# the offline verify scripts (`node scripts/verify-normalize.mjs`,
# `node scripts/verify-unwrap.mjs`) can import the host packages' realpaths
# from inside the repo — the runtime mirror of the interception above.
#
# Usage:
#   bash scripts/install-to-dsh.sh                  # profile: web
#   bash scripts/install-to-dsh.sh --profile NAME
#   npm run install:dsh -- --profile NAME
#
# Env: DSH_HOME overrides the harness home (default ~/.dsh).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DSH_HOME_RESOLVED="${DSH_HOME:-$HOME/.dsh}"
PKG="dsh-web-search-crw"
MARKER="CRW_DEFAULT_BASE_URL"
profile="web"

usage() {
  sed -n '2,44p' "$0" | sed 's/^# \{0,1\}//'
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --profile)
      if [[ -z "${2:-}" ]]; then
        echo "error: --profile needs a profile name (e.g. --profile web)." >&2
        exit 2
      fi
      profile="$2"
      shift 2
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      echo "usage: $0 [--profile NAME]" >&2
      exit 2
      ;;
  esac
done

PROFILE_DIR="$DSH_HOME_RESOLVED/profiles/$profile"
[[ -d "$PROFILE_DIR" ]] || { echo "error: no profile at $PROFILE_DIR — boot it once first (dsh $profile)." >&2; exit 1; }

echo "==> dsh plugin --profile $profile add file:$REPO"
(cd "$PROFILE_DIR" && dsh plugin --profile "$profile" add "file:$REPO")

# file: copies are content-tracked; force re-materialization so lib edits land.
DST="$PROFILE_DIR/node_modules/$PKG"
if [[ -e "$DST/lib/index.js" ]] && ! diff -rq "$REPO/lib" "$DST/lib" >/dev/null 2>&1; then
  echo "==> profile copy differs; refreshing with pnpm install --force"
  (cd "$PROFILE_DIR" && pnpm install --force)
fi

[[ -e "$DST/lib/index.js" ]] || { echo "error: $DST/lib/index.js missing after install." >&2; exit 1; }
grep -q "$MARKER" "$DST/lib/index.js" || { echo "error: synced $DST/lib/index.js does not contain $MARKER — restore from git." >&2; exit 1; }
[[ -e "$DST/lib/client.js" ]] || { echo "error: $DST/lib/client.js missing — the GUI settings page would not load." >&2; exit 1; }
[[ "$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).version)' "$DST/package.json")" == "$(node -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).version)' "$REPO/package.json")" ]] \
  || { echo "warning: $DST/package.json version differs from the repo's; run: (cd $PROFILE_DIR && pnpm install --force)" >&2; }
echo "installed: $DST"

# --- Dev convenience: bare host imports for the offline verify scripts. --------
# Mirror what the runtime interception gives the installed copy: dsh-web from
# the running dsh installation, schemastery from the profile's hoisted closure.
GLOBAL_ROOT="$(npm root -g 2>/dev/null || true)"
DSH_WEB_SRC="$GLOBAL_ROOT/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-web"
SCHEMASTRY_SRC="$PROFILE_DIR/node_modules/@deepseek-ai/schemastery"
mkdir -p "$REPO/node_modules/@deepseek-ai"
if [[ -e "$DSH_WEB_SRC/package.json" ]]; then
  ln -sfn "$DSH_WEB_SRC" "$REPO/node_modules/@deepseek-ai/dsh-web"
else
  echo "warning: @deepseek-ai/dsh-web not found under $GLOBAL_ROOT — verify scripts may fail to import." >&2
fi
if [[ -e "$SCHEMASTRY_SRC/package.json" ]]; then
  ln -sfn "$SCHEMASTRY_SRC" "$REPO/node_modules/@deepseek-ai/schemastery"
else
  echo "warning: @deepseek-ai/schemastery not found in $PROFILE_DIR — verify scripts may fail to import." >&2
fi
echo "dev imports wired: @deepseek-ai/dsh-web, @deepseek-ai/schemastery"

echo
echo "done."
echo "  First install of this entry: restart 'dsh $profile' (new entry + new code)."
echo "  After that: GUI edits (Plugins > $PKG > web-search-crw row > Configure) and any"
echo "  volatile-field change in $PROFILE_DIR/cordis.patch.yml apply LIVE — no restart."
echo "  lib/*.js changes: re-run this script, then restart 'dsh $profile'."
