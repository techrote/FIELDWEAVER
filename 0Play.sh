#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "FIELDWEAVER requires Node.js 22 or newer." >&2
  exit 1
fi
exec node scripts/serve.mjs --open
