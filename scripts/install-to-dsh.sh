#!/usr/bin/env bash
# Install/update dsh-web-search-crw into a DSH profile's module anchor.
#
# The package is consumed as a plain copy under $DSH_HOME/profiles/node_modules/,
# which DSH resolves through Node's ordinary parent-walk (see @deepseek-ai/dsh-app-boot
# profile docs: "$DSH_HOME/profiles/node_modules supplies the installation
# dependency closure"). A copy — not a symlink — is required so the plugin's bare
# imports of @deepseek-ai/schemastery and @deepseek-ai/dsh-web resolve to the
# harness instances hoisted at that anchor instead of walking up from this repo.
#
# Re-run after editing lib/index.js; the web profile hot-reloads cordis.patch.yml
# (patchReload: live), otherwise restart `dsh web`.
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
DST="${DSH_HOME:-$HOME/.dsh}/profiles/node_modules/dsh-web-search-crw"

rm -rf "$DST"
mkdir -p "$DST"
cp "$REPO/package.json" "$DST/package.json"
cp -R "$REPO/lib" "$DST/lib"
echo "installed $REPO -> $DST"
