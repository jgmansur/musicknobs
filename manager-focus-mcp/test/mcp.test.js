import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import worker from "../src/index.js";

const TOKEN = "test-token-123";
const ENV = { MCP_TOKEN: TOKEN, PROXY_URL: "https://proxy.test", VIEWER_EMAIL: "jay@test.com" };

/** Respuestas que el proxy devolverá durante el test, por fragmento de URL. */
let proxyRoutes;
/** Peticiones que el worker hizo al proxy, para verificar efectos. */
let proxyCalls;
const realFetch = globalThis.fetch;

beforeEach(() => {
  proxyRoutes = {};
  proxyCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    proxyCalls.push({ url: String(url), method: init.method || "GET", body: init.body });
    const hit = Object.entries(proxyRoutes).find(([frag]) => String(url).includes(frag));
    const body = hit ? hit[1] : {};
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
});

afterEach(() => {
  globalThis.fetch = realFetch;
});

const rpc = (method, params, { token = TOKEN, id = 1 } = {}) => {
  const headers = { "Content-Type": "application/json" };
  if (token !== null) headers.Authorization = `Bearer ${token}`;
  return worker.fetch(
    new Request("https://mcp.test/mcp", {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    }),
    ENV,
  );
};

const call = async (name, args = {}) => {
  const res = await rpc("tools/call", { name, arguments: args });
  return (await res.json()).result;
};

describe("auth", () => {
  test("sin token → 401", async () => {
    const res = await rpc("tools/list", {}, { token: null });
    assert.equal(res.status, 401);
    assert.match(res.headers.get("WWW-Authenticate") || "", /Bearer/);
  });

  test("token incorrecto → 401", async () => {
    assert.equal((await rpc("tools/list", {}, { token: "wrong-token-99" })).status, 401);
  });

  test("token correcto → 200", async () => {
    assert.equal((await rpc("tools/list")).status, 200);
  });

  test("sin MCP_TOKEN configurado el worker falla cerrado, no abierto", async () => {
    const res = await worker.fetch(
      new Request("https://mcp.test/mcp", {
        method: "POST",
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      }),
      { PROXY_URL: "https://proxy.test" },
    );
    assert.equal(res.status, 500);
  });

  test("/health responde sin auth", async () => {
    const res = await worker.fetch(new Request("https://mcp.test/health"), ENV);
    assert.equal(res.status, 200);
    assert.equal((await res.json()).ok, true);
  });
});

