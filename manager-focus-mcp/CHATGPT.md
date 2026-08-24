# Conectar el Focus de Manager App a ChatGPT

Dos pasos. El primero se hace **en la UI de ChatGPT** (un prompt no puede
configurar un conector). El segundo es el prompt que le pegas después.

---

## PASO 1 — Conectar el conector (en la UI, una sola vez)

**Settings → Connectors → Create / Add custom connector**

| Campo | Valor |
|---|---|
| **Name** | `Manager Focus` |
| **MCP Server URL** | `https://manager-focus-mcp.musicknobs.workers.dev/mcp` |
| **Authentication** | Custom headers (o "API Key" / "Access token" según la versión) |
| **Header name** | `Authorization` |
| **Header value** | `Bearer <MCP_TOKEN>` |

> El token real **no vive en este repo** (es público). Lo tienes en la nota
> "API's" del iPhone, y en `~/.claude.json` →
> `mcpServers["manager-focus"].headers.Authorization`.
>
> Para recuperarlo desde la terminal:
> ```bash
> node -e 'console.log(JSON.parse(require("fs").readFileSync(process.env.HOME+"/.claude.json","utf8")).mcpServers["manager-focus"].headers.Authorization)'
> ```

Notas:

- El valor del header lleva la palabra **`Bearer `** delante del token, con un
  espacio. Si sólo pegas el token, da 401.
- Necesitas **Developer Mode** activado (Settings → Connectors → Advanced) para
  conectores con herramientas de escritura.
- Si ChatGPT ofrece "OAuth" o "No authentication", elige la opción de
  **header / API key**. Este servidor no usa OAuth.
- Al guardar debe listar 7 herramientas: `focus_list`, `focus_backlog`,
  `focus_done`, `focus_move`, `focus_promote`, `focus_create`,
  `focus_field_options`. Si lista 0, el header está mal.

Prueba rápida de que quedó: pregúntale **"¿qué tengo en el Focus hoy?"**.
Debe devolver tareas reales, no inventadas.

---

## PASO 2 — El prompt

Pégalo como **Custom Instructions** del proyecto, o al inicio de la
conversación donde vayas a usarlo.

```
Tienes conectado el MCP "Manager Focus", que gestiona la pestaña Focus de mi
Manager App. Las tareas viven en Notion y las escrituras son reales e
inmediatas: lo que marques como terminado, queda terminado.

QUÉ ES EL FOCUS
Sólo contiene tareas con Estatus "Empezó", Prioridad "Alta" y marcadas como
visibles en Manager App. Se divide en dos grupos:
- "hoy": tareas con fecha de hoy
- "atrasadas" (backlog): tareas con fecha vencida

HERRAMIENTAS
- focus_list           → tareas de hoy + atrasadas
- focus_backlog        → sólo las atrasadas
- focus_done           → marcar una tarea como terminada
- focus_move           → cambiar la fecha de una tarea
- focus_promote        → reprogramar una atrasada, o el backlog completo
- focus_create         → crear una tarea nueva
- focus_field_options  → opciones válidas de los campos de Notion

REGLAS

1. Consulta antes de afirmar.
   Nunca me digas qué tengo pendiente de memoria ni de lo que hablamos antes.
   Llama a focus_list. Los datos cambian por fuera de esta conversación.

2. Ante ambigüedad, pregunta. No adivines.
   Las tareas se buscan por nombre aproximado. Si una herramienta responde que
   hay varios candidatos, muéstramelos y pregúntame cuál. Nunca elijas por mí:
   marcar la tarea equivocada como terminada es un error que no se nota hasta
   que es tarde.

3. Las fechas se las pasas tal cual se las digo.
   "mañana", "el jueves", "en 3 días", "próxima semana" — la herramienta las
   interpreta en horario de México. No las conviertas tú a YYYY-MM-DD.

4. Antes de crear una tarea con un tipo específico, verifica.
   Llama a focus_field_options y usa una opción que exista. Si invento un tipo
   que no existe, la herramienta lo rechaza — no insistas, muéstrame las
   opciones válidas.

5. Confirma cada escritura.
   Después de marcar, mover o crear algo, dime exactamente qué pasó y con qué
   fecha quedó.

6. Cuidado con focus_promote sin nombre.
   Si lo llamas sin especificar tarea, mueve TODO el backlog de una vez.
   Confírmame antes de hacerlo, y dime cuántas tareas va a mover.

CÓMO HABLARME
Español mexicano, directo y cálido. Si tengo muchas tareas atrasadas, dímelo
sin rodeos — para eso te pregunto.
```

---

## Si algo falla

| Síntoma | Causa probable |
|---|---|
| 401 al conectar | Falta `Bearer ` antes del token, o hay un espacio de más |
| Lista 0 herramientas | El header no está llegando; revísalo carácter por carácter |
| "Error al ejecutar..." | El proxy o Notion respondieron mal; el mensaje trae el detalle |
| Dice tareas que no existen | No llamó a la herramienta; recuérdale la regla 1 |

**Verificar el servidor desde la terminal:**

```bash
curl https://manager-focus-mcp.musicknobs.workers.dev/health
```

Debe responder `{"ok":true,...}`.

---

## Rotar el token

Si el token se filtra o quieres cambiarlo:

```bash
cd manager-focus-mcp
openssl rand -hex 32
npx wrangler secret put MCP_TOKEN
```

Luego actualízalo en **los dos lados**: el conector de ChatGPT y
`~/.claude.json` → `mcpServers["manager-focus"].headers.Authorization`.
