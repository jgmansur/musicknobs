const SAMPLE_CATALOG = [
  { obra: "Tema Demo 1", autores: "Jay Mansur", generos: "Regional Mexicano", drive: "#" },
  { obra: "Tema Demo 2", autores: "Jay Mansur, Alejandro De Nigris", generos: "Pop", drive: "#" },
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

const DEFAULT_MANAGER_TASKS_DB_ID = "6405719e-5f90-4fc0-8eab-d9352387dd07";
const DEFAULT_SOCIAL_LINKS_DB_ID = "761cbab4-0fef-4aad-aa99-d3aa5e47025c";
const TASK_PREFIX = "[ManagerTask] ";
const MESSAGE_PREFIX = "[ManagerMsg] ";
const SUBTASK_PREFIX = "subtask:";
const ASSIGNEE_PREFIX = "assignee:";
const ASSIGNEE_NAME_PREFIX = "assigneeName:";
const AUTHOR_PREFIX = "author:";
const AUTHOR_EMAIL_PREFIX = "authorEmail:";
const ADMIN_EMAILS = ["jgmansur2@gmail.com"];
const CLEAR_LOG_PASSWORD = "9776";
const DEFAULT_MANAGER_USERS = [
  { email: "jgmansur2@gmail.com", name: "Jay Mansur" },
  { email: "xeronimo3@gmail.com", name: "Xeronimo" },
  { email: "ricardo.calanda@gmail.com", name: "Ricardo" },
];

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

function normalizeMessageText(raw) {
  return String(raw || "").replace(MESSAGE_PREFIX, "").trim();
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

function readNotionUrl(props) {
  for (const [name, prop] of Object.entries(props)) {
    const key = name.toLowerCase();
    if (!["url", "link", "perfil", "profile", "sitio", "web"].some((k) => key.includes(k))) continue;
    if (prop?.type === "url") return prop.url || "";
    if (prop?.type === "rich_text") return richTextToString(prop.rich_text);
  }
  return "";
}

function readNotionLinkLabel(props) {
  const fromTitle = readNotionTitle(props);
  if (fromTitle) return fromTitle;

  for (const [name, prop] of Object.entries(props)) {
    const key = name.toLowerCase();
    if (!["red", "network", "nombre", "name", "plataforma", "handle"].some((k) => key.includes(k))) continue;
    if (prop?.type === "select") return prop.select?.name || "";
    if (prop?.type === "rich_text") return richTextToString(prop.rich_text);
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
  return notionQueryAdvanced(dbOrDataSourceId, notionToken, notionVersion, { filter, pageSize });
}

async function notionQueryAdvanced(dbOrDataSourceId, notionToken, notionVersion, options = {}) {
  const endpoints = [
    `https://api.notion.com/v1/data_sources/${dbOrDataSourceId}/query`,
    `https://api.notion.com/v1/databases/${dbOrDataSourceId}/query`,
  ];

  let lastError = "";
  for (const url of endpoints) {
    const body = {
      page_size: Number(options.pageSize || 100),
      sorts: [{ timestamp: "last_edited_time", direction: "descending" }],
    };
    if (options.filter) body.filter = options.filter;
    if (options.startCursor) body.start_cursor = options.startCursor;
    if (Array.isArray(options.sorts) && options.sorts.length) body.sorts = options.sorts;

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

function parseManagerUsers(env) {
  const raw = String(env.MANAGER_ALLOWED_USERS || "").trim();
  if (!raw) return DEFAULT_MANAGER_USERS;

  const parsed = raw
    .split(",")
    .map((part) => {
      const entry = part.trim();
      if (!entry) return null;
      if (entry.includes("|")) {
        const [emailRaw, nameRaw] = entry.split("|");
        const email = String(emailRaw || "").trim().toLowerCase();
        const name = String(nameRaw || "").trim() || email;
        if (!email) return null;
        return { email, name };
      }
      const email = entry.toLowerCase();
      if (!email) return null;
      return { email, name: email };
    })
    .filter(Boolean);

  return parsed.length ? parsed : DEFAULT_MANAGER_USERS;
}

function parseAssigneeFromTags(tags = []) {
  const emailTag = tags.find((t) => t.startsWith(ASSIGNEE_PREFIX)) || "";
  const nameTag = tags.find((t) => t.startsWith(ASSIGNEE_NAME_PREFIX)) || "";
  const email = emailTag.replace(/^assignee:/, "").trim().toLowerCase();
  const name = nameTag.replace(/^assigneeName:/, "").trim();
  return {
    assigneeEmail: email,
    assigneeName: name || email,
  };
}

function applyAssigneeTags(tags = [], assigneeEmail = "", assigneeName = "") {
  const withoutAssignee = tags.filter((t) => !t.startsWith(ASSIGNEE_PREFIX) && !t.startsWith(ASSIGNEE_NAME_PREFIX));
  if (!assigneeEmail) return withoutAssignee;
  const next = [...withoutAssignee, `${ASSIGNEE_PREFIX}${assigneeEmail}`];
  if (assigneeName) next.push(`${ASSIGNEE_NAME_PREFIX}${assigneeName}`);
  return next;
}

async function notionGetPageChildren(pageId, notionToken, notionVersion) {
  let cursor = null;
  const out = [];

  while (true) {
    const params = new URLSearchParams({ page_size: "100" });
    if (cursor) params.set("start_cursor", cursor);
    const resp = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children?${params.toString()}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": notionVersion,
      },
    });

    if (!resp.ok) {
      throw new Error(await resp.text());
    }

    const payload = await resp.json();
    out.push(...(payload.results || []));
    if (!payload.has_more || !payload.next_cursor) break;
    cursor = payload.next_cursor;
  }

  return out;
}

async function replaceSubtasks(pageId, notionToken, notionVersion, subtasks = []) {
  const children = await notionGetPageChildren(pageId, notionToken, notionVersion);
  const existing = children.filter((b) => b?.type === "to_do" && richTextToString(b?.to_do?.rich_text || []).startsWith(SUBTASK_PREFIX));

  for (const block of existing) {
    const resp = await fetch(`https://api.notion.com/v1/blocks/${block.id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": notionVersion,
      },
    });
    if (!resp.ok) throw new Error(await resp.text());
  }

  if (!subtasks.length) return;

  const childBlocks = subtasks.map((st) => ({
    object: "block",
    type: "to_do",
    to_do: {
      checked: Boolean(st.done),
      rich_text: [{ type: "text", text: { content: `${SUBTASK_PREFIX}${String(st.title || "").trim()}` } }],
    },
  }));

  const resp = await fetch(`https://api.notion.com/v1/blocks/${pageId}/children`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${notionToken}`,
      "Notion-Version": notionVersion,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ children: childBlocks }),
  });

  if (!resp.ok) throw new Error(await resp.text());
}

