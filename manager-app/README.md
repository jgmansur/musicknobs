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
  - Google Sheets (Catálogo) vía endpoint backend

## Integraciones activas ahora

- Frontend OAuth Google listo en `app.js` (botón Conectar / Cerrar sesión).
- Carga de contactos desde `GET /api/manager/contacts`.
- Carga de catálogo desde `GET /api/manager/catalog`.

## Config requerida

### Frontend (`manager-app/config.js`)

```js
window.MANAGER_APP_CONFIG = {
  apiBaseUrl: 'http://127.0.0.1:8788', // local
  apiToken: '',
  googleClientId: '427918095213-6cbm5sgcfn6o8qosg6qe1r6u9toj66dp.apps.googleusercontent.com'
};
```

Para online en GitHub Pages, cambia `apiBaseUrl` al URL del Worker, por ejemplo:

```js
apiBaseUrl: 'https://manager-app-proxy.<tu-subdominio>.workers.dev'
```

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

## Siguientes pasos

1. Configurar OAuth en Google Cloud (orígenes del Manager App)
2. Conectar catálogo real (Sheets API / Apps Script)
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
