#!/usr/bin/env bash
# Install/update dsh-web-search-crw into a DSH profile's module anchor.
#
# Copy (default): places the package physically under
# $DSH_HOME/profiles/node_modules/dsh-web-search-crw — the harness's shared
# module-resolution anchor (see @deepseek-ai/dsh-app-boot profile docs:
# "$DSH_HOME/profiles/node_modules supplies the installation dependency
# closure"). A copy — not a symlink — is the safe default because Node resolves
# through a symlink's realpath: a linked plugin would resolve its bare
# @deepseek-ai/schemastery / @deepseek-ai/dsh-web imports by walking up from
# this repo (where they do not exist) instead of the harness's hoisted closure.
#
# Dev mode (--link): replaces the copy with a symlink into this repo, so edits
# under lib/ are picked up on the next patch reload without reinstalling. To
# keep the linked plugin's bare host imports resolving to the RUNNING harness's
# own module instances (same realpath => same Node cache entry => same class
# identity for WebError/Service tokens — a private second copy of @deepseek-ai/*
# would silently break those), this mode also links the two host packages this
# plugin imports into the repo's node_modules from the profile anchor.
#
# Re-run after editing lib/index.js; the web profile hot-reloads
# cordis.patch.yml (patchReload: live), otherwise restart `dsh web`.
#
# Usage:
#   bash scripts/install-to-dsh.sh          # copy (deploy-safe)
#   bash scripts/install-to-dsh.sh --link   # symlink (local dev)
#   npm run install:dsh -- --link           # same, via npm
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DSH_HOME_RESOLVED="${DSH_HOME:-$HOME/.dsh}"
DST="$DSH_HOME_RESOLVED/profiles/node_modules/dsh-web-search-crw"
HOST_MODULES="$DSH_HOME_RESOLVED/profiles/node_modules"
HOST_PKGS=(dsh-web schemastery)

mode="${1:-}"

if [[ "$mode" == "--link" ]]; then
  for pkg in "${HOST_PKGS[@]}"; do
    if [[ ! -e "$HOST_MODULES/@deepseek-ai/$pkg" ]]; then
      echo "error: host package @deepseek-ai/$pkg not found under $HOST_MODULES/@deepseek-ai/." >&2
      echo "       Start 'dsh web' once (it refreshes the profile module anchor), or set DSH_HOME." >&2
      exit 1
    fi
  done
  # rm on a symlink removes the link itself (contents of the target are safe).
  rm -rf "$DST"
  ln -s "$REPO" "$DST"
  mkdir -p "$REPO/node_modules/@deepseek-ai"
  for pkg in "${HOST_PKGS[@]}"; do
    ln -sfn "$HOST_MODULES/@deepseek-ai/$pkg" "$REPO/node_modules/@deepseek-ai/$pkg"
  done
  echo "linked (dev): $REPO -> $DST"
  echo "host imports wired to the harness's own instances: ${HOST_PKGS[*]}"
  echo "note: if the repo moves or dsh is reinstalled, re-run this script (or plain copy mode)."
elif [[ -n "$mode" ]]; then
  echo "usage: $0 [--link]" >&2
  exit 2
else
  rm -rf "$DST"          # removes the directory — or a stale --link symlink, without following it
  mkdir -p "$DST"
  cp "$REPO/package.json" "$DST/package.json"
  cp -R "$REPO/lib" "$DST/lib"
  echo "installed (copy): $REPO -> $DST"
fi
