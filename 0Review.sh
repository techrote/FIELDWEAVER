#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
for tool in node npm git; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    printf 'FIELDWEAVER review requires %s (Node 22/24 and one-time GitHub access).\n' "$tool" >&2
    exit 1
  fi
done
npm run verify
index=1
while [ "$index" -le 999 ]; do
  review="FIELDWEAVER-admission-review-${index}.html"
  if [ ! -e "$review" ]; then
    break
  fi
  index=$((index + 1))
done
if [ "$index" -gt 999 ]; then
  echo 'Review slots exhausted. No previous review was overwritten.' >&2
  exit 1
fi
if ! node scripts/admission-review.mjs --out "$review"; then
  echo 'Source-exact review failed. No stale artwork review was opened.' >&2
  exit 1
fi
printf 'Verified offline review: %s/%s\n' "$PWD" "$review"
echo 'Accepted reference works and unmerged Drafts are labelled separately.'
if command -v xdg-open >/dev/null 2>&1; then
  xdg-open "$review" >/dev/null 2>&1 &
elif command -v open >/dev/null 2>&1; then
  open "$review" >/dev/null 2>&1 &
else
  echo 'Open the HTML manually in Firefox.'
fi