function parseSubtasksFromBlocks(blocks = []) {
  return blocks
    .filter((b) => b?.type === "to_do")
    .map((b) => {
      const raw = richTextToString(b?.to_do?.rich_text || []);
      if (!raw.startsWith(SUBTASK_PREFIX)) return null;
      return {
        title: raw.replace(SUBTASK_PREFIX, "").trim(),
        done: Boolean(b?.to_do?.checked),
      };
    })
    .filter(Boolean);
}

async function listManagerTasks(env, options = {}) {
  const notionVersion = env.NOTION_VERSION || "2025-09-03";
  const notionToken = env.NOTION_TOKEN || "";
  const dbId = env.MANAGER_TASKS_DB_ID || DEFAULT_MANAGER_TASKS_DB_ID;

  if (!notionToken) {
    return { source: "fallback", warning: "NOTION_TOKEN no configurado.", data: [] };
  }

  try {
    const limit = Math.max(1, Math.min(50, Number(options.limit || 10)));
    const viewerEmail = String(options.viewerEmail || "").trim().toLowerCase();
    const scope = String(options.scope || "all").toLowerCase();
    const startCursor = String(options.cursor || "").trim() || undefined;
    const allUsers = parseManagerUsers(env);

    const baseFilter = { property: "Name", title: { contains: TASK_PREFIX } };
    const filter = scope === "mine" && viewerEmail
      ? {
          and: [
            baseFilter,
            {
              property: "Tags",
              multi_select: { contains: `${ASSIGNEE_PREFIX}${viewerEmail}` },
            },
          ],
        }
      : baseFilter;

    const payload = await notionQueryAdvanced(dbId, notionToken, notionVersion, {
      filter,
      pageSize: limit,
      startCursor,
    });

    const data = await Promise.all((payload.results || []).map(async (page) => {
      const props = page.properties || {};
      const status = props?.Estatus?.select?.name || "Pendiente";
      const dueDate = props?.["Date (ToDo)"]?.date?.start || "";
      const tags = (props?.Tags?.multi_select || []).map((t) => t?.name).filter(Boolean);
      const assignee = parseAssigneeFromTags(tags);
      const subtaskBlocks = await notionGetPageChildren(page.id, notionToken, notionVersion);
      const subtasks = parseSubtasksFromBlocks(subtaskBlocks);

      return {
        id: page.id,
        title: normalizeTaskTitle(readNotionTitle(props)),
        assignee: assignee.assigneeName || assignee.assigneeEmail || "",
        assigneeEmail: assignee.assigneeEmail || "",
        status,
        dueDate,
        subtasks,
        subtaskCount: subtasks.length,
      };
    }));

    return {
      source: "notion",
      data,
      users: allUsers,
      pagination: {
        nextCursor: payload.next_cursor || null,
        hasMore: Boolean(payload.has_more),
      },
    };
  } catch (e) {
    return { source: "error", error: "Tasks query failed", details: String(e?.message || e), data: [] };
  }
}

