const SAMPLE_CATALOG = [
  { obra: "Tema Demo 1", autores: "Jay Mansur", generos: "Regional Mexicano", drive: "", fileId: "", cover: "" },
  { obra: "Tema Demo 2", autores: "Jay Mansur, Alejandro De Nigris", generos: "Pop", drive: "", fileId: "", cover: "" },
];

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
};

const DEFAULT_MANAGER_TASKS_DB_ID = "6405719e-5f90-4fc0-8eab-d9352387dd07";
const DEFAULT_SOCIAL_LINKS_DB_ID = "761cbab4-0fef-4aad-aa99-d3aa5e47025c";
const DEFAULT_CATALOG_DB_ID = "348c1932-ede8-80a1-a852-000b7e0cc2b4";
const DEFAULT_MANAGER_CONTACTS_DB_ID = "349c1932-ede8-80c2-a457-000b79e7eae0";
const DEFAULT_DRIVE_CATALOG_FOLDER_ID = "1y6RhTb3JnAGQJ8mTcJglr1aeeFYeStbq";
const CATALOG_AUTOSYNC_TAG = "Catalog AutoSync";
const TASK_PREFIX = "[ManagerTask] ";
const MESSAGE_PREFIX = "[ManagerMsg] ";
const PLAYLIST_PREFIX = "[ManagerPlaylist] ";
const PLAYLIST_TRACK_PREFIX = "playlist-track:";
const PLAYLIST_OWNER_PREFIX = "playlist-owner:";
const SUBTASK_PREFIX = "subtask:";
const ASSIGNEE_PREFIX = "assignee:";
const ASSIGNEE_NAME_PREFIX = "assigneeName:";
const AUTHOR_PREFIX = "author:";
const AUTHOR_EMAIL_PREFIX = "authorEmail:";
const TASK_ASSIGNEES_PROPERTY = "Asignar Usuarios";
const TASK_ASSIGNEES_PROPERTY_LEGACY = "Asignar Usuario";
const TASK_SHOW_IN_MANAGER_PROPERTY = "Mostrar en Manager App";
const TASK_FOCUS_ONLY_PROPERTY = "Focus Only";
const ADMIN_EMAILS = ["jgmansur2@gmail.com"];
const CLEAR_LOG_PASSWORD = "9776";
const OWNER_EMAIL = "jgmansur2@gmail.com";
const MESSAGE_DEFAULTS = Object.freeze({
  status: "Ideas por checar",
  priority: "-",
});
const TASK_DEFAULTS = Object.freeze({
  status: "Empezó",
  priority: "Alta",
});
const DEFAULT_MANAGER_USERS = [
  { email: OWNER_EMAIL, name: "Jay Mansur" },
  { email: "xeronimo3@gmail.com", name: "Xeronimo" },
  { email: "ricardo.calanda@gmail.com", name: "Ricardo" },
];

let driveAccessTokenCache = {
  token: "",
  expiresAt: 0,
};

const focusTasksCache = new Map();
const FOCUS_CACHE_TTL_MS = 45_000;

function makeFocusCacheKey(options = {}) {
  const scope = String(options.scope || "all").trim().toLowerCase();
  const viewerEmail = String(options.viewerEmail || "").trim().toLowerCase();
  return `${scope}::${viewerEmail}`;
}

function getCachedFocusTasks(options = {}) {
  const key = makeFocusCacheKey(options);
  const hit = focusTasksCache.get(key);
  if (!hit) return null;
  if (Date.now() >= Number(hit.expiresAt || 0)) {
    focusTasksCache.delete(key);
    return null;
  }
  return hit.value || null;
}

function setCachedFocusTasks(options = {}, value = null) {
  const key = makeFocusCacheKey(options);
  focusTasksCache.set(key, {
    value,
    expiresAt: Date.now() + FOCUS_CACHE_TTL_MS,
  });
}

function clearFocusTasksCache() {
  focusTasksCache.clear();
}

function resolveTaskStatusByAssignee(assigneeEmail) {
  const email = String(assigneeEmail || "").trim().toLowerCase();
  if (!email) return TASK_DEFAULTS.status;
  return email === OWNER_EMAIL ? "Empezó" : "Pendiente";
}

function base64UrlEncode(input) {
  const bytes = input instanceof Uint8Array ? input : new TextEncoder().encode(String(input || ""));
  let str = "";
  for (let i = 0; i < bytes.length; i += 1) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function parseDriveServiceAccount(env) {
  const b64 = String(env.DRIVE_SERVICE_ACCOUNT_JSON_BASE64 || "").trim();
  if (b64) {
    try {
      return JSON.parse(atob(b64));
    } catch {
      throw new Error("DRIVE_SERVICE_ACCOUNT_JSON_BASE64 inválido");
    }
  }

  const clientEmail = String(env.DRIVE_SERVICE_ACCOUNT_CLIENT_EMAIL || "").trim();
  const privateKey = String(env.DRIVE_SERVICE_ACCOUNT_PRIVATE_KEY || "").replace(/\\n/g, "\n").trim();
  if (!clientEmail || !privateKey) {
    throw new Error("Faltan credenciales de service account para Google Drive");
  }
  return {
    client_email: clientEmail,
    private_key: privateKey,
    token_uri: "https://oauth2.googleapis.com/token",
  };
}

async function importPrivateKey(pem) {
  const cleanPem = String(pem || "")
    .replace("-----BEGIN PRIVATE KEY-----", "")
    .replace("-----END PRIVATE KEY-----", "")
    .replace(/\s+/g, "");
  const binary = atob(cleanPem);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return crypto.subtle.importKey(
    "pkcs8",
    bytes.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function getDriveAccessToken(env) {
  if (driveAccessTokenCache.token && Date.now() < driveAccessTokenCache.expiresAt - 30_000) {
    return driveAccessTokenCache.token;
  }

  const serviceAccount = parseDriveServiceAccount(env);
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: "RS256", typ: "JWT" };
  const payload = {
    iss: serviceAccount.client_email,
    scope: "https://www.googleapis.com/auth/drive.readonly",
    aud: serviceAccount.token_uri || "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };

  const encodedHeader = base64UrlEncode(JSON.stringify(header));
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const toSign = `${encodedHeader}.${encodedPayload}`;
  const key = await importPrivateKey(serviceAccount.private_key);
  const signatureBuffer = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(toSign));
  const assertion = `${toSign}.${base64UrlEncode(new Uint8Array(signatureBuffer))}`;

  const tokenResp = await fetch(serviceAccount.token_uri || "https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    }).toString(),
  });

  if (!tokenResp.ok) {
    throw new Error(`No se pudo obtener token de Drive (${tokenResp.status})`);
  }

  const tokenPayload = await tokenResp.json();
  const accessToken = String(tokenPayload.access_token || "");
  const expiresIn = Number(tokenPayload.expires_in || 3600);
  if (!accessToken) throw new Error("Token de Drive vacío");

  driveAccessTokenCache = {
    token: accessToken,
    expiresAt: Date.now() + Math.max(60, expiresIn) * 1000,
  };
  return accessToken;
}

function isValidDriveFileId(fileId) {
  return /^[a-zA-Z0-9_-]{20,}$/.test(String(fileId || ""));
}

function extractDriveFileId(value) {
  const input = String(value || "").trim();
  if (!input) return "";
  if (isValidDriveFileId(input)) return input;

  try {
    const parsed = new URL(input);
    if (!parsed.hostname.includes("google.com")) return "";
    const pathMatch = parsed.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]{20,})/);
    if (pathMatch?.[1]) return pathMatch[1];
    const q = parsed.searchParams.get("id");
    return isValidDriveFileId(q) ? q : "";
  } catch {
    return "";
  }
}

