#!/usr/bin/env bash
# deploy.sh — Bump version patch, build, commit, push, deploy to gh-pages
# Uso: bash tools/deploy.sh "descripción del cambio"

set -e

MAIN_JS="$(dirname "$0")/../main.js"
PKG="$(dirname "$0")/../package.json"
MSG="${1:-update}"

# ── Leer versión actual desde main.js ────────────────────────────────────────
CURRENT=$(grep -oE "v[0-9]+\.[0-9]+\.[0-9]+" "$MAIN_JS" | head -1)
if [[ -z "$CURRENT" ]]; then
  echo "ERROR: No se encontró APP_VERSION en main.js"
  exit 1
fi

MAJOR=$(echo "$CURRENT" | sed 's/v//' | cut -d. -f1)
MINOR=$(echo "$CURRENT" | sed 's/v//' | cut -d. -f2)
PATCH=$(echo "$CURRENT" | sed 's/v//' | cut -d. -f3)
NEW_PATCH=$((PATCH + 1))
NEW_VERSION="v${MAJOR}.${MINOR}.${NEW_PATCH}"

echo "▶ Bumping $CURRENT → $NEW_VERSION"

# ── Actualizar APP_VERSION en main.js ────────────────────────────────────────
sed -i '' "s/const APP_VERSION  = '${CURRENT}'/const APP_VERSION  = '${NEW_VERSION}'/" "$MAIN_JS"

# ── Actualizar package.json ──────────────────────────────────────────────────
sed -i '' "s/\"version\": \"${MAJOR}\.${MINOR}\.${PATCH}\"/\"version\": \"${MAJOR}.${MINOR}.${NEW_PATCH}\"/" "$PKG"

# ── Build ────────────────────────────────────────────────────────────────────
cd "$(dirname "$0")/.."
echo "▶ Building..."
npm run build

# ── Commit + Push ────────────────────────────────────────────────────────────
echo "▶ Committing ${NEW_VERSION}..."
git add main.js style.css index.html package.json
git commit -m "feat: ${MSG} (${NEW_VERSION})"
git push

# ── Deploy gh-pages ──────────────────────────────────────────────────────────
echo "▶ Deploying to gh-pages..."
npx gh-pages -d dist

echo "✓ Deployed ${NEW_VERSION}"
