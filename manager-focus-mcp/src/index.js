/**
 * manager-focus-mcp — Servidor MCP remoto para la pestaña Focus de Manager App.
 *
 * Expone las acciones del Focus como herramientas MCP para cualquier cliente
 * remoto (ChatGPT, Claude, Ivy). Implementa Streamable HTTP en modo stateless:
 * un solo POST /mcp con JSON-RPC 2.0, sin sesiones ni Durable Objects.
 *
 * Cadena completa:
 *   cliente MCP → manager-focus-mcp → manager-app-proxy → Notion
 */

import {
  listFocus,
  showBacklog,
  markDone,
  moveTask,
  promoteFromBacklog,
  createTask,
  getFieldOptions,
} from "./focus.js";

const PROTOCOL_VERSION = "2025-06-18";
const SUPPORTED_PROTOCOLS = ["2025-06-18", "2025-03-26", "2024-11-05"];

const SERVER_INFO = {
  name: "manager-focus",
  title: "Manager App — Focus",
  version: "1.0.0",
};

const INSTRUCTIONS = `Herramientas para el Focus de Manager App (tareas de Jay Mansur en Notion).

El Focus contiene sólo tareas con Estatus "Empezó", Prioridad "Alta" y visibles
en Manager App, divididas en dos grupos: "hoy" y "atrasadas" (backlog).

Reglas de uso:
- Consulta siempre con focus_list antes de afirmar qué tareas existen. Nunca las
  infieras de la conversación previa.
- Las tareas se identifican por nombre aproximado, no por ID. Si una herramienta
  responde que hay varios candidatos, muéstraselos al usuario y pregunta cuál
  antes de reintentar. Nunca elijas por él.
- Las fechas se pasan en lenguaje natural español ("mañana", "el jueves",
  "en 3 días") o en formato YYYY-MM-DD. No las conviertas tú.
- Después de cada acción, confirma al usuario exactamente qué se hizo.`;

// ── Catálogo de herramientas ──────────────────────────────────────────────────

const TASK_ARG = {
  type: "string",
  description:
    "Nombre aproximado de la tarea. No hace falta que sea exacto: se busca por " +
    "coincidencia difusa, ignorando acentos y mayúsculas.",
};

const DATE_ARG = {
  type: "string",
  description:
    'Fecha en español natural ("hoy", "mañana", "pasado mañana", "el jueves", ' +
    '"en 3 días", "próxima semana") o en formato YYYY-MM-DD.',
};

const TOOLS = [
  {
    name: "focus_list",
    title: "Ver el Focus",
    description:
      "Lista las tareas del Focus: las programadas para hoy y las atrasadas. " +
      "Úsala siempre antes de responder qué tiene pendiente el usuario.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    handler: (env) => listFocus(env),
  },
  {
    name: "focus_backlog",
    title: "Ver el backlog",
    description:
      "Lista únicamente las tareas atrasadas (con fecha vencida). Útil para " +
      "revisar qué quedó pendiente antes de reprogramar.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    handler: (env) => showBacklog(env),
  },
  {
    name: "focus_done",
    title: "Marcar tarea como terminada",
    description:
      "Marca una tarea del Focus como terminada, buscándola por nombre " +
      "aproximado entre las de hoy y las atrasadas.",
    inputSchema: {
      type: "object",
      properties: { task: TASK_ARG },
      required: ["task"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: true },
    handler: (env, args) => markDone(env, args.task),
  },
  {
    name: "focus_move",
    title: "Mover tarea de fecha",
    description:
      "Cambia la fecha de una tarea del Focus. Busca la tarea por nombre " +
      "aproximado entre las de hoy y las atrasadas.",
    inputSchema: {
      type: "object",
      properties: { task: TASK_ARG, date: DATE_ARG },
      required: ["task", "date"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: true },
    handler: (env, args) => moveTask(env, args.task, args.date),
  },
  {
    name: "focus_promote",
    title: "Promover del backlog",
    description:
      "Reprograma tareas atrasadas. Con `task` mueve una sola; sin `task` " +
      '(o con "todas") mueve el backlog completo. Por defecto las mueve a hoy.',
    inputSchema: {
      type: "object",
      properties: {
        task: {
          ...TASK_ARG,
          description:
            TASK_ARG.description +
            ' Omítelo o usa "todas" para promover todo el backlog de una vez.',
        },
        date: DATE_ARG,
      },
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: true },
    handler: (env, args) => promoteFromBacklog(env, args.task || "", args.date || "hoy"),
  },
  {
    name: "focus_create",
    title: "Crear tarea",
    description:
      "Crea una tarea nueva en el Focus. Se crea con Prioridad Alta y visible " +
      "en Manager App. Si pasas un `tipo` que no existe en Notion, la " +
      "herramienta lo rechaza y devuelve las opciones válidas.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Título de la tarea." },
        date: { ...DATE_ARG, description: DATE_ARG.description + " Por defecto: hoy." },
        tipo: {
          type: "string",
          description:
            "Categoría de la tarea. Debe coincidir con una opción existente en " +
            "Notion (usa focus_field_options para verlas). Por defecto: Music Knobs.",
        },
        focusOnly: {
          type: "boolean",
          description: "Si es true, la tarea aparece sólo en el Focus.",
        },
        subtasks: {
          type: "array",
          items: { type: "string" },
          description: "Lista opcional de subtareas como texto.",
        },
      },
      required: ["title"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: false },
    handler: (env, args) =>
      createTask(env, {
        title: args.title,
        dueDate: args.date,
        tipo: args.tipo,
        focusOnly: args.focusOnly,
        subtasks: args.subtasks,
      }),
  },
  {
    name: "focus_field_options",
    title: "Ver opciones válidas de Notion",
    description:
      "Devuelve las opciones reales de los campos select de la base de tareas " +
      "(tipo, estatus, prioridad). Consúltala antes de crear una tarea con un " +
      "`tipo` específico: nunca inventes valores que no estén en esta lista.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true },
    handler: async (env) => {
      const o = await getFieldOptions(env);
      const line = (label, arr) => `${label}: ${(arr || []).join(", ") || "—"}`;
      return {
        ok: true,
        message: [
          line("Tipo", o.tipo),
          line("Estatus", o.status),
          line("Prioridad", o.prioridad),
          line("Usuarios", (o.users || []).map((u) => u.name || u.email)),
        ].join("\n"),
        data: o,
      };
    },
  },
];

