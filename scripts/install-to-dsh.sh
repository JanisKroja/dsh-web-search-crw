#!/usr/bin/env bash
# Install/update dsh-web-search-crw into a DSH profile.
#
# TWO PLACES MATTER, and only one of them is what the harness loads.
#
#   1. The shared module-resolution ANCHOR:
#        $DSH_HOME/profiles/node_modules/dsh-web-search-crw
#      (see @deepseek-ai/dsh-app-boot profile docs: "$DSH_HOME/profiles/node_modules
#      supplies the installation dependency closure"). This is where the original
#      version of this script wrote.
#
#   2. The PROFILE-LOCAL copy:
#        $DSH_HOME/profiles/<profile>/node_modules/dsh-web-search-crw
#      When the profile's package.json lists this plugin as a dependency (typically
#      "dsh-web-search-crw": "file:/path/to/this/repo"), the package manager
#      materializes it there — as a real directory of hardlinked files, not a
#      symlink into this repo.
#
# Node resolves the profile-local copy FIRST, so it SHADOWS the anchor. Writing only
# to the anchor — which is what copying and even --link mode used to do — left the
# running harness importing a stale profile-local copy: `lib/index.js` edits appeared
# to vanish, and restarting dsh re-loaded the same stale file. This script therefore
# installs the anchor AND syncs `lib/` into every profile-local copy it finds.
#
# RESTART REQUIRED for JS edits: `patchReload: live` (the web profile's setting)
# re-applies cordis.patch.yml CONFIG in the running process; nothing in cordis busts
# the plugin's module cache, so `lib/index.js` is imported once at startup. Config-only
# changes (baseURL, limit, timeoutMs, resolveRedirects) land live; code changes need
# `dsh web` restarted. The script says so when it changes a file.
#
# The pnpm-native alternative to syncing by hand is `pnpm install --force` inside the
# profile dir, which re-materializes a `file:` dependency from this repo. That also
# works, and pulls package.json changes too; it is heavier and needs the registry
# reachable for the profile's other dependencies.
#
# Usage:
#   bash scripts/install-to-dsh.sh                  # copy mode, all profiles
#   bash scripts/install-to-dsh.sh --link           # symlink the anchor (local dev)
#   bash scripts/install-to-dsh.sh --profile web    # restrict the sync to one profile
#   npm run install:dsh -- --link                   # same, via npm
#
# Env: DSH_HOME overrides the harness home (default ~/.dsh).
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DSH_HOME_RESOLVED="${DSH_HOME:-$HOME/.dsh}"
PKG="dsh-web-search-crw"
HOST_MODULES="$DSH_HOME_RESOLVED/profiles/node_modules"
DST="$HOST_MODULES/$PKG"
HOST_PKGS=(dsh-web schemastery)
# Sanity marker a correctly-installed lib/index.js must contain.
MARKER="CRW_DEFAULT_BASE_URL"

usage() {
  sed -n '2,40p' "$0" | sed 's/^# \{0,1\}//'
}

mode="copy"
profile=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --link)
      mode="link"
      shift
      ;;
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
      echo "usage: $0 [--link] [--profile NAME]" >&2
      exit 2
      ;;
  esac
done

if [[ "$mode" == "link" ]]; then
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
  # A linked plugin would otherwise resolve its bare @deepseek-ai/* imports by walking
  # up from this repo (where they do not exist). Linking the host packages this plugin
  # imports to the SAME realpaths the running harness loaded keeps one Node cache entry
  # per module — and so one class identity for WebError and the service tokens. A private
  # second copy of @deepseek-ai/* would silently break those. Never `npm install` your own
  # copies of host packages.
  mkdir -p "$REPO/node_modules/@deepseek-ai"
  for pkg in "${HOST_PKGS[@]}"; do
    ln -sfn "$HOST_MODULES/@deepseek-ai/$pkg" "$REPO/node_modules/@deepseek-ai/$pkg"
  done
  echo "linked (dev): $REPO -> $DST"
  echo "host imports wired to the harness's own instances: ${HOST_PKGS[*]}"
  echo "note: if the repo moves or dsh is reinstalled, re-run this script (or plain copy mode)."
else
  rm -rf "$DST"          # removes the directory — or a stale --link symlink, without following it
  mkdir -p "$DST"
  cp "$REPO/package.json" "$DST/package.json"
  cp -R "$REPO/lib" "$DST/lib"
  echo "installed (copy): $REPO -> $DST"
fi

# --- Sync the profile-local copies that actually shadow the anchor. -----------------
changed=0
found=0
for dir in "$DSH_HOME_RESOLVED"/profiles/*/node_modules/"$PKG"; do
  if [[ -n "$profile" ]]; then
    # dir = profiles/<name>/node_modules/<pkg>
    owner="$(basename "$(dirname "$(dirname "$dir")")")"
    [[ "$owner" == "$profile" ]] || continue
    if [[ ! -e "$dir" && ! -L "$dir" ]]; then
      echo "error: no profile-local copy at $dir (check --profile)." >&2
      exit 1
    fi
  fi
  [[ -e "$dir" || -L "$dir" ]] || continue
  found=$((found + 1))
  if [[ -L "$dir" ]]; then
    resolved="$(cd "$dir" 2>/dev/null && pwd || true)"
    if [[ "$resolved" == "$REPO" ]]; then
      echo "profile copy already resolves to this repo: $dir"
    else
      echo "warning: $dir is a symlink to '${resolved:-broken}' (not this repo) — left untouched." >&2
      echo "         If that is stale, remove it or run 'pnpm install --force' in the profile dir." >&2
    fi
    continue
  fi
  # Compare only the files THIS repo ships. The copy can hold extra operator files —
  # a saved lib/index.js.bak, for instance — which a directory-wide diff would report as
  # drift, and a `rm -rf lib` would then destroy. So: no wholesale delete here either.
  current=1
  while IFS= read -r -d '' src; do
    rel="${src#"$REPO"/}"
    diff -q "$src" "$dir/$rel" >/dev/null 2>&1 || current=0
  done < <(find "$REPO/lib" -type f -print0)
  if [[ "$current" -eq 1 ]]; then
    echo "profile copy already current: $dir"
    continue
  fi
  mkdir -p "$dir/lib"
  cp -R "$REPO/lib/." "$dir/lib/"
  if ! grep -q "$MARKER" "$dir/lib/index.js"; then
    echo "error: synced file at $dir/lib/index.js does not contain $MARKER — restore from git." >&2
    exit 1
  fi
  echo "synced profile copy: $dir"
  changed=1
done

if [[ "$found" -eq 0 ]]; then
  echo "note: no profile-local copy found under $DSH_HOME_RESOLVED/profiles/*/node_modules/$PKG;"
  echo "      the anchor at $DST is the one being resolved."
elif [[ "$changed" -eq 1 ]]; then
  echo
  echo "restart 'dsh web' to load the new lib/index.js."
  echo "  patchReload: live re-applies cordis.patch.yml config only — cordis does not bust"
  echo "  the plugin's module cache, so a running process keeps the copy it imported at startup."
  echo "  (Touching the patch file reloads CONFIG such as baseURL/limit/timeoutMs, not code.)"
else
  echo
  echo "nothing to sync: every resolvable copy already matches this repo's lib/."
fi
