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
  apiBaseUrl: 'http://127.0.0.1:8788',
  apiToken: '',
  googleClientId: '427918095213-6cbm5sgcfn6o8qosg6qe1r6u9toj66dp.apps.googleusercontent.com'
};
```

### Backend (`finance-v2/api-server/.env`)

- `NOTION_TOKEN=...`
- `MANAGER_CONTACTS_DB_ID=...`

Sin esos valores, `/api/manager/contacts` responde 503 con hint de configuración.

## Archivos

- `index.html` — layout y secciones
- `styles.css` — estilos mobile-first
- `app.js` — tabs, share actions, data hooks MVP

## Siguientes pasos

1. Configurar OAuth en Google Cloud (orígenes del Manager App)
2. Conectar catálogo real (Sheets API / Apps Script)
3. Definir DB final de contactos manager en Notion y setear `MANAGER_CONTACTS_DB_ID`
4. Añadir log de envíos (email/WhatsApp)