const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));

const publicTool = ({ name, title, description, inputSchema, annotations }) => ({
  name,
  title,
  description,
  inputSchema,
  annotations,
});

// ── JSON-RPC ──────────────────────────────────────────────────────────────────

const ERR = {
  PARSE: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL: -32603,
};

const rpcResult = (id, result) => ({ jsonrpc: "2.0", id, result });
const rpcError = (id, code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });

/** Empaqueta el resultado de dominio en el shape que espera MCP. */
function toolContent(result) {
  return {
    content: [{ type: "text", text: result.message }],
    structuredContent: result.data ?? {},
    // ok:false es un fallo de negocio (tarea ambigua, tipo inválido). Se marca
    // como isError para que el modelo lo lea como algo que debe resolver con el
    // usuario, no como un resultado exitoso.
    isError: result.ok === false,
  };
}

async function handleRpc(message, env) {
  const { id = null, method, params = {} } = message || {};

  if (!method || typeof method !== "string") {
    return rpcError(id, ERR.INVALID_REQUEST, "Falta el campo 'method'.");
  }

  switch (method) {
    case "initialize": {
      const asked = params.protocolVersion;
      return rpcResult(id, {
        protocolVersion: SUPPORTED_PROTOCOLS.includes(asked) ? asked : PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: INSTRUCTIONS,
      });
    }

    case "ping":
      return rpcResult(id, {});

    case "tools/list":
      return rpcResult(id, { tools: TOOLS.map(publicTool) });

    case "tools/call": {
      const tool = TOOL_BY_NAME.get(params.name);
      if (!tool) {
        return rpcError(id, ERR.INVALID_PARAMS, `Herramienta desconocida: ${params.name}`);
      }
      try {
        const result = await tool.handler(env, params.arguments || {});
        return rpcResult(id, toolContent(result));
      } catch (e) {
        // Fallo de infraestructura (proxy caído, Notion rechazando): se reporta
        // como resultado con isError para que el modelo se lo diga al usuario
        // en vez de reintentar a ciegas.
        return rpcResult(id, {
          content: [{ type: "text", text: `⚠️ Error al ejecutar ${tool.name}: ${e.message}` }],
          isError: true,
        });
      }
    }

    default:
      return rpcError(id, ERR.METHOD_NOT_FOUND, `Método no soportado: ${method}`);
  }
}

// ── HTTP ──────────────────────────────────────────────────────────────────────

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization,Mcp-Session-Id,MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
};

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });

/**
 * Compara en tiempo constante para no filtrar el token por diferencias de
 * tiempo de respuesta.
 */
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function authorized(request, env) {
  const expected = env.MCP_TOKEN;
  // Sin token configurado el servidor no arranca: preferimos 500 a quedar abierto.
  if (!expected) return "unconfigured";

  const header = request.headers.get("Authorization") || "";
  const bearer = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  return safeEqual(bearer, expected) ? "ok" : "denied";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    if (url.pathname === "/health") {
      return json({ ok: true, server: SERVER_INFO.name, version: SERVER_INFO.version });
    }

    if (url.pathname !== "/mcp") {
      return json({ error: "Not found. El endpoint MCP es POST /mcp" }, 404);
    }

    const auth = authorized(request, env);
    if (auth === "unconfigured") {
      return json({ error: "MCP_TOKEN no configurado en el Worker." }, 500);
    }
    if (auth === "denied") {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: {
          "Content-Type": "application/json",
          "WWW-Authenticate": 'Bearer realm="manager-focus-mcp"',
          ...CORS,
        },
      });
    }

    // Stateless: no hay stream de servidor que abrir, así que GET /mcp no aplica.
    if (request.method !== "POST") {
      return json({ error: "Método no permitido. Usa POST /mcp." }, 405);
    }

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json(rpcError(null, ERR.PARSE, "JSON inválido."), 400);
    }

    // Batch JSON-RPC.
    if (Array.isArray(payload)) {
      const responses = [];
      for (const msg of payload) {
        if (msg?.id === undefined) continue; // notificación: sin respuesta
        responses.push(await handleRpc(msg, env));
      }
      return responses.length ? json(responses) : new Response(null, { status: 202, headers: CORS });
    }

    // Notificación suelta (p.ej. notifications/initialized): se acusa y ya.
    if (payload?.id === undefined) {
      return new Response(null, { status: 202, headers: CORS });
    }

    return json(await handleRpc(payload, env));
  },
};