async function listSocialLinks(env) {
  const notionVersion = env.NOTION_VERSION || "2025-09-03";
  const notionToken = env.NOTION_TOKEN || "";
  const dbId = env.MANAGER_SOCIAL_LINKS_DB_ID || DEFAULT_SOCIAL_LINKS_DB_ID;

  if (!notionToken) {
    return { source: "fallback", warning: "NOTION_TOKEN no configurado.", data: [] };
  }

  try {
    const payload = await notionQuery(dbId, notionToken, notionVersion, null, 100);
    const data = (payload.results || [])
      .map((page, index) => {
        const props = page.properties || {};
        const name = readNotionLinkLabel(props) || `Link ${index + 1}`;
        const url = readNotionUrl(props);
        return { name, url };
      })
      .filter((item) => Boolean(item.url));

    return { source: "notion", data };
  } catch (e) {
    return { source: "error", error: "Social links query failed", details: String(e?.message || e), data: [] };
  }
}

function getTagNames(props) {
  return (props?.Tags?.multi_select || []).map((t) => t?.name).filter(Boolean);
}

function parseMessageAuthor(tags = []) {
  const hit = tags.find((t) => t.startsWith(AUTHOR_PREFIX)) || "";
  return hit.replace(/^author:/, "").trim();
}

function parseMessageAuthorEmail(tags = []) {
  const hit = tags.find((t) => t.startsWith(AUTHOR_EMAIL_PREFIX)) || "";
  return hit.replace(/^authorEmail:/, "").trim().toLowerCase();
}

function parseMessageFeatured(tags = []) {
  return tags.includes("featured:true");
}

function applyMessageTagState(tags = [], highlighted = false) {
  const withoutFeatured = tags.filter((t) => t !== "featured:true");
  return highlighted ? [...withoutFeatured, "featured:true"] : withoutFeatured;
}

async function listManagerMessages(env) {
  const notionVersion = env.NOTION_VERSION || "2025-09-03";
  const notionToken = env.NOTION_TOKEN || "";
  const dbId = env.MANAGER_MESSAGES_DB_ID || DEFAULT_MANAGER_TASKS_DB_ID;

  if (!notionToken) {
    return { source: "fallback", warning: "NOTION_TOKEN no configurado.", data: [] };
  }

  try {
    const payload = await notionQuery(
      dbId,
      notionToken,
      notionVersion,
      { property: "Name", title: { contains: MESSAGE_PREFIX } },
      40
    );

    const data = (payload.results || []).map((page) => {
      const props = page.properties || {};
      const tags = getTagNames(props);
      return {
        id: page.id,
        text: normalizeMessageText(readNotionTitle(props)),
        author: parseMessageAuthor(tags),
        authorEmail: parseMessageAuthorEmail(tags),
        highlighted: parseMessageFeatured(tags),
        createdAt: page.created_time,
        tags,
      };
    });

    return { source: "notion", data };
  } catch (e) {
    return { source: "error", error: "Messages query failed", details: String(e?.message || e), data: [] };
  }
}