async function streamDriveAudioFile(fileId, request, env) {
  if (!isValidDriveFileId(fileId)) {
    return json({ error: "fileId inválido" }, 400);
  }

  try {
    const token = await getDriveAccessToken(env);
    const metaResp = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?fields=id,name,mimeType,size,capabilities/canDownload&supportsAllDrives=true`,
      {
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (!metaResp.ok) {
      const status = metaResp.status === 404 ? 404 : 403;
      return json({ error: "No se pudo validar el archivo en Drive", status: metaResp.status }, status);
    }

    const metadata = await metaResp.json();
    const canDownload = Boolean(metadata?.capabilities?.canDownload);
    if (!canDownload) {
      return json({ error: "El archivo no permite descarga" }, 403);
    }

    const reqHeaders = new Headers({ Authorization: `Bearer ${token}` });
    const range = request.headers.get("Range");
    if (range) reqHeaders.set("Range", range);

    const mediaResp = await fetch(
      `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media&supportsAllDrives=true`,
      { headers: reqHeaders },
    );

    if (!mediaResp.ok) {
      const status = mediaResp.status === 404 ? 404 : 502;
      return json({ error: "Drive no devolvió el audio", status: mediaResp.status }, status);
    }

    const responseHeaders = new Headers();
    responseHeaders.set("Access-Control-Allow-Origin", "*");
    responseHeaders.set("Access-Control-Allow-Methods", "GET,OPTIONS");
    responseHeaders.set("Access-Control-Allow-Headers", "Range,Authorization,Content-Type");
    responseHeaders.set("Accept-Ranges", mediaResp.headers.get("Accept-Ranges") || "bytes");
    responseHeaders.set("Cache-Control", "private, max-age=60");
    responseHeaders.set(
      "Content-Type",
      mediaResp.headers.get("Content-Type") || metadata?.mimeType || "application/octet-stream",
    );

    const forwardHeaders = ["Content-Length", "Content-Range", "ETag", "Last-Modified"];
    forwardHeaders.forEach((h) => {
      const v = mediaResp.headers.get(h);
      if (v) responseHeaders.set(h, v);
    });

    return new Response(mediaResp.body, {
      status: mediaResp.status,
      statusText: mediaResp.statusText,
      headers: responseHeaders,
    });
  } catch (e) {
    return json({ error: "Error interno al solicitar audio seguro", details: String(e?.message || e) }, 500);
  }
}

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

function readNotionInstagram(props) {
  for (const [name, prop] of Object.entries(props)) {
    const key = name.toLowerCase();
    if (!["instagram", "insta", "ig"].some((k) => key.includes(k))) continue;
    if (prop?.type === "url") return prop.url || "";
    if (prop?.type === "rich_text") return richTextToString(prop.rich_text);
  }
  return "";
}

function readNotionTiktok(props) {
  for (const [name, prop] of Object.entries(props)) {
    const key = name.toLowerCase();
    if (!["tiktok", "tik tok"].some((k) => key.includes(k))) continue;
    if (prop?.type === "url") return prop.url || "";
    if (prop?.type === "rich_text") return richTextToString(prop.rich_text);
  }
  return "";
}

function readNotionAddress(props) {
  for (const [name, prop] of Object.entries(props)) {
    const key = name.toLowerCase();
    if (!["direccion", "dirección", "address", "ubicacion", "ubicación"].some((k) => key.includes(k))) continue;
    if (prop?.type === "rich_text") return richTextToString(prop.rich_text);
    if (prop?.type === "select") return prop.select?.name || "";
    if (prop?.type === "url") return prop.url || "";
  }
  return "";
}

function readNotionSongAuthors(props) {
  for (const [name, prop] of Object.entries(props)) {
    const key = name.toLowerCase();
    if (!["autores", "autor", "composer", "compositor", "writers", "writer"].some((k) => key.includes(k))) continue;
    if (prop?.type === "multi_select") return (prop.multi_select || []).map((x) => x?.name).filter(Boolean).join(", ");
    if (prop?.type === "select") return prop.select?.name || "";
    if (prop?.type === "rich_text") return richTextToString(prop.rich_text);
    if (prop?.type === "title") return richTextToString(prop.title);
  }
  return "";
}

function readNotionSongGenres(props) {
  for (const [name, prop] of Object.entries(props)) {
    const key = name.toLowerCase();
    if (!["genero", "género", "genre", "genres"].some((k) => key.includes(k))) continue;
    if (prop?.type === "multi_select") return (prop.multi_select || []).map((x) => x?.name).filter(Boolean).join(", ");
    if (prop?.type === "select") return prop.select?.name || "";
    if (prop?.type === "rich_text") return richTextToString(prop.rich_text);
  }
  return "";
}

function readNotionSongUrl(props) {
  for (const [name, prop] of Object.entries(props)) {
    const key = name.toLowerCase();
    if (!["play", "drive", "dropbox", "audio", "url", "link"].some((k) => key.includes(k))) continue;
    if (prop?.type === "url" && prop.url) return prop.url;
    if (prop?.type === "rich_text") {
        const text = richTextToString(prop.rich_text);
        if (text) return text;
    }
  }
  return "";
}

function readNotionSongCover(props) {
  for (const [name, prop] of Object.entries(props)) {
    const key = name.toLowerCase();
    if (!["cover", "artwork", "portada", "image", "imagen"].some((k) => key.includes(k))) continue;
    if (prop?.type === "url" && prop.url) return prop.url;
    if (prop?.type === "files" && Array.isArray(prop.files) && prop.files.length) {
      const first = prop.files[0];
      if (first?.external?.url) return first.external.url;
      if (first?.file?.url) return first.file.url;
    }
    if (prop?.type === "rich_text") {
      const text = richTextToString(prop.rich_text);
      if (text) return text;
    }
  }
  return "";
}

function readNotionSongLetraUrl(props) {
  for (const [name, prop] of Object.entries(props)) {
    const key = name.toLowerCase();
    if (!["letra", "lyrics", "lyric"].some((k) => key.includes(k))) continue;
    if (prop?.type === "url" && prop.url) return prop.url;
    if (prop?.type === "rich_text") {
      const text = richTextToString(prop.rich_text);
      if (text) return text;
    }
  }
  return "";
}

function parseNotionPageIdFromUrl(input) {
  const value = String(input || "").trim();
  if (!value) return "";

  // Matches dashed UUID.
  let m = value.match(/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/);
  if (m?.[1]) return m[1].toLowerCase();

  // Matches compact 32-hex ID.
  m = value.match(/([0-9a-fA-F]{32})/);
  if (!m?.[1]) return "";
  const raw = m[1].toLowerCase();
  return `${raw.slice(0, 8)}-${raw.slice(8, 12)}-${raw.slice(12, 16)}-${raw.slice(16, 20)}-${raw.slice(20)}`;
}

async function fetchNotionLyricsTextFromUrl(letraUrl, notionToken, notionVersion, maxChars = 12000) {
  const pageId = parseNotionPageIdFromUrl(letraUrl);
  if (!pageId || !notionToken) return "";

  const chunks = [];
  let cursor = "";
  let guard = 0;
  while (guard < 20) {
    guard += 1;
    const params = new URLSearchParams({ page_size: "100" });
    if (cursor) params.set("start_cursor", cursor);
    const url = `https://api.notion.com/v1/blocks/${pageId}/children?${params.toString()}`;

    const resp = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": notionVersion,
      },
    });
    if (!resp.ok) break;

    const payload = await resp.json();
    const blocks = Array.isArray(payload?.results) ? payload.results : [];
    for (const b of blocks) {
      const type = b?.type;
      const rt = b?.[type]?.rich_text;
      const txt = richTextToString(rt || []).trim();
      if (!txt) continue;
      chunks.push(txt);
      if (chunks.join("\n").length >= maxChars) {
        return chunks.join("\n").slice(0, maxChars);
      }
    }

    if (!payload?.has_more || !payload?.next_cursor) break;
    cursor = payload.next_cursor;
  }

  return chunks.join("\n").slice(0, maxChars);
}

function readNotionSongAiTags(props) {
  for (const [name, prop] of Object.entries(props)) {
    const key = name.toLowerCase();
    if (!["tags para búsqueda ai", "tags para busqueda ai", "ai tags", "search tags"].some((k) => key.includes(k))) continue;
    if (prop?.type === "multi_select") return (prop.multi_select || []).map((x) => x?.name).filter(Boolean);
    if (prop?.type === "rich_text") {
      const text = richTextToString(prop.rich_text);
      return text ? text.split(",").map((x) => x.trim()).filter(Boolean) : [];
    }
  }
  return [];
}

function readNotionSongAiTagsRaw(props) {
  for (const [name, prop] of Object.entries(props)) {
    const key = name.toLowerCase();
    if (!["tags ai raw", "tags raw", "ai tags raw"].some((k) => key.includes(k))) continue;
    if (prop?.type === "rich_text") return richTextToString(prop.rich_text);
    if (prop?.type === "title") return richTextToString(prop.title);
    if (prop?.type === "url") return String(prop.url || "").trim();
    if (prop?.type === "multi_select") return (prop.multi_select || []).map((x) => x?.name).filter(Boolean).join(", ");
  }
  return "";
}

