# Manager App (MVP)

App web mobile-first para operación de manager sobre la carrera de Jay Mansur.

## Qué incluye este primer task (MVP)

- Estructura base de nueva app en `musicknobs/manager-app/`
- Tabs mobile-first: Overview, Catálogo, Contactos, Links, Ops
- Acciones de compartir por Email y WhatsApp
- Exportación a PDF vía `window.print()`
- Secciones preparadas para integrar:
  - Google OAuth (flujo token client en frontend)
  - Notion DB (Contactos) vía endpoint backend

## Integraciones activas ahora

- Frontend OAuth Google listo en `app.js` (botón Conectar / Cerrar sesión).
- Carga de contactos desde `GET /api/manager/contacts`.
- Carga de catálogo desde `GET /api/manager/catalog`.
- Reproductor seguro con **Howler** + endpoint backend `GET /api/audio/:fileId`.

## Catálogo AI Search (híbrido)

El catálogo usa un modelo híbrido de búsqueda:

1. **`Tags para Búsqueda AI` (multi-select curado)**
   - Taxonomía controlada para filtros y consistencia.
   - Ejemplos: `mood:triste`, `tema:desamor`, `contenido:explícita`, `target:mujer`.

2. **`Tags AI Raw` (texto CSV extendido)**
   - Long-tail semántico para búsquedas más profundas.
   - Incluye tags adicionales y `kw:*` derivados del contenido de letra.

### ¿Por qué híbrido?

- Notion `multi_select` tiene límites prácticos (opciones/elementos por request).
- El campo CSV permite crecer semánticamente sin romper esos límites.
- El frontend busca en **ambos** campos.

### Pipeline de enriquecimiento

Script fuente de verdad:

```bash
python3 /Users/jaystudio/skills/global/manager-catalog-sync/scripts/sync_catalog.py --skip-lyrics
```

Ese sync actualiza:
- `Tags para Búsqueda AI`
- `Tags AI Raw`
- (y, cuando no se usa `--skip-lyrics`, también crea/vincula letras)

## Búsqueda por verso (lyrics search)

Ya está habilitada en producción.

- El backend (`cloudflare-proxy/src/worker.js`) lee la URL de `Letra` de cada canción.
- Extrae el texto de bloques de la página en Notion y lo expone como `lyricsText` en `GET /api/manager/catalog`.
- El frontend (`app.js`) indexa `lyricsText` dentro del `buildCatalogSearchBlob`.

### Comportamiento actual de búsqueda

- Usa `includes` (substring): funciona excelente con fragmentos contiguos del verso.
- Si escribes palabras sueltas fuera de orden, puede no hacer match (no es fuzzy/tokenized todavía).

## Reproducción de audio segura (Google Drive privado)

Arquitectura elegida (más segura y simple de mantener para este proyecto):

1. El frontend (`manager-app`) usa **Howler** local (`vendor/howler.min.js`), sin CDN.
2. El frontend **nunca** recibe credenciales de Google.
3. El backend de Cloudflare Worker (`cloudflare-proxy`) expone `GET /api/audio/:fileId`.
4. Ese endpoint:
   - autentica con Service Account de Google Drive
   - valida metadatos y `capabilities.canDownload`
   - si está permitido, hace stream del `alt=media`
   - reenvía soporte de `Range` para seek/progreso

### Variables de entorno requeridas para audio seguro

Archivo de referencia: `cloudflare-proxy/.dev.vars.example`

Opciones para credenciales de Google Drive (elige una):

- **Opción A (recomendada):** `DRIVE_SERVICE_ACCOUNT_JSON_BASE64`
- **Opción B:**
  - `DRIVE_SERVICE_ACCOUNT_CLIENT_EMAIL`
  - `DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY`

> Importante: nunca pongas estas variables en `config.js` ni en frontend.

## Config requerida

### Frontend (`manager-app/config.js`)

```js
window.MANAGER_APP_CONFIG = {
  apiBaseUrl: 'http://127.0.0.1:8788', // local
  apiToken: '',
  googleClientId: '427918095213-6cbm5sgcfn6o8qosg6qe1r6u9toj66dp.apps.googleusercontent.com'
};
```

`apiBaseUrl` debe apuntar al Worker que sirve `/api/audio/:fileId`.

Para online en GitHub Pages, cambia `apiBaseUrl` al URL del Worker, por ejemplo:

```js
apiBaseUrl: 'https://manager-app-proxy.<tu-subdominio>.workers.dev'
```

