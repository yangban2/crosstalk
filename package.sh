#!/usr/bin/env bash
# Build a Chrome Web Store upload zip containing only the files the extension
# needs at runtime. Output: dist/crosstalk-<version>.zip
set -euo pipefail
cd "$(dirname "$0")"

VERSION=$(node -p "require('./manifest.json').version" 2>/dev/null \
  || grep -o '"version"[^,]*' manifest.json | grep -o '[0-9][0-9.]*')
OUT="dist/crosstalk-${VERSION}.zip"

mkdir -p dist
rm -f "$OUT"

# Drop any stray macOS metadata before packaging.
find icons src -name '.DS_Store' -delete 2>/dev/null || true

zip -r -X "$OUT" \
  manifest.json \
  icons \
  src \
  LICENSE \
  -x '*.DS_Store' >/dev/null

echo "Built $OUT"
unzip -l "$OUT"
