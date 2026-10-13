#!/bin/bash
# check-sai-cluster.sh <dir>: refuse unless <dir> is a CLEAN checkout of sai-cluster at origin/main.
# deploy.sh bakes the SAI Cloud switcher (manifests/_suite) from that checkout into the image: a feature
# branch, a stale main or uncommitted edits would ship a catalogue nobody reviewed.
# Fetches origin/main (read-only for the checkout: no checkout, merge or reset is ever run). Exit 0 = OK.
set -u
DIR="${1:-}"
fail() { echo "sai-cluster check: $*" >&2; exit 1; }
[ -n "$DIR" ] || fail "usage: check-sai-cluster.sh <sai-cluster checkout>"
[ -f "$DIR/manifests/_suite/build.js" ] || fail "$DIR has no manifests/_suite/build.js (not a sai-cluster checkout)"
git -C "$DIR" rev-parse --is-inside-work-tree >/dev/null 2>&1 || fail "$DIR is not a git checkout"
url=$(git -C "$DIR" remote get-url origin 2>/dev/null) || fail "$DIR has no origin remote"
case "$url" in
  *Solutions-AI-LTD/sai-cluster*|${SAI_CLUSTER_ORIGIN_OK:-__none__}) ;;
  *) fail "origin is $url, not Solutions-AI-LTD/sai-cluster" ;;
esac
git -C "$DIR" fetch -q origin main || fail "could not fetch origin/main"
head=$(git -C "$DIR" rev-parse HEAD) || fail "no HEAD"
main=$(git -C "$DIR" rev-parse origin/main) || fail "no origin/main"
[ "$head" = "$main" ] || fail "HEAD $(git -C "$DIR" rev-parse --short HEAD) is not origin/main $(git -C "$DIR" rev-parse --short origin/main): use a clean worktree (git -C <repo> worktree add --detach <dir> origin/main)"
dirty=$(git -C "$DIR" status --porcelain --untracked-files=all -- manifests/_suite) || fail "git status failed"
[ -z "$dirty" ] || fail "manifests/_suite has uncommitted or untracked changes:
$dirty"
dirty_all=$(git -C "$DIR" status --porcelain --untracked-files=no --ignore-submodules=all) || fail "git status failed"
[ -z "$dirty_all" ] || fail "the checkout has uncommitted changes:
$dirty_all"
echo "sai-cluster check: $DIR is clean at origin/main $(git -C "$DIR" rev-parse --short HEAD)"
