#!/bin/zsh

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VERSION_FILE="$ROOT_DIR/manager-app/version.json"

cd "$ROOT_DIR"

if [[ ! -f "$VERSION_FILE" ]]; then
  echo "❌ No existe manager-app/version.json"
  exit 1
fi

STATUS="$(git status --porcelain)"

if [[ -z "$STATUS" ]]; then
  echo "✅ No hay cambios por publicar en manager-app."
  exit 0
fi

# Bloquea cambios fuera de manager-app para evitar commits mezclados.
while IFS= read -r line; do
  file="${line:3}"
  if [[ "$file" != manager-app/* ]]; then
    echo "❌ Hay cambios fuera de manager-app: $file"
    echo "   Limpia o commitea por separado antes de release."
    exit 1
  fi
done <<< "$STATUS"

NEXT_VERSION="$(python3 - <<'PY'
import json
from pathlib import Path

p = Path("manager-app/version.json")
data = json.loads(p.read_text(encoding="utf-8"))
version = str(data.get("version", "1.0.0")).strip()
parts = version.split('.')
if len(parts) != 3 or not all(x.isdigit() for x in parts):
    raise SystemExit(f"Version inválida: {version}")

major, minor, patch = map(int, parts)
patch += 1
new_version = f"{major}.{minor}.{patch}"
data["version"] = new_version
p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(new_version)
PY
)"

# Cache-bust: actualizar query params de app.js y styles.css en index.html
sed -i '' "s|styles\.css?v=[^\"']*|styles.css?v=${NEXT_VERSION}|g" manager-app/index.html
sed -i '' "s|app\.js?v=[^\"']*|app.js?v=${NEXT_VERSION}|g" manager-app/index.html

git add manager-app
git commit -m "chore(manager-app): release v${NEXT_VERSION}"
git push origin main

echo "🚀 Release manager-app publicado: v${NEXT_VERSION}"
echo "🔗 https://github.com/jgmansur/musicknobs/commits/main"
echo "🌐 https://jgmansur.github.io/musicknobs/manager-app/"
