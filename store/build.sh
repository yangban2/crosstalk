#!/usr/bin/env bash
# Package Crosstalk for Chrome Web Store upload.
# Produces dist/crosstalk-<version>.zip containing only the files the extension
# needs at runtime — dev assets (tests, demo, store, docs, git) are excluded.
set -euo pipefail

cd "$(dirname "$0")/.."   # repo root

VERSION=$(node -e "process.stdout.write(require('./manifest.json').version)")
OUT="dist/crosstalk-${VERSION}.zip"

rm -rf dist
mkdir -p dist

# Whitelist what ships. Add new runtime paths here, not a blacklist.
zip -r "$OUT" \
  manifest.json \
  src \
  icons \
  -x '*.DS_Store' -x 'icons/*.svg' >/dev/null

echo "Built $OUT"
echo "Contents:"
unzip -l "$OUT" | awk 'NR>3 {print "  " $4}' | sed '/^  $/d'
echo
echo "Reminder: bump \"version\" in manifest.json before each store upload."
