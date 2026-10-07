#!/usr/bin/env bash
# Re-copy the SAI Cloud sign-in client library from the sai-cluster checkout into this repo.
#
#   scripts/sync-auth-client.sh [path-to-sai-cluster-checkout]
#
# The Stories image is built from THIS repo and cannot import sai-cluster's manifests/_auth-client, so the one
# zero-dependency file is vendored (server/vendor/sai-auth-client/index.cjs, CommonJS because server/ is ESM).
# The vendored file is the source byte for byte, under a header that records the commit it came from; its own unit
# tests (lib.test.js, no network) ride along as sai-auth-client.lib.test.cjs. Nothing is fetched from the network.
# server/portalAuth/tests/vendor-drift.test.js fails if the copy drifts from a sai-cluster checkout.
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
src="${1:-${SAI_CLUSTER_DIR:-$here/../sai-cluster}}"
lib="$src/manifests/_auth-client"
[ -f "$lib/index.js" ] || { echo "no $lib/index.js - pass the path of a sai-cluster checkout (or set SAI_CLUSTER_DIR)" >&2; exit 2; }

commit="$(git -C "$src" log -1 --format=%H -- manifests/_auth-client/index.js manifests/_auth-client/tests/lib.test.js 2>/dev/null || true)"
[ -n "$commit" ] || commit="unknown (not a git checkout)"
out="$here/server/vendor/sai-auth-client"
mkdir -p "$out"

marker='//--- BEGIN VENDORED SOURCE: everything below this line is byte-identical to the original file ---'

{
  cat <<HDR
/*
 * VENDORED COPY - do not edit here. Re-copy with scripts/sync-auth-client.sh.
 *
 * What:     SAI Cloud sign-in client (OpenID Connect code flow + PKCE), zero dependencies.
 * Source:   Solutions-AI-LTD/sai-cluster  manifests/_auth-client/index.js
 * Commit:   $commit
 * Licence:  proprietary, (c) Solutions AI Ltd - first-party code, vendored into another first-party repo under the same
 *           ownership. The source repo carries no separate licence file; this notice is the record.
 * Why:      the Stories image is built from its own repo and cannot import sai-cluster's manifests.
 */
$marker
HDR
  cat "$lib/index.js"
} > "$out/index.cjs"

# its network-free unit tests, with the require path pointed at the vendored name
{
  echo "// VENDORED from sai-cluster manifests/_auth-client/tests/lib.test.js @ $commit (require path rewritten). Re-copy with scripts/sync-auth-client.sh."
  sed "s#require('../index.js')#require('./index.cjs')#" "$lib/tests/lib.test.js"
} > "$out/sai-auth-client.lib.test.cjs"

echo "vendored _auth-client @ $commit -> ${out#$here/}"