function readNotionSongBool(props, hints = []) {
  for (const [name, prop] of Object.entries(props)) {
    const key = name.toLowerCase();
    if (!hints.some((h) => key.includes(h))) continue;
    if (prop?.type === "checkbox") return Boolean(prop.checkbox);
  }
  return false;
}

function readNotionSongFilesCount(props, hints = []) {
  for (const [name, prop] of Object.entries(props)) {
    const key = name.toLowerCase();
    if (!hints.some((h) => key.includes(h))) continue;
    if (prop?.type === "files") return Array.isArray(prop.files) ? prop.files.length : 0;
  }
  return 0;
}

function richTextFromAnyProp(prop) {
  if (!prop) return "";
  if (prop.type === "title") return richTextToString(prop.title);
  if (prop.type === "rich_text") return richTextToString(prop.rich_text);
  if (prop.type === "select") return prop.select?.name || "";
  if (prop.type === "multi_select") return (prop.multi_select || []).map((x) => x?.name).filter(Boolean).join(" ");
  if (prop.type === "url") return prop.url || "";
  if (prop.type === "checkbox") return prop.checkbox ? "true" : "false";
  if (prop.type === "date") return prop.date?.start || "";
  if (prop.type === "files") {
    const files = Array.isArray(prop.files) ? prop.files : [];
    return files
      .map((f) => f?.name || f?.external?.url || f?.file?.url || "")
      .filter(Boolean)
      .join(" ");
  }
  return "";
}

function buildCatalogSearchText(props = {}) {
  return Object.values(props)
    .map((prop) => richTextFromAnyProp(prop))
    .filter(Boolean)
    .join(" ")
    .trim();
}

async function listCatalogSongs(env) {
  const notionVersion = env.NOTION_VERSION || "2022-06-28";
  const notionToken = env.NOTION_TOKEN || "";
  const dbId = env.MANAGER_CATALOG_DB_ID || DEFAULT_CATALOG_DB_ID;

  if (!notionToken || !dbId) {
    return {
      source: "fallback",
      warning: "NOTION_TOKEN o MANAGER_CATALOG_DB_ID no configurados.",
      data: SAMPLE_CATALOG,
    };
  }

  try {
    const payload = await notionQueryAdvanced(dbId, notionToken, notionVersion, {
      pageSize: 200,
    });

    const data = (await Promise.all((payload.results || [])
      .map(async (page) => {
        const props = page.properties || {};
        const obra = readNotionTitle(props);
        const autores = readNotionSongAuthors(props);
        const generos = readNotionSongGenres(props);
        const drive = readNotionSongUrl(props);
        const fileId = extractDriveFileId(drive);
        const cover = readNotionSongCover(props);
        const letra = readNotionSongLetraUrl(props);
        const lyricsText = letra
          ? await fetchNotionLyricsTextFromUrl(letra, notionToken, notionVersion)
          : "";
        const aiTags = readNotionSongAiTags(props);
        const aiTagsRaw = readNotionSongAiTagsRaw(props);
        const certificadaIndautorCount = readNotionSongFilesCount(props, ["certificado de indautor", "certificado", "indautor"]);
        const registradaSacm = readNotionSongBool(props, ["registrada en sacm", "sacm"]);
        const registradaBmi = readNotionSongBool(props, ["registrada en bmi", "bmi"]);
        const searchText = buildCatalogSearchText(props);
        return {
          id: page.id,
          obra: obra || "Sin título",
          autores: autores || "—",
          generos: generos || "—",
          drive: drive || "",
          fileId: fileId || "",
          cover: cover || "",
          letra: letra || "",
          lyricsText: lyricsText || "",
          aiTags,
          aiTagsRaw: aiTagsRaw || "",
          certificadaIndautor: certificadaIndautorCount > 0,
          certificadaIndautorCount,
          registradaSacm,
          registradaBmi,
          searchText,
        };
      })))
      .filter((item) => Boolean(item.obra));

    return {
      source: "notion",
      data: data.length ? data : SAMPLE_CATALOG,
    };
  } catch (e) {
    return {
      source: "fallback",
      warning: "No se pudo leer catálogo desde Notion.",
      details: String(e?.message || e),
      data: SAMPLE_CATALOG,
    };
  }
}

function readNotionUrl(props) {
  for (const [name, prop] of Object.entries(props)) {
    const key = name.toLowerCase();
    if (!["url", "link", "perfil", "profile", "sitio", "web", "play", "youtube"].some((k) => key.includes(k))) continue;
    if (prop?.type === "url" && prop.url) return prop.url;
    if (prop?.type === "rich_text") {
        const text = richTextToString(prop.rich_text);
        if (text) return text;
    }
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
  const notionVersion = env.NOTION_VERSION || "2022-06-28";
  const dbId = DEFAULT_MANAGER_CONTACTS_DB_ID;
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
        id: page.id,
        nombre: readNotionTitle(props),
        rol: readNotionRole(props),
        correo: readNotionEmail(props),
        telefono: readNotionPhone(props),
        whatsapp: readNotionWhatsapp(props),
        instagram: readNotionInstagram(props),
        tiktok: readNotionTiktok(props),
        direccion: readNotionAddress(props),
      };
    });

    return { source: "notion", data };
  }

  return { source: "error", error: "Notion query failed", details: lastError, data: [] };
}

function findPropertyKey(props = {}, nameHints = [], allowedTypes = []) {
  const entries = Object.entries(props || {});
  for (const [key, value] of entries) {
    const lower = String(key || "").toLowerCase();
    if (!nameHints.some((h) => lower.includes(h))) continue;
    if (allowedTypes.length && !allowedTypes.includes(value?.type)) continue;
    return key;
  }

  if (allowedTypes.length) {
    const byType = entries.find(([, value]) => allowedTypes.includes(value?.type));
    if (byType) return byType[0];
  }

  return "";
}

function buildNotionValueByType(type, rawValue) {
  const value = String(rawValue || "").trim();
  if (type === "title") {
    return { title: value ? [{ text: { content: value } }] : [] };
  }
  if (type === "rich_text") {
    return { rich_text: value ? [{ text: { content: value } }] : [] };
  }
  if (type === "email") {
    return { email: value || null };
  }
  if (type === "phone_number") {
    return { phone_number: value || null };
  }
  if (type === "url") {
    return { url: value || null };
  }
  if (type === "select") {
    return { select: value ? { name: value } : null };
  }
  if (type === "multi_select") {
    const names = String(rawValue || "")
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 25);
    return { multi_select: names.map((name) => ({ name })) };
  }
  return null;
}

function isAudioLike(name = "", mimeType = "") {
  const n = String(name || "").toLowerCase();
  const m = String(mimeType || "").toLowerCase();
  return m.startsWith("audio/") || [".mp3", ".wav", ".m4a", ".aac", ".flac", ".ogg", ".aiff"].some((ext) => n.endsWith(ext));
}

async function driveListChildren(apiKey, folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name,mimeType,webViewLink)&pageSize=1000&includeItemsFromAllDrives=true&supportsAllDrives=true&key=${encodeURIComponent(apiKey)}`;
  const resp = await fetch(url, { method: "GET" });
  if (!resp.ok) {
    throw new Error(`Drive list failed (${resp.status})`);
  }
  const payload = await resp.json();
  return Array.isArray(payload?.files) ? payload.files : [];
}

async function collectDriveCatalogSongs(apiKey, rootFolderId) {
  const rootChildren = await driveListChildren(apiKey, rootFolderId);
  const genreFolders = rootChildren.filter((f) => f?.mimeType === "application/vnd.google-apps.folder");
  const songs = [];

  for (const folder of genreFolders) {
    const genre = String(folder?.name || "").trim() || "Sin género";
    const children = await driveListChildren(apiKey, folder.id);
    for (const file of children) {
      if (!isAudioLike(file?.name, file?.mimeType)) continue;
      const fileId = String(file?.id || "").trim();
      if (!fileId) continue;
      songs.push({
        fileId,
        obra: String(file?.name || "").trim() || "Sin título",
        generos: genre,
        drive: String(file?.webViewLink || "").trim() || `https://drive.google.com/file/d/${fileId}/view`,
      });
    }
  }

  const byId = new Map();
  for (const s of songs) {
    if (!byId.has(s.fileId)) byId.set(s.fileId, s);
  }
  return Array.from(byId.values());
}