### Modo dev local sin login Google (solo localhost)

Si OAuth local falla por `redirect_uri_mismatch`, puedes abrir la UI en local sin login agregando este query param:

`http://127.0.0.1:8080/manager-app/?dev_auth_bypass=1`

- Solo funciona en `localhost` / `127.0.0.1`
- No afecta producción (GitHub Pages)
- Es para revisión visual/flujo rápido en local

### Backend (`finance-v2/api-server/.env`)

- `NOTION_TOKEN=...`
- `MANAGER_CONTACTS_DB_ID=...` (opcional: default a DB `Contacto`)
- `NOTION_VERSION=2025-09-03` (opcional; recomendado)

Si falta `NOTION_TOKEN`, `/api/manager/contacts` regresa fallback local con contactos base para no bloquear operación del MVP.
Con `NOTION_TOKEN` activo, el backend intenta primero `data_sources/{id}/query` y, si no aplica, cae a `databases/{id}/query` para compatibilidad.

## Archivos

- `index.html` — layout y secciones
- `styles.css` — estilos mobile-first
- `app.js` — tabs, share actions, data hooks MVP
- `tracks.js` — playlist editable (`title`, `artist`, `fileId`, `cover`)
- `vendor/howler.min.js` — build oficial de Howler copiado desde npm
- `version.json` — versión visible en UI para identificar cada release
- `cloudflare-proxy/src/worker.js` — API segura para stream de Drive
- `cloudflare-proxy/.dev.vars.example` — plantilla de variables locales
- `cloudflare-proxy/wrangler.toml` — configuración de deploy del Worker

## Flujo local (frontend + worker)

```bash
cd /Users/jaystudio/Documents/GitHub/Apps/musicknobs/manager-app
npm install
npm run sync:howler

cd /Users/jaystudio/Documents/GitHub/Apps/musicknobs/manager-app/cloudflare-proxy
npm install
npx wrangler dev
```

En paralelo, sirve el frontend estático (ejemplo):

```bash
cd /Users/jaystudio/Documents/GitHub/Apps/musicknobs
python3 -m http.server 8080
```

Y usa en `manager-app/config.js`:

```js
apiBaseUrl: 'http://127.0.0.1:8787'
```

## Cómo administrar canciones

Opciones:

1. **Desde Notion catálogo** (si ya lo usas): mantener campo Drive con URL/fileId válido.
2. **Desde fallback local** en `tracks.js`:
   - `title`
   - `artist`
   - `fileId` (Google Drive)
   - `cover` (opcional)

Para agregar/quitar pistas en fallback, edita `tracks.js` y refresca.

## Release seguro de esta app (solo manager-app)

Para evitar commits mezclados y subir versión en cada publicación:

```bash
cd /Users/jaystudio/Documents/GitHub/Apps/musicknobs
./scripts/release_manager_app.sh
```

Qué hace el script:
- bloquea release si hay cambios fuera de `manager-app/`
- incrementa patch en `manager-app/version.json` (ej. `1.0.0` -> `1.0.1`)
- commit con formato `chore(manager-app): release vX.Y.Z`
- push a `main`

## Siguientes pasos

1. Configurar OAuth en Google Cloud (orígenes del Manager App)
2. (Opcional) agregar búsqueda fuzzy/tokenized para versos no contiguos
3. Definir DB final de contactos manager en Notion y setear `MANAGER_CONTACTS_DB_ID`
4. Añadir log de envíos (email/WhatsApp)

---

## Deploy gratis (Cloudflare Workers)

Este camino permite usar Manager App online sin pagar servidor.

### 1) Crear Worker

Ruta: `manager-app/cloudflare-proxy/`

```bash
cd /Users/jaystudio/Documents/GitHub/Apps/musicknobs/manager-app/cloudflare-proxy
npm ci
npx wrangler login
npx wrangler deploy
```

### 2) Configurar secretos del Worker

```bash
npx wrangler secret put NOTION_TOKEN
```

Variables no-secret (wrangler dashboard o `wrangler.toml vars`):
- `MANAGER_CONTACTS_DB_ID=c4d6cef4-ddcc-436a-9576-402994a4ddac`
- `NOTION_VERSION=2025-09-03`

### 3) Apuntar frontend al Worker

En `manager-app/config.js`:

```js
apiBaseUrl: 'https://manager-app-proxy.<tu-subdominio>.workers.dev'
```

### 4) Commit + push

Al hacer push a `main`, GitHub Pages publica la UI. La UI consumirá el Worker público para contactos/catálogo.
