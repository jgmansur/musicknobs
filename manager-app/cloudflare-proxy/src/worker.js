const SAMPLE_CATALOG = [
  { obra: "Tema Demo 1", autores: "Jay Mansur", generos: "Regional Mexicano", drive: "#" },
  { obra: "Tema Demo 2", autores: "Jay Mansur, Alejandro De Nigris", generos: "Pop", drive: "#" },
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

const DEFAULT_MANAGER_TASKS_DB_ID = "6405719e-5f90-4fc0-8eab-d9352387dd07";
const TASK_PREFIX = "[ManagerTask] ";

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...CORS_HEADERS,
    },
  });
}

function richTextToString(value) {
  if (!Array.isArray(value)) return "";
  return value.map((x) => x?.plain_text || "").join("").trim();
}

function readNotionTitle(props) {
  const titleProp = Object.values(props).find((p) => p?.type === "title");
  return richTextToString(titleProp?.title);
}

function normalizeTaskTitle(raw) {
  return String(raw || "").replace(TASK_PREFIX, "").trim();
}

function readNotionEmail(props) {
  for (const [name, prop] of Object.entries(props)) {
    const key = name.toLowerCase();
    if (!["email", "correo", "mail", "e-mail"].some((k) => key.includes(k))) continue;
    if (prop?.type === "email") return prop.email || "";
    if (prop?.type === "rich_text") return richTextToString(prop.rich_text);
  }
  return "";
}

function readNotionPhone(props) {
  for (const [name, prop] of Object.entries(props)) {
    const key = name.toLowerCase();
    if (!["telefono", "teléfono", "phone", "cel", "movil", "móvil"].some((k) => key.includes(k))) continue;
    if (prop?.type === "phone_number") return prop.phone_number || "";
    if (prop?.type === "rich_text") return richTextToString(prop.rich_text);
  }
  return "";
}

function readNotionWhatsapp(props) {
  for (const [name, prop] of Object.entries(props)) {
    const key = name.toLowerCase();
    if (!["whatsapp", "wa"].some((k) => key.includes(k))) continue;
    if (prop?.type === "url") return prop.url || "";
    if (prop?.type === "rich_text") return richTextToString(prop.rich_text);
  }
  return "";
}

function readNotionRole(props) {
  for (const [name, prop] of Object.entries(props)) {
    const key = name.toLowerCase();
    if (!["rol", "role", "puesto", "cargo"].some((k) => key.includes(k))) continue;
    if (prop?.type === "select") return prop.select?.name || "";
    if (prop?.type === "rich_text") return richTextToString(prop.rich_text);
    if (prop?.type === "multi_select") {
      return (prop.multi_select || [])
        .map((x) => x?.name)
        .filter(Boolean)
        .join(", ");
    }
  }
  return "";
}

async function queryNotionContacts(env) {
  const notionVersion = env.NOTION_VERSION || "2025-09-03";
  const dbId = env.MANAGER_CONTACTS_DB_ID || "";
  const notionToken = env.NOTION_TOKEN || "";

  if (!notionToken || !dbId) {
    return {
      source: "fallback",
      warning: "NOTION_TOKEN o MANAGER_CONTACTS_DB_ID no configurados en Cloudflare.",
      data: [],
    };
  }

  const endpoints = [
    `https://api.notion.com/v1/data_sources/${dbId}/query`,
    `https://api.notion.com/v1/databases/${dbId}/query`,
  ];

  let lastError = "";

  for (const url of endpoints) {
    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": notionVersion,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ page_size: 100 }),
    });

    if (!resp.ok) {
      lastError = await resp.text();
      continue;
    }

    const payload = await resp.json();
    const data = (payload.results || []).map((page) => {
      const props = page.properties || {};
      return {
        nombre: readNotionTitle(props),
        rol: readNotionRole(props),
        correo: readNotionEmail(props),
        telefono: readNotionPhone(props),
        whatsapp: readNotionWhatsapp(props),
      };
    });

    return { source: "notion", data };
  }

  return { source: "error", error: "Notion query failed", details: lastError, data: [] };
}

async function notionQuery(dbOrDataSourceId, notionToken, notionVersion, filter = null, pageSize = 100) {
  const endpoints = [
    `https://api.notion.com/v1/data_sources/${dbOrDataSourceId}/query`,
    `https://api.notion.com/v1/databases/${dbOrDataSourceId}/query`,
  ];

  let lastError = "";
  for (const url of endpoints) {
    const body = {
      page_size: pageSize,
      sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
    };
    if (filter) body.filter = filter;

    const resp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": notionVersion,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (resp.ok) return resp.json();
    lastError = await resp.text();
  }

  throw new Error(lastError || "Notion query failed");
}