function buildCatalogPropertiesFromSchema(schemaProps = {}, input = {}) {
  const titleKey = findPropertyKey(schemaProps, ["name", "nombre", "title"], ["title"]);
  const genreKey = findPropertyKey(schemaProps, ["genero", "género", "genre"], ["multi_select", "select", "rich_text"]);
  const playKey = findPropertyKey(schemaProps, ["play", "drive", "audio", "url", "link"], ["url", "rich_text"]);
  const tagsKey = findPropertyKey(schemaProps, ["tags", "etiquetas"], ["multi_select"]);

  const properties = {};
  if (titleKey) {
    const value = buildNotionValueByType(schemaProps[titleKey]?.type, input.obra || "");
    if (value) properties[titleKey] = value;
  }
  if (genreKey) {
    const value = buildNotionValueByType(schemaProps[genreKey]?.type, input.generos || "");
    if (value) properties[genreKey] = value;
  }
  if (playKey) {
    const value = buildNotionValueByType(schemaProps[playKey]?.type, input.drive || "");
    if (value) properties[playKey] = value;
  }
  if (tagsKey && schemaProps[tagsKey]?.type === "multi_select") {
    properties[tagsKey] = { multi_select: [{ name: CATALOG_AUTOSYNC_TAG }] };
  }
  return properties;
}

async function syncCatalogFromDrive(env) {
  const notionVersion = env.NOTION_VERSION || "2022-06-28";
  const notionToken = env.NOTION_TOKEN || "";
  const dbId = env.MANAGER_CATALOG_DB_ID || DEFAULT_CATALOG_DB_ID;
  const driveApiKey = String(env.DRIVE_API_KEY || "").trim();
  const driveFolderId = String(env.DRIVE_CATALOG_FOLDER_ID || DEFAULT_DRIVE_CATALOG_FOLDER_ID).trim();

  if (!notionToken || !dbId) return { error: "NOTION_TOKEN o MANAGER_CATALOG_DB_ID missing" };
  if (!driveApiKey || !driveFolderId) return { error: "DRIVE_API_KEY o DRIVE_CATALOG_FOLDER_ID missing" };

  const driveSongs = await collectDriveCatalogSongs(driveApiKey, driveFolderId);
  const schema = await retrieveNotionCollectionSchema(dbId, notionToken, notionVersion);
  const schemaProps = schema.properties || {};

  const payload = await notionQueryAdvanced(dbId, notionToken, notionVersion, { pageSize: 200 });
  const existingPages = payload.results || [];

  const byFileId = new Map();
  const autosyncTagged = [];
  for (const page of existingPages) {
    const props = page.properties || {};
    const play = readNotionSongUrl(props);
    const fileId = extractDriveFileId(play);
    if (fileId) byFileId.set(fileId, page);
    const tags = getTagNames(props);
    if (tags.includes(CATALOG_AUTOSYNC_TAG)) autosyncTagged.push(page);
  }

  let created = 0;
  let updated = 0;
  const activeIds = new Set();

  for (const song of driveSongs) {
    const existing = byFileId.get(song.fileId);
    const properties = buildCatalogPropertiesFromSchema(schemaProps, song);

    if (existing) {
      const resp = await fetch(`https://api.notion.com/v1/pages/${existing.id}`, {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${notionToken}`,
          "Notion-Version": notionVersion,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ properties }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      updated += 1;
      activeIds.add(existing.id);
      continue;
    }

    const parentShapes = [{ data_source_id: dbId }, { database_id: dbId }];
    let createdOk = false;
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
        const createdPage = await resp.json();
        activeIds.add(createdPage.id);
        created += 1;
        createdOk = true;
        break;
      }
      lastError = await resp.text();
    }
    if (!createdOk) throw new Error(lastError || "Catalog create failed");
  }

  let archived = 0;
  for (const page of autosyncTagged) {
    if (activeIds.has(page.id)) continue;
    const resp = await fetch(`https://api.notion.com/v1/pages/${page.id}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": notionVersion,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ archived: true }),
    });
    if (!resp.ok) throw new Error(await resp.text());
    archived += 1;
  }

  return {
    ok: true,
    created,
    updated,
    archived,
    totalDriveSongs: driveSongs.length,
  };
}

async function retrieveNotionCollectionSchema(dbOrDataSourceId, notionToken, notionVersion) {
  const endpoints = [
    `https://api.notion.com/v1/data_sources/${dbOrDataSourceId}`,
    `https://api.notion.com/v1/databases/${dbOrDataSourceId}`,
  ];

  let lastError = "";
  for (const url of endpoints) {
    const resp = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": notionVersion,
      },
    });
    if (resp.ok) return resp.json();
    lastError = await resp.text();
  }

  throw new Error(lastError || "Notion schema fetch failed");
}

function buildContactPropertiesFromSchema(schemaProps = {}, input = {}, { includeTitle = true } = {}) {
  const titleKey = findPropertyKey(schemaProps, ["name", "nombre", "title"], ["title"]);
  const roleKey = findPropertyKey(schemaProps, ["rol", "role", "cargo", "puesto"], ["select", "rich_text"]);
  const emailKey = findPropertyKey(schemaProps, ["correo", "email", "mail"], ["email", "rich_text"]);
  const phoneKey = findPropertyKey(schemaProps, ["telefono", "teléfono", "phone", "cel", "movil", "móvil"], ["phone_number", "rich_text"]);
  const waKey = findPropertyKey(schemaProps, ["whatsapp", "wa"], ["url", "rich_text"]);
  const instagramKey = findPropertyKey(schemaProps, ["instagram", "insta", "ig"], ["url", "rich_text"]);
  const tiktokKey = findPropertyKey(schemaProps, ["tiktok", "tik tok"], ["url", "rich_text"]);
  const addressKey = findPropertyKey(schemaProps, ["direccion", "dirección", "address", "ubicacion", "ubicación"], ["rich_text", "select", "url"]);

  const properties = {};
  if (includeTitle && titleKey) {
    const type = schemaProps[titleKey]?.type;
    const value = buildNotionValueByType(type, input.nombre || "");
    if (value) properties[titleKey] = value;
  }

  const fieldMap = [
    { key: roleKey, raw: input.rol || "" },
    { key: emailKey, raw: input.correo || "" },
    { key: phoneKey, raw: input.telefono || "" },
    { key: waKey, raw: input.whatsapp || "" },
    { key: instagramKey, raw: input.instagram || "" },
    { key: tiktokKey, raw: input.tiktok || "" },
    { key: addressKey, raw: input.direccion || "" },
  ];

  for (const field of fieldMap) {
    if (!field.key) continue;
    const type = schemaProps[field.key]?.type;
    const value = buildNotionValueByType(type, field.raw);
    if (value) properties[field.key] = value;
  }

  return properties;
}

async function createManagerContact(env, body) {
  const notionVersion = env.NOTION_VERSION || "2022-06-28";
  const notionToken = env.NOTION_TOKEN || "";
  const dbId = DEFAULT_MANAGER_CONTACTS_DB_ID;

  if (!notionToken || !dbId) return { error: "NOTION_TOKEN o MANAGER_CONTACTS_DB_ID missing" };
  const nombre = String(body?.nombre || "").trim();
  if (!nombre) return { error: "nombre is required" };

  try {
    const schema = await retrieveNotionCollectionSchema(dbId, notionToken, notionVersion);
    const properties = buildContactPropertiesFromSchema(schema.properties || {}, {
      nombre,
      rol: body?.rol,
      correo: body?.correo,
      telefono: body?.telefono,
      whatsapp: body?.whatsapp,
      instagram: body?.instagram,
      tiktok: body?.tiktok,
      direccion: body?.direccion,
    }, { includeTitle: true });

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
    return { error: "Contact create failed", details: lastError };
  } catch (e) {
    return { error: "Contact create failed", details: String(e?.message || e) };
  }
}