async function createManagerMessage(env, body) {
  const notionVersion = env.NOTION_VERSION || "2025-09-03";
  const notionToken = env.NOTION_TOKEN || "";
  const dbId = env.MANAGER_MESSAGES_DB_ID || DEFAULT_MANAGER_TASKS_DB_ID;

  if (!notionToken) return { error: "NOTION_TOKEN missing" };
  const text = String(body?.text || "").trim();
  if (!text) return { error: "text is required" };

  const author = String(body?.author || "Anónimo").trim() || "Anónimo";
  const authorEmail = String(body?.authorEmail || "").trim().toLowerCase();

  const properties = {
    Name: { title: [{ text: { content: `${MESSAGE_PREFIX}${text}` } }] },
    Estatus: { select: { name: "Empezó" } },
    Prioridad: { select: { name: "Alta" } },
    Tipo: { select: { name: "Music Knobs" } },
    Tags: {
      multi_select: [
        { name: "kind:manager-msg" },
        { name: `${AUTHOR_PREFIX}${author}` },
        ...(authorEmail ? [{ name: `${AUTHOR_EMAIL_PREFIX}${authorEmail}` }] : []),
      ],
    },
  };

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

  return { error: "Message create failed", details: lastError };
}

async function updateManagerMessage(env, messageId, body) {
  const notionVersion = env.NOTION_VERSION || "2025-09-03";
  const notionToken = env.NOTION_TOKEN || "";
  if (!notionToken) return { error: "NOTION_TOKEN missing" };

  const highlighted = Boolean(body?.highlighted);

  const pageResp = await fetch(`https://api.notion.com/v1/pages/${messageId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${notionToken}`,
      "Notion-Version": notionVersion,
      "Content-Type": "application/json",
    },
  });

  if (!pageResp.ok) {
    return { error: "Message lookup failed", details: await pageResp.text() };
  }

  const page = await pageResp.json();
  const props = page.properties || {};
  const currentTags = getTagNames(props);
  const currentlyHighlighted = parseMessageFeatured(currentTags);

  if (highlighted && !currentlyHighlighted) {
    const listed = await listManagerMessages(env);
    const featured = (listed.data || [])
      .filter((m) => m.highlighted && m.id !== messageId)
      .sort((a, b) => new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime());

    if (featured.length >= 3) {
      const toUnfeature = featured[0];
      const unfeatureResp = await fetch(`https://api.notion.com/v1/pages/${toUnfeature.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${notionToken}`,
          "Notion-Version": notionVersion,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          properties: {
            Tags: {
              multi_select: (Array.isArray(toUnfeature.tags) ? toUnfeature.tags : [])
                .filter((t) => t !== "featured:true")
                .map((name) => ({ name })),
            },
          },
        }),
      });

      if (!unfeatureResp.ok) {
        return { error: "No se pudo rotar mensajes destacados", details: await unfeatureResp.text() };
      }
    }
  }

  const nextTags = applyMessageTagState(currentTags, highlighted);
  const resp = await fetch(`https://api.notion.com/v1/pages/${messageId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${notionToken}`,
      "Notion-Version": notionVersion,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      properties: {
        Tags: { multi_select: nextTags.map((name) => ({ name })) },
      },
    }),
  });

  if (!resp.ok) {
    return { error: "Message update failed", details: await resp.text() };
  }

  return { ok: true };
}

