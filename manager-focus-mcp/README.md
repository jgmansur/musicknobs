# manager-focus-mcp

Servidor MCP remoto para la pestaña **Focus** de Manager App. Deja que ChatGPT,
Claude o Ivy lean y editen las tareas del Focus sin pasar por la app.

```
ChatGPT ─┐
Ivy ─────┼─→ manager-focus-mcp ─→ manager-app-proxy ─→ Notion
Claude ──┘     (este Worker)        (Worker existente)
```

Este Worker **nunca toca Notion directamente**. Todo pasa por `manager-app-proxy`,
que sigue siendo el único que habla con la API de Notion.

La llamada al proxy va por **service binding** (`env.PROXY`), no por HTTP.
Cloudflare bloquea con **error 1042** que un Worker haga `fetch` a otro Worker de
la misma cuenta por su URL `workers.dev`; el binding es la vía correcta y además
evita el viaje a internet. Si algún día el proxy se mueve de cuenta, hay fallback
a `fetch(PROXY_URL)`.

## Herramientas

| Tool | Qué hace |
|---|---|
| `focus_list` | Tareas de hoy + atrasadas |
| `focus_backlog` | Sólo las atrasadas |
| `focus_done` | Marca una tarea como terminada |
| `focus_move` | Cambia la fecha de una tarea |
| `focus_promote` | Reprograma una tarea atrasada, o el backlog completo |
| `focus_create` | Crea una tarea nueva |
| `focus_field_options` | Opciones reales de los select de Notion |

Las tareas se referencian **por nombre aproximado**, no por ID: el matching
ignora acentos y mayúsculas. Si un nombre coincide con varias tareas, la
herramienta **no elige** — devuelve los candidatos para que el modelo pregunte.

Dos invariantes que el código sostiene y los tests protegen:

- El status "terminado" se lee del schema de Notion en vivo (`field-options`),
  nunca se hardcodea. Si renombras la opción en Notion, esto sigue funcionando.
- `focus_create` valida el `tipo` contra las opciones reales del select. Un tipo
  inexistente se rechaza con la lista válida, en vez de inventar una opción.

## Deploy

```bash
cd manager-focus-mcp
npm install

# Genera y guarda el token (te lo pedirá por stdin)
openssl rand -hex 32
npx wrangler secret put MCP_TOKEN

npx wrangler deploy
```

Verificar:

```bash
curl https://manager-focus-mcp.musicknobs.workers.dev/health
```

## Conectar clientes

**Endpoint:** `POST https://manager-focus-mcp.musicknobs.workers.dev/mcp`
**Auth:** header `Authorization: Bearer <MCP_TOKEN>`

### ChatGPT

Settings → Connectors → Create. Pega la URL del endpoint y configura la
autenticación con el header `Authorization`. Requiere Developer Mode activado
para conectores con herramientas de escritura.

### Claude Code / Claude Desktop

```bash
claude mcp add --transport http manager-focus \
  https://manager-focus-mcp.musicknobs.workers.dev/mcp \
  --header "Authorization: Bearer <MCP_TOKEN>"
```

## Tests

```bash
npm test
```

42 tests, sin red: el proxy se simula con un `fetch` de prueba. Cubren el parser
de fechas en español, el fuzzy matching, el protocolo JSON-RPC, la autenticación
y que las herramientas de escritura **no escriban** cuando hay ambigüedad.

## Nota de seguridad

`manager-app-proxy` no tiene autenticación propia — está protegido sólo por
oscuridad de URL. Este Worker sí exige bearer token, pero eso no cierra el
agujero de abajo: quien conozca la URL del proxy sigue pudiendo llamarlo directo.
Cerrarlo es un trabajo aparte.

Para rotar el token: `npx wrangler secret put MCP_TOKEN` y actualizarlo en cada
cliente conectado.