describe("protocolo MCP", () => {
  test("initialize devuelve capabilities e instrucciones", async () => {
    const { result } = await (await rpc("initialize", { protocolVersion: "2025-06-18" })).json();
    assert.equal(result.protocolVersion, "2025-06-18");
    assert.equal(result.serverInfo.name, "manager-focus");
    assert.ok(result.capabilities.tools);
    assert.match(result.instructions, /Focus/);
  });

  test("initialize acepta versiones anteriores del protocolo", async () => {
    const { result } = await (await rpc("initialize", { protocolVersion: "2024-11-05" })).json();
    assert.equal(result.protocolVersion, "2024-11-05");
  });

  test("tools/list expone las 7 herramientas con schema", async () => {
    const { result } = await (await rpc("tools/list")).json();
    const names = result.tools.map((t) => t.name).sort();
    assert.deepEqual(names, [
      "focus_backlog",
      "focus_create",
      "focus_done",
      "focus_field_options",
      "focus_list",
      "focus_move",
      "focus_promote",
    ]);
    for (const t of result.tools) {
      assert.equal(t.inputSchema.type, "object", `${t.name} necesita inputSchema`);
      assert.ok(t.description, `${t.name} necesita description`);
    }
  });

  test("método desconocido → -32601", async () => {
    const { error } = await (await rpc("no/existe")).json();
    assert.equal(error.code, -32601);
  });

  test("herramienta desconocida → -32602", async () => {
    const { error } = await (await rpc("tools/call", { name: "focus_borrar_todo" })).json();
    assert.equal(error.code, -32602);
  });

  test("una notificación se acusa con 202 y sin cuerpo", async () => {
    const res = await worker.fetch(
      new Request("https://mcp.test/mcp", {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      }),
      ENV,
    );
    assert.equal(res.status, 202);
  });

  test("JSON inválido → -32700", async () => {
    const res = await worker.fetch(
      new Request("https://mcp.test/mcp", {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}` },
        body: "{ roto",
      }),
      ENV,
    );
    assert.equal((await res.json()).error.code, -32700);
  });
});

describe("herramientas de lectura", () => {
  test("focus_list resume hoy y atrasadas", async () => {
    proxyRoutes["/tasks/focus"] = {
      today: [{ id: "a", title: "Grabar intro" }],
      overdue: [{ id: "b", title: "Pagar Telcel", dueDate: "2026-08-20" }],
    };
    const result = await call("focus_list");
    assert.equal(result.isError, false);
    assert.match(result.content[0].text, /Grabar intro/);
    assert.match(result.content[0].text, /ATRASADAS/);
    assert.equal(result.structuredContent.overdue.length, 1);
  });

  test("focus_list con el Focus vacío lo dice explícitamente", async () => {
    proxyRoutes["/tasks/focus"] = { today: [], overdue: [] };
    const result = await call("focus_list");
    assert.match(result.content[0].text, /Focus vacío/);
  });

  test("focus_backlog limpio no inventa pendientes", async () => {
    proxyRoutes["/tasks/focus"] = { today: [{ id: "a", title: "X" }], overdue: [] };
    const result = await call("focus_backlog");
    assert.match(result.content[0].text, /backlog está limpio/);
  });
});

describe("herramientas de escritura", () => {
  test("focus_done resuelve el status desde el schema, no hardcodeado", async () => {
    proxyRoutes["/tasks/focus"] = { today: [{ id: "task-1", title: "Grabar intro" }], overdue: [] };
    proxyRoutes["/field-options"] = { status: ["Empezó", "Terminó"], tipo: [], prioridad: [] };

    const result = await call("focus_done", { task: "grabar intro" });
    assert.equal(result.isError, false);

    const patch = proxyCalls.find((c) => c.method === "PATCH");
    assert.ok(patch, "debió mandar un PATCH");
    assert.match(patch.url, /\/tasks\/task-1$/);
    // "Terminó" viene del schema simulado; si estuviera hardcodeado diría "Terminado".
    assert.equal(JSON.parse(patch.body).status, "Terminó");
  });

  test("focus_done ambiguo NO escribe: devuelve candidatos", async () => {
    proxyRoutes["/tasks/focus"] = {
      today: [
        { id: "1", title: "Grabar video de compresión" },
        { id: "2", title: "Grabar video de reverb" },
      ],
      overdue: [],
    };
    const result = await call("focus_done", { task: "grabar video" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /varias tareas/);
    assert.equal(proxyCalls.filter((c) => c.method === "PATCH").length, 0, "no debe escribir nada");
  });

  test("focus_move manda la fecha a las 09:00 de México", async () => {
    proxyRoutes["/tasks/focus"] = { today: [{ id: "t9", title: "Mezclar demo" }], overdue: [] };
    const result = await call("focus_move", { task: "mezclar", date: "2026-09-15" });
    assert.equal(result.isError, false);

    const patch = proxyCalls.find((c) => c.method === "PATCH");
    assert.equal(JSON.parse(patch.body).dueDate, "2026-09-15T09:00:00-06:00");
    assert.equal(result.structuredContent.newDate, "2026-09-15");
  });

  test("focus_promote sin task mueve todo el backlog", async () => {
    proxyRoutes["/tasks/focus"] = {
      today: [],
      overdue: [
        { id: "o1", title: "Vieja 1", dueDate: "2026-08-01" },
        { id: "o2", title: "Vieja 2", dueDate: "2026-08-02" },
      ],
    };
    const result = await call("focus_promote", {});
    assert.equal(result.isError, false);
    assert.equal(proxyCalls.filter((c) => c.method === "PATCH").length, 2);
    assert.equal(result.structuredContent.moved.length, 2);
  });

  test("focus_create rechaza un tipo que no existe en Notion", async () => {
    proxyRoutes["/field-options"] = { tipo: ["Music Knobs", "Personal"], status: [], prioridad: [] };

    const result = await call("focus_create", { title: "Nueva tarea", tipo: "Inventado" });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /no existe en Notion/);
    assert.match(result.content[0].text, /Music Knobs, Personal/);
    assert.equal(proxyCalls.filter((c) => c.method === "POST").length, 0, "no debe crear nada");
  });

  test("focus_create normaliza el tipo a la capitalización del schema", async () => {
    proxyRoutes["/field-options"] = { tipo: ["Music Knobs", "Personal"], status: [], prioridad: [] };
    proxyRoutes["/api/manager/tasks"] = { ok: true, id: "new-1" };

    const result = await call("focus_create", {
      title: "Nueva tarea",
      tipo: "personal",
      date: "mañana",
    });
    assert.equal(result.isError, false);

    const post = proxyCalls.find((c) => c.method === "POST");
    assert.equal(JSON.parse(post.body).tipo, "Personal");
  });

  test("focus_create sin título falla sin llamar al proxy", async () => {
    const result = await call("focus_create", { title: "   " });
    assert.equal(result.isError, true);
    assert.equal(proxyCalls.filter((c) => c.method === "POST").length, 0);
  });
});

describe("service binding", () => {
  test("si existe env.PROXY se usa el binding, no el fetch global", async () => {
    const bindingCalls = [];
    const envWithBinding = {
      ...ENV,
      PROXY: {
        fetch: async (url, init = {}) => {
          bindingCalls.push({ url: String(url), method: init.method || "GET" });
          return new Response(JSON.stringify({ today: [], overdue: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        },
      },
    };

    const res = await worker.fetch(
      new Request("https://mcp.test/mcp", {
        method: "POST",
        headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "focus_list", arguments: {} },
        }),
      }),
      envWithBinding,
    );

    const { result } = await res.json();
    assert.equal(result.isError, false);
    assert.equal(bindingCalls.length, 1, "debió pasar por el binding");
    assert.equal(proxyCalls.length, 0, "no debió tocar el fetch global");
  });
});

describe("errores del proxy", () => {
  test("un fallo del proxy se reporta, no se traga", async () => {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ error: "Notion caído" }), { status: 502 });

    const result = await call("focus_list");
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Error al ejecutar focus_list/);
  });
});