async function listManagerTasks(env) {
  const notionVersion = env.NOTION_VERSION || "2025-09-03";
  const notionToken = env.NOTION_TOKEN || "";
  const dbId = env.MANAGER_TASKS_DB_ID || DEFAULT_MANAGER_TASKS_DB_ID;

  if (!notionToken) {
    return { source: "fallback", warning: "NOTION_TOKEN no configurado.", data: [] };
  }

  try {
    const payload = await notionQuery(
      dbId,
      notionToken,
      notionVersion,
      { property: "Name", title: { contains: TASK_PREFIX } },
      10
    );

    const data = (payload.results || []).map((page) => {
      const props = page.properties || {};
      const status = props?.Estatus?.select?.name || "Pendiente";
      const dueDate = props?.["Date (ToDo)"]?.date?.start || "";
      const tags = (props?.Tags?.multi_select || []).map((t) => t?.name).filter(Boolean);
      const assigneeTag = tags.find((t) => t.startsWith("assignee:")) || "";
      return {
        id: page.id,
        title: normalizeTaskTitle(readNotionTitle(props)),
        assignee: assigneeTag.replace(/^assignee:/, ""),
        status,
        dueDate,
      };
    });

    return { source: "notion", data };
  } catch (e) {
    return { source: "error", error: "Tasks query failed", details: String(e?.message || e), data: [] };
  }
}

async function createManagerTask(env, body) {
  const notionVersion = env.NOTION_VERSION || "2025-09-03";
  const notionToken = env.NOTION_TOKEN || "";
  const dbId = env.MANAGER_TASKS_DB_ID || DEFAULT_MANAGER_TASKS_DB_ID;

  if (!notionToken) return { error: "NOTION_TOKEN missing" };
  const title = String(body?.title || "").trim();
  if (!title) return { error: "title is required" };

  const assignee = String(body?.assignee || "").trim();
  const dueDate = String(body?.dueDate || "").trim();

  const properties = {
    Name: { title: [{ text: { content: `${TASK_PREFIX}${title}` } }] },
    Estatus: { select: { name: "Empezó" } },
    Prioridad: { select: { name: "Alta" } },
    Tipo: { select: { name: "Music Knobs" } },
  };
  if (dueDate) properties["Date (ToDo)"] = { date: { start: dueDate } };
  if (assignee) properties.Tags = { multi_select: [{ name: `assignee:${assignee}` }] };

  const parentShapes = [{ data_source_id: dbId }, { database_id: dbId }];
  let lastError = "";

  for (const parent of parentShapes) {
    const resp = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": notionVersion,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ parent, properties }),
    });

    if (resp.ok) {
      const page = await resp.json();
      return { ok: true, id: page.id };
    }

    lastError = await resp.text();
  }

  return { error: "Task create failed", details: lastError };
}

async function updateManagerTask(env, taskId, body) {
  const notionVersion = env.NOTION_VERSION || "2025-09-03";
  const notionToken = env.NOTION_TOKEN || "";
  if (!notionToken) return { error: "NOTION_TOKEN missing" };

  const status = String(body?.status || "").trim() || "Terminado";

  const resp = await fetch(`https://api.notion.com/v1/pages/${taskId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${notionToken}`,
      "Notion-Version": notionVersion,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: {
        Estatus: { select: { name: status } },
      },
    }),
  });

  if (!resp.ok) {
    return { error: "Task update failed", details: await resp.text() };
  }

  return { ok: true };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (url.pathname === "/health") {
      return json({ ok: true, service: "manager-app-proxy", provider: "cloudflare-workers" });
    }

    if (request.method === "GET" && url.pathname === "/api/manager/contacts") {
      const result = await queryNotionContacts(env);
      return json(result, result.error ? 502 : 200);
    }

    if (request.method === "GET" && url.pathname === "/api/manager/catalog") {
      return json({ source: "sample", data: SAMPLE_CATALOG });
    }

    if (request.method === "GET" && url.pathname === "/api/manager/tasks") {
      const result = await listManagerTasks(env);
      return json(result, result.error ? 502 : 200);
    }

    if (request.method === "POST" && url.pathname === "/api/manager/tasks") {
      const body = await request.json().catch(() => ({}));
      const result = await createManagerTask(env, body);
      return json(result, result.error ? 400 : 201);
    }

    if (request.method === "PATCH" && url.pathname.startsWith("/api/manager/tasks/")) {
      const taskId = url.pathname.replace("/api/manager/tasks/", "").trim();
      if (!taskId) return json({ error: "taskId required" }, 400);
      const body = await request.json().catch(() => ({}));
      const result = await updateManagerTask(env, taskId, body);
      return json(result, result.error ? 400 : 200);
    }

    if (!["GET", "POST", "PATCH"].includes(request.method)) {
      return json({ error: "Method not allowed" }, 405);
    }

    return json({ error: "Not found", path: url.pathname }, 404);
  },
};
