#!/usr/bin/env bash
# Bench: names WHICH test file writes into the tweakcc config home.
#
# The live ~/.tweakcc is never the subject of the search. Each file runs
# against a fresh COPY of a config home, handed to the suite through
# TWEAKCC_TEST_CONFIG_DIR (src/tests/setup/pinConfigHome.ts refuses a target
# that resolves inside a home in use), and the live config file is md5-guarded
# around every run and restored byte-for-byte the moment it moves.
#
# Redirecting with HOME instead would measure nothing once the suite pins its
# own throwaway home: writes would land in the pin, not in the copy.
#
# Usage: scripts/find-live-home-writer.sh [test-file ...]
#        (no args: every *.test.ts / *.test.tsx under src/)

set -u

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO" || exit 6

WORK="${W78_WORK:-${TMPDIR:-/tmp}/w78-writer-hunt}"
SNAP="$WORK/pristine-tweakcc"
COPY="$WORK/config-home-copy"
LOGS="$WORK/logs"
LIVE="$HOME/.tweakcc/config.json"
LIVE_SNAP="$WORK/live-config.json.snapshot"

mkdir -p "$WORK" "$LOGS" || exit 6

# Pristine template of a config home, plus an untouched copy of the live file
# used only as the restore source if a run moves the live home.
if [ ! -d "$SNAP" ]; then
  cp -Rp "$HOME/.tweakcc" "$SNAP" || exit 6
fi
[ -f "$LIVE_SNAP" ] || cp -p "$LIVE" "$LIVE_SNAP" || exit 6

if [ "$#" -gt 0 ]; then
  FILES="$*"
else
  FILES="$(find src -name '*.test.ts' -o -name '*.test.tsx' | sort)"
fi

printf '%-52s %-6s %-9s %-9s\n' FILE EXIT COPY LIVE

for f in $FILES; do
  rm -rf "$COPY"
  cp -Rp "$SNAP" "$COPY" || exit 6

  copy_before="$(md5 -q "$COPY/config.json")"
  live_before="$(md5 -q "$LIVE")"

  log="$LOGS/$(echo "$f" | tr '/' '_').log"
  TWEAKCC_TEST_CONFIG_DIR="$COPY" npx vitest run "$f" >"$log" 2>&1
  code=$?

  copy_after="$(md5 -q "$COPY/config.json")"
  live_after="$(md5 -q "$LIVE")"

  copy_verdict=UNCHANGED
  [ "$copy_before" != "$copy_after" ] && copy_verdict=WRITTEN
  live_verdict=UNCHANGED
  if [ "$live_before" != "$live_after" ]; then
    live_verdict=WRITTEN
    cp -p "$LIVE_SNAP" "$LIVE" || exit 6
  fi

  printf '%-52s %-6s %-9s %-9s\n' "$f" "$code" "$copy_verdict" "$live_verdict"
done

rm -rf "$COPY"
