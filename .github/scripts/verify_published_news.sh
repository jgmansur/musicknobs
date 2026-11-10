#!/usr/bin/env bash
# Pages can report success before every public edge serves the new data.
# Never accept a stale version: retry an exact comparison and log the evidence.
set -euo pipefail
page_url=${1:?Pages URL required}
expected=${2:?Expected news JSON required}
attempts=${VERIFY_ATTEMPTS:-30}
delay=${VERIFY_DELAY_SECONDS:-20}
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
expected_hash=$(sha256sum "$expected" | cut -d ' ' -f 1)
echo "Expected news SHA-256: $expected_hash"
for ((attempt=1; attempt<=attempts; attempt++)); do
  url="${page_url%/}/noticias/data.json?deployment=${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}-${attempt}"
  if curl --fail --location --compressed --silent --show-error --max-time 30 \
      -H 'Cache-Control: no-cache' "$url" -o "$tmp/public.json"; then
    actual_hash=$(sha256sum "$tmp/public.json" | cut -d ' ' -f 1)
    echo "Attempt $attempt/$attempts: public SHA-256: $actual_hash"
    if cmp -s "$expected" "$tmp/public.json"; then
      echo "Published news matches the deployed commit."
      exit 0
    fi
  else
    echo "Attempt $attempt/$attempts: public download failed." >&2
  fi
  if ((attempt < attempts)); then sleep "$delay"; fi
done
echo "Published news does not match the deployed commit after $attempts attempts." >&2
exit 1
