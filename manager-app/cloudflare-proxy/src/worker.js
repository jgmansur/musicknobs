const SAMPLE_CATALOG = [
  { obra: "Tema Demo 1", autores: "Jay Mansur", generos: "Regional Mexicano", drive: "#" },
  { obra: "Tema Demo 2", autores: "Jay Mansur, Alejandro De Nigris", generos: "Pop", drive: "#" },
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    if (request.method !== "GET") {
      return json({ error: "Method not allowed" }, 405);
    }

    if (url.pathname === "/health") {
      return json({ ok: true, service: "manager-app-proxy", provider: "cloudflare-workers" });
    }

    if (url.pathname === "/api/manager/contacts") {
      const result = await queryNotionContacts(env);
      return json(result, result.error ? 502 : 200);
    }

    if (url.pathname === "/api/manager/catalog") {
      return json({ source: "sample", data: SAMPLE_CATALOG });
    }

    return json({ error: "Not found", path: url.pathname }, 404);
  },
};