async function clearManagerMessages(env, body) {
  const notionVersion = env.NOTION_VERSION || "2025-09-03";
  const notionToken = env.NOTION_TOKEN || "";
  const dbId = env.MANAGER_MESSAGES_DB_ID || DEFAULT_MANAGER_TASKS_DB_ID;
  if (!notionToken) return { error: "NOTION_TOKEN missing" };

  const password = String(body?.password || "").trim();
  if (password !== CLEAR_LOG_PASSWORD) return { error: "Password incorrecto" };

  const requesterEmail = String(body?.requesterEmail || "").trim().toLowerCase();
  if (requesterEmail && !ADMIN_EMAILS.includes(requesterEmail)) {
    return { error: "Solo admin puede borrar el log" };
  }

  try {
    const listed = await notionQuery(dbId, notionToken, notionVersion, { property: "Name", title: { contains: MESSAGE_PREFIX } }, 100);
    const pages = listed.results || [];
    for (const page of pages) {
      const resp = await fetch(`https://api.notion.com/v1/pages/${page.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${notionToken}`,
          "Notion-Version": notionVersion,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ archived: true }),
      });
      if (!resp.ok) return { error: "No se pudo borrar log", details: await resp.text() };
    }
    return { ok: true, deleted: pages.length };
  } catch (e) {
    return { error: "No se pudo borrar log", details: String(e?.message || e) };
  }
}