async function updateManagerContact(env, contactId, body) {
  const notionVersion = env.NOTION_VERSION || "2022-06-28";
  const notionToken = env.NOTION_TOKEN || "";
  const dbId = DEFAULT_MANAGER_CONTACTS_DB_ID;

  if (!notionToken || !dbId) return { error: "NOTION_TOKEN o MANAGER_CONTACTS_DB_ID missing" };

  try {
    const schema = await retrieveNotionCollectionSchema(dbId, notionToken, notionVersion);
    const properties = buildContactPropertiesFromSchema(schema.properties || {}, {
      nombre: body?.nombre,
      rol: body?.rol,
      correo: body?.correo,
      telefono: body?.telefono,
      whatsapp: body?.whatsapp,
      instagram: body?.instagram,
      tiktok: body?.tiktok,
      direccion: body?.direccion,
    }, { includeTitle: Object.prototype.hasOwnProperty.call(body || {}, "nombre") });

    const resp = await fetch(`https://api.notion.com/v1/pages/${contactId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": notionVersion,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ properties }),
    });

    if (!resp.ok) return { error: "Contact update failed", details: await resp.text() };
    return { ok: true };
  } catch (e) {
    return { error: "Contact update failed", details: String(e?.message || e) };
  }
}

async function deleteManagerContact(env, contactId) {
  const notionVersion = env.NOTION_VERSION || "2022-06-28";
  const notionToken = env.NOTION_TOKEN || "";
  if (!notionToken) return { error: "NOTION_TOKEN missing" };

  const resp = await fetch(`https://api.notion.com/v1/pages/${contactId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${notionToken}`,
      "Notion-Version": notionVersion,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ archived: true }),
  });

  if (!resp.ok) return { error: "Contact delete failed", details: await resp.text() };
  return { ok: true };
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

function parseAssigneesFromProperty(props = {}, users = []) {
  const userByEmail = new Map((users || []).map((u) => [String(u?.email || "").toLowerCase(), String(u?.name || u?.email || "")]));
  const userByName = new Map((users || []).map((u) => [String(u?.name || "").toLowerCase(), String(u?.email || "").toLowerCase()]));

  const assigneeProp = props?.[TASK_ASSIGNEES_PROPERTY] || props?.[TASK_ASSIGNEES_PROPERTY_LEGACY] || {};

  const rawEmails = [];

  const resolveVal = (val) => {
    if (!val) return;
    if (val.includes("@")) { rawEmails.push(val); return; }
    const found = userByName.get(val);
    if (found) rawEmails.push(found);
  };

  // select: single value
  if (assigneeProp?.select?.name) {
    resolveVal(String(assigneeProp.select.name).trim().toLowerCase());
  }

  // multi_select: values are email or name strings
  if (Array.isArray(assigneeProp?.multi_select)) {
    for (const item of assigneeProp.multi_select) {
      resolveVal(String(item?.name || "").trim().toLowerCase());
    }
  }

  // people: Notion native user property — read person.email
  if (Array.isArray(assigneeProp?.people)) {
    for (const person of assigneeProp.people) {
      const email = String(person?.person?.email || "").trim().toLowerCase();
      if (email && email.includes("@")) rawEmails.push(email);
    }
  }

  const uniqueEmails = Array.from(new Set(rawEmails));
  const names = uniqueEmails.map((email) => userByEmail.get(email) || email);
  return {
    emails: uniqueEmails,
    names,
    primaryEmail: uniqueEmails[0] || "",
    label: names.join(", "),
  };
}

function resolveTaskAssigneePropertyKey(props = {}) {
  if (props?.[TASK_ASSIGNEES_PROPERTY]?.type === "multi_select") return TASK_ASSIGNEES_PROPERTY;
  if (props?.[TASK_ASSIGNEES_PROPERTY_LEGACY]?.type === "multi_select") return TASK_ASSIGNEES_PROPERTY_LEGACY;
  return findPropertyKey(props, ["asignar usuario", "asignar usuarios"], ["multi_select"]) || TASK_ASSIGNEES_PROPERTY;
}

function applyAssigneeTags(tags = [], assigneeEmail = "", assigneeName = "") {
  const withoutAssignee = tags.filter((t) => !t.startsWith(ASSIGNEE_PREFIX) && !t.startsWith(ASSIGNEE_NAME_PREFIX));
  if (!assigneeEmail) return withoutAssignee;
  const next = [...withoutAssignee, `${ASSIGNEE_PREFIX}${assigneeEmail}`];
  if (assigneeName) next.push(`${ASSIGNEE_NAME_PREFIX}${assigneeName}`);
  return next;
}