async function createManagerTask(env, body) {
  const notionVersion = env.NOTION_VERSION || "2025-09-03";
  const notionToken = env.NOTION_TOKEN || "";
  const dbId = env.MANAGER_TASKS_DB_ID || DEFAULT_MANAGER_TASKS_DB_ID;

  if (!notionToken) return { error: "NOTION_TOKEN missing" };
  const title = String(body?.title || "").trim();
  if (!title) return { error: "title is required" };

  const assigneeRaw = String(body?.assignee || "").trim().toLowerCase();
  const dueDate = String(body?.dueDate || "").trim();
  const subtasks = Array.isArray(body?.subtasks)
    ? body.subtasks
        .map((s) => ({ title: String(s?.title || "").trim(), done: Boolean(s?.done) }))
        .filter((s) => s.title)
        .slice(0, 30)
    : [];
  const users = parseManagerUsers(env);
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  const assigneeUser = assigneeRaw ? userByEmail.get(assigneeRaw) : null;
  const assignee = assigneeUser?.email || "";

  const properties = {
    Name: { title: [{ text: { content: `${TASK_PREFIX}${title}` } }] },
    Estatus: { select: { name: "Empezó" } },
    Prioridad: { select: { name: "Alta" } },
    Tipo: { select: { name: "Music Knobs" } },
  };
  if (dueDate) properties["Date (ToDo)"] = { date: { start: dueDate } };
  if (assignee) {
    const tags = [`${ASSIGNEE_PREFIX}${assignee}`];
    if (assigneeUser?.name) tags.push(`${ASSIGNEE_NAME_PREFIX}${assigneeUser.name}`);
    properties.Tags = { multi_select: tags.map((name) => ({ name })) };
  }

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
      if (subtasks.length) {
        try {
          await replaceSubtasks(page.id, notionToken, notionVersion, subtasks);
        } catch (e) {
          return { error: "Task create failed", details: String(e?.message || e) };
        }
      }
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

  const status = String(body?.status || "").trim();
  const title = String(body?.title || "").trim();
  const dueDate = typeof body?.dueDate === "string" ? body.dueDate.trim() : null;
  const assigneeRaw = String(body?.assignee || "").trim().toLowerCase();
  const hasSubtasks = Array.isArray(body?.subtasks);
  const subtasks = hasSubtasks
    ? body.subtasks
        .map((s) => ({ title: String(s?.title || "").trim(), done: Boolean(s?.done) }))
        .filter((s) => s.title)
        .slice(0, 30)
    : [];

  const pageResp = await fetch(`https://api.notion.com/v1/pages/${taskId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${notionToken}`,
      "Notion-Version": notionVersion,
      "Content-Type": "application/json",
    },
  });
  if (!pageResp.ok) return { error: "Task lookup failed", details: await pageResp.text() };

  const page = await pageResp.json();
  const props = page.properties || {};
  const currentTags = getTagNames(props);

  const properties = {};
  if (status) properties.Estatus = { select: { name: status } };
  if (title) properties.Name = { title: [{ text: { content: `${TASK_PREFIX}${title}` } }] };

  if (dueDate !== null) {
    properties["Date (ToDo)"] = dueDate ? { date: { start: dueDate } } : { date: null };
  }

  if (assigneeRaw || body?.assignee === "") {
    const users = parseManagerUsers(env);
    const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
    const assigneeUser = assigneeRaw ? userByEmail.get(assigneeRaw) : null;
    const nextTags = applyAssigneeTags(currentTags, assigneeUser?.email || "", assigneeUser?.name || "");
    properties.Tags = { multi_select: nextTags.map((name) => ({ name })) };
  }

  if (Object.keys(properties).length) {
    const resp = await fetch(`https://api.notion.com/v1/pages/${taskId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": notionVersion,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ properties }),
    });

    if (!resp.ok) return { error: "Task update failed", details: await resp.text() };
  }

  if (hasSubtasks) {
    try {
      await replaceSubtasks(taskId, notionToken, notionVersion, subtasks);
    } catch (e) {
      return { error: "Task update failed", details: String(e?.message || e) };
    }
  }

  return { ok: true };
}

async function deleteManagerTask(env, taskId) {
  const notionVersion = env.NOTION_VERSION || "2025-09-03";
  const notionToken = env.NOTION_TOKEN || "";
  if (!notionToken) return { error: "NOTION_TOKEN missing" };

  const resp = await fetch(`https://api.notion.com/v1/pages/${taskId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${notionToken}`,
      "Notion-Version": notionVersion,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ archived: true }),
  });

  if (!resp.ok) return { error: "Task delete failed", details: await resp.text() };
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
      const result = await listManagerTasks(env, {
        limit: url.searchParams.get("limit") || "10",
        cursor: url.searchParams.get("cursor") || "",
        scope: url.searchParams.get("scope") || "all",
        viewerEmail: url.searchParams.get("viewer") || "",
      });
      return json(result, result.error ? 502 : 200);
    }

    if (request.method === "GET" && url.pathname === "/api/manager/messages") {
      const result = await listManagerMessages(env);
      return json(result, result.error ? 502 : 200);
    }

    if (request.method === "GET" && url.pathname === "/api/manager/social-links") {
      const result = await listSocialLinks(env);
      return json(result, result.error ? 502 : 200);
    }

    if (request.method === "POST" && url.pathname === "/api/manager/tasks") {
      const body = await request.json().catch(() => ({}));
      const result = await createManagerTask(env, body);
      return json(result, result.error ? 400 : 201);
    }

    if (request.method === "POST" && url.pathname === "/api/manager/messages") {
      const body = await request.json().catch(() => ({}));
      const result = await createManagerMessage(env, body);
      return json(result, result.error ? 400 : 201);
    }

    if (request.method === "POST" && url.pathname === "/api/manager/messages/clear") {
      const body = await request.json().catch(() => ({}));
      const result = await clearManagerMessages(env, body);
      return json(result, result.error ? 400 : 200);
    }

    if (request.method === "PATCH" && url.pathname.startsWith("/api/manager/tasks/")) {
      const taskId = url.pathname.replace("/api/manager/tasks/", "").trim();
      if (!taskId) return json({ error: "taskId required" }, 400);
      const body = await request.json().catch(() => ({}));
      const result = await updateManagerTask(env, taskId, body);
      return json(result, result.error ? 400 : 200);
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/api/manager/tasks/")) {
      const taskId = url.pathname.replace("/api/manager/tasks/", "").trim();
      if (!taskId) return json({ error: "taskId required" }, 400);
      const result = await deleteManagerTask(env, taskId);
      return json(result, result.error ? 400 : 200);
    }

    if (request.method === "PATCH" && url.pathname.startsWith("/api/manager/messages/")) {
      const messageId = url.pathname.replace("/api/manager/messages/", "").trim();
      if (!messageId) return json({ error: "messageId required" }, 400);
      const body = await request.json().catch(() => ({}));
      const result = await updateManagerMessage(env, messageId, body);
      return json(result, result.error ? 400 : 200);
    }

    if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method)) {
      return json({ error: "Method not allowed" }, 405);
    }

    return json({ error: "Not found", path: url.pathname }, 404);
  },
};