function normalizeSubtasks(input = []) {
  if (!Array.isArray(input)) return [];

  const byKey = new Map();
  for (const raw of input) {
    const title = String(raw?.title || "").trim();
    if (!title) continue;
    const key = title.toLowerCase();
    const done = Boolean(raw?.done);
    if (!byKey.has(key)) {
      byKey.set(key, { title, done });
      continue;
    }
    const prev = byKey.get(key);
    byKey.set(key, { title: prev.title, done: prev.done || done });
  }

  return Array.from(byKey.values()).slice(0, 30);
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
  // Borra TODOS los to_do hijos para evitar duplicados heredados (prefijados y legacy sin prefijo).
  const existing = children.filter((b) => b?.type === "to_do");

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

  const normalized = normalizeSubtasks(subtasks);
  if (!normalized.length) return;

  const childBlocks = normalized.map((st) => ({
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
  return normalizeSubtasks(blocks
    .filter((b) => b?.type === "to_do")
    .map((b) => {
      const raw = richTextToString(b?.to_do?.rich_text || []);
      if (!raw) return null;
      const title = raw.startsWith(SUBTASK_PREFIX)
        ? raw.replace(SUBTASK_PREFIX, "").trim()
        : raw.trim();
      if (!title) return null;
      return {
        title,
        done: Boolean(b?.to_do?.checked),
      };
    })
    .filter(Boolean));
}

function detectExtraTaskInfo(blocks = []) {
  return (blocks || []).some((b) => {
    if (!b || b.type === "to_do") return false;
    if (b.has_children) return true;

    const blockPayload = b[b.type] || {};
    const text = richTextToString(blockPayload?.rich_text || []);
    if (text) return true;

    // Bloques no-textuales que implican contenido adicional en la nota.
    return [
      "code",
      "equation",
      "image",
      "video",
      "audio",
      "file",
      "pdf",
      "bookmark",
      "embed",
      "table",
      "table_row",
      "callout",
      "quote",
      "toggle",
      "numbered_list_item",
      "bulleted_list_item",
      "heading_1",
      "heading_2",
      "heading_3",
      "heading_4",
      "paragraph",
    ].includes(String(b.type || ""));
  });
}

function extractTaskPreview(blocks = [], maxChars = 180) {
  const text = (blocks || [])
    .filter((b) => b && b.type !== "to_do")
    .map((b) => {
      const payload = b?.[b.type] || {};
      return richTextToString(payload?.rich_text || []);
    })
    .map((t) => String(t || "").replace(/\s+/g, " ").trim())
    .find(Boolean) || "";

  if (!text) return "";
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trim()}`;
}

function parsePlaylistTrackLine(raw = "") {
  const clean = String(raw || "").trim();
  if (!clean.startsWith(PLAYLIST_TRACK_PREFIX)) return null;
  const payload = clean.replace(PLAYLIST_TRACK_PREFIX, "").trim();
  if (!payload) return null;
  const [idRaw, titleRaw] = payload.split("|");
  const id = String(idRaw || "").trim();
  const title = String(titleRaw || "").trim();
  if (!id) return null;
  return { id, title: title || id };
}

function parsePlaylistTracksFromBlocks(blocks = []) {
  const tracks = blocks
    .filter((b) => b?.type === "to_do" || b?.type === "paragraph")
    .map((b) => {
      const raw = b?.type === "to_do"
        ? richTextToString(b?.to_do?.rich_text || [])
        : richTextToString(b?.paragraph?.rich_text || []);
      return parsePlaylistTrackLine(raw);
    })
    .filter(Boolean);

  const byId = new Map();
  for (const t of tracks) {
    if (!byId.has(t.id)) byId.set(t.id, t);
  }
  return Array.from(byId.values());
}

function getPlaylistOwner(tags = []) {
  const hit = (tags || []).find((t) => t.startsWith(PLAYLIST_OWNER_PREFIX)) || "";
  return hit.replace(PLAYLIST_OWNER_PREFIX, "").trim().toLowerCase();
}

async function replacePlaylistTracks(pageId, notionToken, notionVersion, tracks = []) {
  const children = await notionGetPageChildren(pageId, notionToken, notionVersion);
  const existing = children.filter((b) => b?.type === "to_do" || b?.type === "paragraph");

  for (const block of existing) {
    const raw = block?.type === "to_do"
      ? richTextToString(block?.to_do?.rich_text || [])
      : richTextToString(block?.paragraph?.rich_text || []);
    if (!String(raw || "").startsWith(PLAYLIST_TRACK_PREFIX)) continue;
    const resp = await fetch(`https://api.notion.com/v1/blocks/${block.id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": notionVersion,
      },
    });
    if (!resp.ok) throw new Error(await resp.text());
  }

  if (!tracks.length) return;

  const childBlocks = tracks.map((track) => ({
    object: "block",
    type: "to_do",
    to_do: {
      checked: false,
      rich_text: [{
        type: "text",
        text: { content: `${PLAYLIST_TRACK_PREFIX}${String(track.id || "").trim()}|${String(track.title || "").trim()}` },
      }],
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

async function listManagerPlaylists(env) {
  const notionVersion = env.NOTION_VERSION || "2022-06-28";
  const notionToken = env.NOTION_TOKEN || "";
  const dbId = env.MANAGER_TASKS_DB_ID || DEFAULT_MANAGER_TASKS_DB_ID;

  if (!notionToken) return { source: "fallback", warning: "NOTION_TOKEN no configurado.", data: [] };

  try {
    const payload = await notionQuery(dbId, notionToken, notionVersion, { property: "Name", title: { contains: PLAYLIST_PREFIX } }, 80);
    const rows = await Promise.all((payload.results || []).map(async (page) => {
      const props = page.properties || {};
      const tags = getTagNames(props);
      const children = await notionGetPageChildren(page.id, notionToken, notionVersion);
      const tracks = parsePlaylistTracksFromBlocks(children);
      return {
        id: page.id,
        name: normalizeTaskTitle(readNotionTitle(props)).replace(/^\[ManagerPlaylist\]\s*/i, "").trim() || "Playlist",
        owner: getPlaylistOwner(tags),
        tracks,
        trackCount: tracks.length,
        createdAt: page.created_time,
      };
    }));

    return { source: "notion", data: rows };
  } catch (e) {
    return { source: "error", error: "Playlists query failed", details: String(e?.message || e), data: [] };
  }
}

async function createManagerPlaylist(env, body) {
  const notionVersion = env.NOTION_VERSION || "2022-06-28";
  const notionToken = env.NOTION_TOKEN || "";
  const dbId = env.MANAGER_TASKS_DB_ID || DEFAULT_MANAGER_TASKS_DB_ID;
  if (!notionToken) return { error: "NOTION_TOKEN missing" };

  const name = String(body?.name || "").trim();
  if (!name) return { error: "name is required" };
  const ownerEmail = String(body?.ownerEmail || "").trim().toLowerCase();

  const properties = {
    Name: { title: [{ text: { content: `${PLAYLIST_PREFIX}${name}` } }] },
    Estatus: { select: { name: "Empezó" } },
    Prioridad: { select: { name: "-" } },
    Tipo: { select: { name: "Music Knobs" } },
    Tags: {
      multi_select: [
        { name: "kind:manager-playlist" },
        ...(ownerEmail ? [{ name: `${PLAYLIST_OWNER_PREFIX}${ownerEmail}` }] : []),
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
  return { error: "Playlist create failed", details: lastError };
}

async function updateManagerPlaylist(env, playlistId, body) {
  const notionVersion = env.NOTION_VERSION || "2022-06-28";
  const notionToken = env.NOTION_TOKEN || "";
  if (!notionToken) return { error: "NOTION_TOKEN missing" };

  const action = String(body?.action || "add_track").trim();
  const trackId = String(body?.trackId || "").trim();
  const trackTitle = String(body?.trackTitle || "").trim();
  if (["add_track", "remove_track"].includes(action) && !trackId) {
    return { error: "trackId is required" };
  }

  const children = await notionGetPageChildren(playlistId, notionToken, notionVersion);
  const current = parsePlaylistTracksFromBlocks(children);
  let next = current;

  if (action === "add_track") {
    if (!current.some((t) => t.id === trackId)) {
      next = [...current, { id: trackId, title: trackTitle || trackId }];
    }
  } else if (action === "remove_track") {
    next = current.filter((t) => t.id !== trackId);
  } else {
    return { error: "Unsupported action" };
  }

  const same = JSON.stringify(current) === JSON.stringify(next);
  if (!same) {
    await replacePlaylistTracks(playlistId, notionToken, notionVersion, next);
  }

  return { ok: true, trackCount: next.length };
}

async function deleteManagerPlaylist(env, playlistId) {
  const notionVersion = env.NOTION_VERSION || "2022-06-28";
  const notionToken = env.NOTION_TOKEN || "";
  if (!notionToken) return { error: "NOTION_TOKEN missing" };

  const resp = await fetch(`https://api.notion.com/v1/pages/${playlistId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${notionToken}`,
      "Notion-Version": notionVersion,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ archived: true }),
  });

  if (!resp.ok) return { error: "Playlist delete failed", details: await resp.text() };
  return { ok: true };
}

async function listManagerTasks(env, options = {}) {
  const notionVersion = env.NOTION_VERSION || "2022-06-28";
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

    const baseFilter = {
      and: [
        { property: "Name", title: { contains: TASK_PREFIX } },
        { property: TASK_FOCUS_ONLY_PROPERTY, checkbox: { equals: false } },
      ]
    };
    const filter = baseFilter;

    const payload = await notionQueryAdvanced(dbId, notionToken, notionVersion, {
      filter,
      pageSize: limit,
      startCursor,
    });

    const data = await Promise.all((payload.results || []).map(async (page) => {
      const props = page.properties || {};
      const status = props?.Estatus?.select?.name || "Pendiente";
      const priority = props?.Prioridad?.select?.name || "";
      const tipo = props?.Tipo?.select?.name || "";
      const dueDate = props?.["Date (ToDo)"]?.date?.start || "";
      const assignees = parseAssigneesFromProperty(props, allUsers);
      const subtaskBlocks = await notionGetPageChildren(page.id, notionToken, notionVersion);
      const subtasks = parseSubtasksFromBlocks(subtaskBlocks);
      const hasExtraInfo = detectExtraTaskInfo(subtaskBlocks);
      const taskPreview = extractTaskPreview(subtaskBlocks);

      return {
        id: page.id,
        title: normalizeTaskTitle(readNotionTitle(props)),
        assignee: assignees.label,
        assigneeEmail: assignees.primaryEmail,
        assigneeEmails: assignees.emails,
        status,
        priority,
        tipo,
        dueDate,
        notionUrl: String(page.url || ""),
        hasExtraInfo,
        taskPreview,
        subtasks,
        subtaskCount: subtasks.length,
      };
    }));

    const filteredData = scope === "mine" && viewerEmail
      ? data.filter((row) => {
          const emails = Array.isArray(row?.assigneeEmails) ? row.assigneeEmails : [];
          return emails.length === 0 || emails.includes(viewerEmail);
        })
      : data;

    return {
      source: "notion",
      data: filteredData,
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

function toIsoDateOnly(value) {
  return String(value || "").trim().slice(0, 10);
}

async function listManagerFocusTasks(env, options = {}) {
  const notionVersion = env.NOTION_VERSION || "2022-06-28";
  const notionToken = env.NOTION_TOKEN || "";
  const dbId = env.MANAGER_TASKS_DB_ID || DEFAULT_MANAGER_TASKS_DB_ID;

  if (!notionToken) {
    return { source: "fallback", warning: "NOTION_TOKEN no configurado.", today: [], overdue: [] };
  }

  try {
    const viewerEmail = String(options.viewerEmail || "").trim().toLowerCase();
    const scope = String(options.scope || "all").toLowerCase();
    const cached = getCachedFocusTasks({ scope, viewerEmail });
    if (cached) return cached;
    const allUsers = parseManagerUsers(env);
    const todayIso = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Mexico_City' });

    const baseFilter = {
      and: [
        { property: "Estatus", select: { equals: "Empezó" } },
        { property: "Prioridad", select: { equals: "Alta" } },
        { property: "Date (ToDo)", date: { is_not_empty: true } },
        { property: TASK_SHOW_IN_MANAGER_PROPERTY, checkbox: { equals: true } },
      ],
    };

    const filter = baseFilter;

    const pages = [];
    let cursor = undefined;
    let guard = 0;

    while (guard < 20) {
      const payload = await notionQueryAdvanced(dbId, notionToken, notionVersion, {
        filter,
        pageSize: 100,
        startCursor: cursor,
      });

      pages.push(...(payload.results || []));
      if (!payload.has_more || !payload.next_cursor) break;
      cursor = payload.next_cursor;
      guard += 1;
    }

    const rows = await Promise.all((pages || []).map(async (page) => {
      const props = page.properties || {};
      const status = props?.Estatus?.select?.name || "Pendiente";
      const priority = props?.Prioridad?.select?.name || "";
      const tipo = props?.Tipo?.select?.name || "";
      const dueDate = props?.["Date (ToDo)"]?.date?.start || "";
      const assignees = parseAssigneesFromProperty(props, allUsers);
      const subtaskBlocks = await notionGetPageChildren(page.id, notionToken, notionVersion);
      const subtasks = parseSubtasksFromBlocks(subtaskBlocks);
      const hasExtraInfo = detectExtraTaskInfo(subtaskBlocks);
      const taskPreview = extractTaskPreview(subtaskBlocks);

      return {
        id: page.id,
        title: normalizeTaskTitle(readNotionTitle(props)),
        assignee: assignees.label,
        assigneeEmail: assignees.primaryEmail,
        assigneeEmails: assignees.emails,
        status,
        priority,
        tipo,
        dueDate,
        notionUrl: String(page.url || ""),
        hasExtraInfo,
        taskPreview,
        subtasks,
        subtaskCount: subtasks.length,
      };
    }));

    const scopedRows = scope === "mine" && viewerEmail
      ? rows.filter((row) => {
          const emails = Array.isArray(row?.assigneeEmails) ? row.assigneeEmails : [];
          return emails.length === 0 || emails.includes(viewerEmail);
        })
      : rows;

    const today = [];
    const overdue = [];
    for (const task of scopedRows) {
      const due = toIsoDateOnly(task?.dueDate);
      if (!due) continue;
      if (due === todayIso) {
        today.push(task);
        continue;
      }
      if (due < todayIso) overdue.push(task);
    }

    today.sort((a, b) => String(a?.dueDate || "").localeCompare(String(b?.dueDate || "")) || String(a?.title || "").localeCompare(String(b?.title || ""), "es"));
    overdue.sort((a, b) => String(a?.dueDate || "").localeCompare(String(b?.dueDate || "")) || String(a?.title || "").localeCompare(String(b?.title || ""), "es"));

    const response = {
      source: "notion",
      today,
      overdue,
      users: allUsers,
      counts: {
        today: today.length,
        overdue: overdue.length,
      },
    };
    setCachedFocusTasks({ scope, viewerEmail }, response);
    return response;
  } catch (e) {
    return { source: "error", error: "Focus tasks query failed", details: String(e?.message || e), today: [], overdue: [] };
  }
}

async function listSocialLinks(env) {
  const notionVersion = env.NOTION_VERSION || "2022-06-28";
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
  const notionVersion = env.NOTION_VERSION || "2022-06-28";
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
  const notionVersion = env.NOTION_VERSION || "2022-06-28";
  const notionToken = env.NOTION_TOKEN || "";
  const dbId = env.MANAGER_MESSAGES_DB_ID || DEFAULT_MANAGER_TASKS_DB_ID;

  if (!notionToken) return { error: "NOTION_TOKEN missing" };
  const text = String(body?.text || "").trim();
  if (!text) return { error: "text is required" };

  const author = String(body?.author || "Anónimo").trim() || "Anónimo";
  const authorEmail = String(body?.authorEmail || "").trim().toLowerCase();

  const properties = {
    Name: { title: [{ text: { content: `${MESSAGE_PREFIX}${text}` } }] },
    // Guardrail: mensajes y tasks NO comparten defaults.
    Estatus: { select: { name: MESSAGE_DEFAULTS.status } },
    Prioridad: { select: { name: MESSAGE_DEFAULTS.priority } },
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
  const notionVersion = env.NOTION_VERSION || "2022-06-28";
  const notionToken = env.NOTION_TOKEN || "";
  if (!notionToken) return { error: "NOTION_TOKEN missing" };

  const hasHighlighted = body !== null && typeof body === 'object' && 'highlighted' in body;
  const highlighted = Boolean(body?.highlighted);
  const textBody = typeof body?.text === 'string' ? body.text.trim() : null;

  const properties = {};

  if (hasHighlighted) {
    const pageResp = await fetch(`https://api.notion.com/v1/pages/${messageId}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": notionVersion,
        "Content-Type": "application/json",
      },
    });

    if (!pageResp.ok) return { error: "Message lookup failed", details: await pageResp.text() };

    const page = await pageResp.json();
    const currentTags = getTagNames(page.properties || {});
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

    properties.Tags = { multi_select: applyMessageTagState(currentTags, highlighted).map((name) => ({ name })) };
  }

  if (textBody !== null) {
    properties.Name = { title: [{ text: { content: `${MESSAGE_PREFIX}${textBody}` } }] };
  }

  if (Object.keys(properties).length === 0) return { ok: true };

  const resp = await fetch(`https://api.notion.com/v1/pages/${messageId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${notionToken}`,
      "Notion-Version": notionVersion,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ properties }),
  });

  if (!resp.ok) return { error: "Message update failed", details: await resp.text() };
  return { ok: true };
}

async function deleteManagerMessage(env, messageId) {
  const notionVersion = env.NOTION_VERSION || "2022-06-28";
  const notionToken = env.NOTION_TOKEN || "";
  if (!notionToken) return { error: "NOTION_TOKEN missing" };

  try {
    const resp = await fetch(`https://api.notion.com/v1/pages/${messageId}`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${notionToken}`,
        "Notion-Version": notionVersion,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ archived: true }),
    });
    if (!resp.ok) return { error: "Message delete failed", details: await resp.text() };
    return { ok: true };
  } catch (e) {
    return { error: "Message delete failed", details: String(e?.message || e) };
  }
}

async function clearManagerMessages(env, body) {
  const notionVersion = env.NOTION_VERSION || "2022-06-28";
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
  const notionVersion = env.NOTION_VERSION || "2022-06-28";
  const notionToken = env.NOTION_TOKEN || "";
  const dbId = env.MANAGER_TASKS_DB_ID || DEFAULT_MANAGER_TASKS_DB_ID;

  if (!notionToken) return { error: "NOTION_TOKEN missing" };
  const title = String(body?.title || "").trim();
  if (!title) return { error: "title is required" };

  const assigneeRaw = String(body?.assignee || "").trim().toLowerCase();
  const dueDate = String(body?.dueDate || "").trim();
  const tipoRaw = String(body?.tipo || "").trim();
  const focusOnly = Boolean(body?.focusOnly);
  const subtasks = normalizeSubtasks(Array.isArray(body?.subtasks)
    ? body.subtasks.map((s) => ({ title: String(s?.title || "").trim(), done: Boolean(s?.done) }))
    : []);
  const users = parseManagerUsers(env);
  const userByEmail = new Map(users.map((u) => [u.email.toLowerCase(), u]));
  const assigneeUser = assigneeRaw ? userByEmail.get(assigneeRaw) : null;
  const assignee = assigneeUser?.email || "";
  let assigneePropertyKey = TASK_ASSIGNEES_PROPERTY;

  try {
    const schema = await retrieveNotionCollectionSchema(dbId, notionToken, notionVersion);
    assigneePropertyKey = resolveTaskAssigneePropertyKey(schema?.properties || {});
  } catch {
    // fallback al nombre por defecto
  }

  const properties = {
    Name: { title: [{ text: { content: `${TASK_PREFIX}${title}` } }] },
    // Guardrail: tasks mantienen su flujo operativo propio.
    Estatus: { select: { name: resolveTaskStatusByAssignee(assignee) } },
    Prioridad: { select: { name: TASK_DEFAULTS.priority } },
    Tipo: { select: { name: tipoRaw || "Music Knobs" } },
    [TASK_SHOW_IN_MANAGER_PROPERTY]: { checkbox: true },
    [TASK_FOCUS_ONLY_PROPERTY]: { checkbox: focusOnly },
  };
  if (dueDate) properties["Date (ToDo)"] = { date: { start: dueDate } };
  if (assignee) {
    properties[assigneePropertyKey] = { multi_select: [{ name: assignee }] };
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
      clearFocusTasksCache();
      return { ok: true, id: page.id };
    }

    lastError = await resp.text();
  }

  return { error: "Task create failed", details: lastError };
}

async function updateManagerTask(env, taskId, body) {
  const notionVersion = env.NOTION_VERSION || "2022-06-28";
  const notionToken = env.NOTION_TOKEN || "";
  if (!notionToken) return { error: "NOTION_TOKEN missing" };

  const status = String(body?.status || "").trim();
  const title = String(body?.title || "").trim();
  const dueDate = typeof body?.dueDate === "string" ? body.dueDate.trim() : null;
  const assigneeRaw = String(body?.assignee || "").trim().toLowerCase();
  const hasSubtasks = Array.isArray(body?.subtasks);
  const subtasks = hasSubtasks
    ? normalizeSubtasks(body.subtasks.map((s) => ({ title: String(s?.title || "").trim(), done: Boolean(s?.done) })))
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
  const assigneePropertyKey = resolveTaskAssigneePropertyKey(props);

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
    properties[assigneePropertyKey] = assigneeUser?.email
      ? { multi_select: [{ name: assigneeUser.email }] }
      : { multi_select: [] };
    if (assigneeUser?.email) {
      properties[TASK_SHOW_IN_MANAGER_PROPERTY] = { checkbox: true };
    }

    // Regla solicitada: asignado a Jay => Empezó, asignado a otro => Pendiente.
    if (assigneeUser?.email) {
      properties.Estatus = { select: { name: resolveTaskStatusByAssignee(assigneeUser.email) } };
    }
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
    clearFocusTasksCache();
  }

  if (hasSubtasks) {
    try {
      // Guardrail anti-duplicados: solo reescribir subtasks si realmente cambiaron.
      const currentBlocks = await notionGetPageChildren(taskId, notionToken, notionVersion);
      const currentSubtasks = parseSubtasksFromBlocks(currentBlocks);
      const sameSubtasks = JSON.stringify(currentSubtasks) === JSON.stringify(subtasks);
      if (!sameSubtasks) {
        await replaceSubtasks(taskId, notionToken, notionVersion, subtasks);
      }
    } catch (e) {
      return { error: "Task update failed", details: String(e?.message || e) };
    }
  }

  return { ok: true };
}

async function deleteManagerTask(env, taskId) {
  const notionVersion = env.NOTION_VERSION || "2022-06-28";
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
  clearFocusTasksCache();
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

    if (request.method === "GET" && url.pathname.startsWith("/api/audio/")) {
      const fileId = url.pathname.replace("/api/audio/", "").trim();
      return streamDriveAudioFile(fileId, request, env);
    }

    if (request.method === "GET" && url.pathname === "/api/proxy/audio") {
      const targetUrl = url.searchParams.get("url");
      if (!targetUrl) return new Response("Missing url param", { status: 400 });
      if (!targetUrl.startsWith("https://drive.google.com/") && !targetUrl.startsWith("https://docs.google.com/") && !targetUrl.startsWith("https://drive.usercontent.google.com/")) {
         return new Response("Invalid domain", { status: 400 });
      }

      const reqHeaders = new Headers();
      if (request.headers.has("Range")) reqHeaders.set("Range", request.headers.get("Range"));
      reqHeaders.set("User-Agent", request.headers.get("User-Agent") || "Mozilla/5.0");

      let driveResponse = await fetch(targetUrl, { method: "GET", headers: reqHeaders, redirect: "manual" });
      
      // Handle redirect manually to support Range requests properly across hosts if needed
      if ([301, 302, 303, 307, 308].includes(driveResponse.status)) {
         const location = driveResponse.headers.get("location");
         if (location) {
             driveResponse = await fetch(location, { method: "GET", headers: reqHeaders });
         }
      }

      const headers = new Headers(driveResponse.headers);
      headers.delete("cross-origin-resource-policy");
      headers.delete("cross-origin-embedder-policy");
      headers.delete("cross-origin-opener-policy");
      headers.delete("content-security-policy");
      headers.delete("x-frame-options");
      headers.set("Access-Control-Allow-Origin", "*");
      headers.set("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
      headers.set("Access-Control-Allow-Headers", "Range");

      return new Response(driveResponse.body, {
        status: driveResponse.status,
        statusText: driveResponse.statusText,
        headers
      });
    }

    if (request.method === "GET" && url.pathname === "/api/manager/contacts") {
      const result = await queryNotionContacts(env);
      return json(result, result.error ? 502 : 200);
    }

    if (request.method === "POST" && url.pathname === "/api/manager/contacts") {
      const body = await request.json().catch(() => ({}));
      const result = await createManagerContact(env, body);
      return json(result, result.error ? 400 : 201);
    }

    if (request.method === "GET" && url.pathname === "/api/manager/catalog") {
      if (url.searchParams.get("sync") === "1") {
        try {
          await syncCatalogFromDrive(env);
        } catch {
          // non-blocking: si falla sync, devolvemos último estado de Notion
        }
      }
      const result = await listCatalogSongs(env);
      return json(result, result.error ? 502 : 200);
    }

    if (request.method === "POST" && url.pathname === "/api/manager/catalog/sync") {
      try {
        const result = await syncCatalogFromDrive(env);
        return json(result, result.error ? 400 : 200);
      } catch (e) {
        return json({ error: "Catalog sync failed", details: String(e?.message || e) }, 500);
      }
    }

    if (request.method === "GET" && url.pathname === "/api/manager/tasks/tipo-options") {
      const notionToken = env.NOTION_TOKEN || "";
      const notionVersion = env.NOTION_VERSION || "2022-06-28";
      const dbId = env.MANAGER_TASKS_DB_ID || DEFAULT_MANAGER_TASKS_DB_ID;
      try {
        const schema = await retrieveNotionCollectionSchema(dbId, notionToken, notionVersion);
        const options = (schema?.properties?.Tipo?.select?.options || []).map((o) => o.name).filter(Boolean);
        return json({ options });
      } catch (e) {
        return json({ options: [], error: String(e?.message || e) });
      }
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

    if (request.method === "GET" && url.pathname === "/api/manager/tasks/focus") {
      const result = await listManagerFocusTasks(env, {
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

    if (request.method === "GET" && url.pathname === "/api/manager/playlists") {
      const result = await listManagerPlaylists(env);
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

    if (request.method === "POST" && url.pathname === "/api/manager/playlists") {
      const body = await request.json().catch(() => ({}));
      const result = await createManagerPlaylist(env, body);
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

    if (request.method === "PATCH" && url.pathname.startsWith("/api/manager/contacts/")) {
      const contactId = url.pathname.replace("/api/manager/contacts/", "").trim();
      if (!contactId) return json({ error: "contactId required" }, 400);
      const body = await request.json().catch(() => ({}));
      const result = await updateManagerContact(env, contactId, body);
      return json(result, result.error ? 400 : 200);
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/api/manager/contacts/")) {
      const contactId = url.pathname.replace("/api/manager/contacts/", "").trim();
      if (!contactId) return json({ error: "contactId required" }, 400);
      const result = await deleteManagerContact(env, contactId);
      return json(result, result.error ? 400 : 200);
    }

    if (request.method === "PATCH" && url.pathname.startsWith("/api/manager/messages/")) {
      const messageId = url.pathname.replace("/api/manager/messages/", "").trim();
      if (!messageId) return json({ error: "messageId required" }, 400);
      const body = await request.json().catch(() => ({}));
      const result = await updateManagerMessage(env, messageId, body);
      return json(result, result.error ? 400 : 200);
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/api/manager/messages/")) {
      const messageId = url.pathname.replace("/api/manager/messages/", "").trim();
      if (!messageId) return json({ error: "messageId required" }, 400);
      const result = await deleteManagerMessage(env, messageId);
      return json(result, result.error ? 400 : 200);
    }

    if (request.method === "PATCH" && url.pathname.startsWith("/api/manager/playlists/")) {
      const playlistId = url.pathname.replace("/api/manager/playlists/", "").trim();
      if (!playlistId) return json({ error: "playlistId required" }, 400);
      const body = await request.json().catch(() => ({}));
      const result = await updateManagerPlaylist(env, playlistId, body);
      return json(result, result.error ? 400 : 200);
    }

    if (request.method === "DELETE" && url.pathname.startsWith("/api/manager/playlists/")) {
      const playlistId = url.pathname.replace("/api/manager/playlists/", "").trim();
      if (!playlistId) return json({ error: "playlistId required" }, 400);
      const result = await deleteManagerPlaylist(env, playlistId);
      return json(result, result.error ? 400 : 200);
    }

    if (!["GET", "POST", "PATCH", "DELETE"].includes(request.method)) {
      return json({ error: "Method not allowed" }, 405);
    }

    return json({ error: "Not found", path: url.pathname }, 404);
  },
};
