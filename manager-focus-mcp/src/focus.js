/**
 * focus.js — Capa de dominio del Focus de Manager App.
 *
 * Puerto directo de ~/tools/focus_manager.py. Toda la lógica de negocio vive
 * aquí y no sabe nada de MCP: recibe argumentos planos y devuelve resultados
 * planos. El transporte (src/index.js) sólo la envuelve.
 *
 * Nunca toca Notion. Todo pasa por el Worker manager-app-proxy.
 */

const TZ = "America/Mexico_City";

// México es UTC-6 todo el año (sin horario de verano desde 2022).
const MX_OFFSET = "-06:00";

// El proxy no tiene auth propia; estos headers imitan un navegador para pasar
// el WAF de Cloudflare, igual que hace focus_manager.py.
const PROXY_HEADERS = {
  "Content-Type": "application/json",
  Accept: "application/json",
  Origin: "https://musicknobs.github.io",
  Referer: "https://musicknobs.github.io/",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
};

// ── Fechas ────────────────────────────────────────────────────────────────────

const WEEKDAYS_ES = {
  lunes: 1, martes: 2, miércoles: 3, miercoles: 3,
  jueves: 4, viernes: 5, sábado: 6, sabado: 6, domingo: 0,
};

const DAYS_ES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

/** Fecha de hoy en México como "YYYY-MM-DD". */
export function todayIso() {
  return new Date().toLocaleDateString("en-CA", { timeZone: TZ });
}

/** Suma días a una fecha ISO pura, sin que la zona horaria del runtime interfiera. */
function addDays(iso, days) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function weekdayOf(iso) {
  return new Date(`${iso}T12:00:00Z`).getUTCDay();
}

/**
 * Convierte expresiones en español a "YYYY-MM-DD".
 * Nunca lanza: si no reconoce la expresión, devuelve hoy.
 */
export function parseRelativeDate(text) {
  const today = todayIso();
  const t = String(text || "").trim().toLowerCase();

  // ISO directo, pero sólo si es una fecha que existe de verdad: "2026-13-45"
  // tiene la forma correcta y Notion la rechazaría.
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) {
    const parsed = new Date(`${t}T12:00:00Z`);
    if (!Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === t) return t;
    return today;
  }

  if (["hoy", "today"].includes(t)) return today;
  if (["mañana", "manana", "tomorrow"].includes(t)) return addDays(today, 1);
  if (["pasado mañana", "pasado manana"].includes(t)) return addDays(today, 2);
  if (["ayer", "yesterday"].includes(t)) return addDays(today, -1);
  if (["antier", "anteayer"].includes(t)) return addDays(today, -2);

  const inN = t.match(/en\s+(\d+)\s+(d[ií]as?|semanas?)/);
  if (inN) {
    const n = parseInt(inN[1], 10);
    return addDays(today, inN[2].startsWith("semana") ? n * 7 : n);
  }

  if (/pr[óo]xima semana|siguiente semana/.test(t)) return addDays(today, 7);

  for (const [name, wd] of Object.entries(WEEKDAYS_ES)) {
    if (t.includes(name)) {
      const ahead = (wd - weekdayOf(today) + 7) % 7 || 7;
      return addDays(today, ahead);
    }
  }

  return today; // fallback seguro
}

/** Fecha ISO → timestamp Notion a las 09:00 hora de México. */
export function toNotionDate(iso) {
  return `${iso}T09:00:00${MX_OFFSET}`;
}

/** Fecha ISO → texto natural ("hoy", "mañana", "el jueves (28/08)"). */
export function friendlyDate(iso) {
  const today = todayIso();
  const delta = Math.round(
    (new Date(`${iso}T12:00:00Z`) - new Date(`${today}T12:00:00Z`)) / 86400000,
  );
  if (delta === 0) return "hoy";
  if (delta === 1) return "mañana";
  if (delta === 2) return "pasado mañana";
  if (delta === -1) return "ayer";
  if (delta === -2) return "antier";

  const [y, m, d] = iso.split("-");
  if (delta >= 3 && delta <= 7) return `el ${DAYS_ES[weekdayOf(iso)]} (${d}/${m})`;
  return `${d}/${m}/${y}`;
}

// ── Cliente del proxy ─────────────────────────────────────────────────────────

class ProxyError extends Error {}

function proxyBase(env) {
  return (env.PROXY_URL || "https://manager-app-proxy.musicknobs.workers.dev").replace(/\/$/, "");
}

function viewerEmail(env) {
  return env.VIEWER_EMAIL || "jgmansur2@gmail.com";
}

async function request(env, method, path, payload) {
  const url = `${proxyBase(env)}${path}`;
  const init = { method, headers: PROXY_HEADERS };
  if (payload !== undefined) init.body = JSON.stringify(payload);

  // Con service binding la llamada va Worker→Worker directo. Sin él (tests,
  // `wrangler dev` aislado) cae al fetch normal.
  const resp = env.PROXY ? await env.PROXY.fetch(url, init) : await fetch(url, init);
  const text = await resp.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new ProxyError(`Respuesta no-JSON del proxy (HTTP ${resp.status}): ${text.slice(0, 200)}`);
  }

  if (!resp.ok) {
    throw new ProxyError(`HTTP ${resp.status} ${method} ${path}: ${text.slice(0, 200)}`);
  }
  // El proxy responde 200 con {error} en algunos casos.
  if (data && data.error) {
    throw new ProxyError(`${data.error}${data.details ? ` — ${data.details}` : ""}`);
  }
  return data;
}

/** Tareas de hoy + atrasadas. */
export function getFocus(env) {
  return request(
    env,
    "GET",
    `/api/manager/tasks/focus?scope=mine&viewer=${encodeURIComponent(viewerEmail(env))}`,
  );
}

/** Opciones reales de los select de Notion. Fuente de verdad del schema. */
export function getFieldOptions(env) {
  return request(env, "GET", "/api/manager/tasks/field-options");
}

/**
 * Valor exacto del status "terminado", leído del schema en vivo.
 * Nunca se hardcodea: si en Notion se renombra la opción, esto sigue funcionando.
 */
async function resolveDoneStatus(env) {
  const opts = await getFieldOptions(env);
  const statuses = opts.status || [];
  const hit = statuses.find((s) =>
    ["terminado", "terminó", "termino", "done", "completed"].includes(s.toLowerCase()),
  );
  return hit || statuses[0] || "Terminado";
}

const patchTask = (env, id, body) => request(env, "PATCH", `/api/manager/tasks/${id}`, body);

// ── Fuzzy matching ────────────────────────────────────────────────────────────

const normalize = (text) =>
  String(text || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");

const taskName = (t) => t.name || t.title || "";

/**
 * Busca la tarea más cercana al query, en cascada de precisión.
 * Devuelve { match, candidates }: si match es null y hay varios candidatos,
 * el llamador debe preguntar en vez de adivinar.
 */
export function findTask(query, tasks) {
  const q = normalize(query);

  const exact = tasks.find((t) => normalize(taskName(t)) === q);
  if (exact) return { match: exact, candidates: [exact] };

  const contains = tasks.filter((t) => normalize(taskName(t)).includes(q));
  if (contains.length === 1) return { match: contains[0], candidates: contains };
  if (contains.length > 1) return { match: null, candidates: contains };

  const words = q.split(/\s+/).filter(Boolean);
  const allWords = tasks.filter((t) => words.every((w) => normalize(taskName(t)).includes(w)));
  if (allWords.length === 1) return { match: allWords[0], candidates: allWords };
  if (allWords.length > 1) return { match: null, candidates: allWords };

  const half = Math.max(1, Math.floor(words.length / 2));
  const partial = tasks.filter(
    (t) => words.filter((w) => normalize(taskName(t)).includes(w)).length >= half,
  );
  if (partial.length === 1) return { match: partial[0], candidates: partial };
  return { match: null, candidates: partial };
}

const ok = (message, data = {}) => ({ ok: true, message, data });
const fail = (message, data = {}) => ({ ok: false, message, data });

/**
 * Resuelve un query a una tarea concreta, o explica por qué no pudo.
 * Centraliza el "no adivines, pregunta" que exige el skill ivy-focus-manager.
 */
function resolveOne(query, tasks, scopeLabel) {
  if (!tasks.length) return { error: fail(`No hay tareas ${scopeLabel} ahora mismo.`) };

  const { match, candidates } = findTask(query, tasks);

  if (!match && !candidates.length) {
    const sample = tasks.slice(0, 5).map(taskName).join(", ");
    return {
      error: fail(
        `No encontré ninguna tarea que coincida con «${query}».\nTareas ${scopeLabel}: ${sample}`,
        { candidates: [] },
      ),
    };
  }

  if (!match && candidates.length > 1) {
    const names = candidates.slice(0, 5).map((t) => `  • ${taskName(t)}`).join("\n");
    return {
      error: fail(
        `Encontré varias tareas que podrían ser «${query}»:\n${names}\n\nDime cuál exactamente.`,
        { candidates: candidates.slice(0, 5).map((t) => ({ id: t.id, title: taskName(t) })) },
      ),
    };
  }

  return { task: match || candidates[0] };
}

// ── Acciones ──────────────────────────────────────────────────────────────────

export async function listFocus(env) {
  const data = await getFocus(env);
  const today = data.today || [];
  const overdue = data.overdue || [];
  const lines = [];

  if (today.length) {
    const [, m, d] = todayIso().split("-");
    lines.push(`📅 HOY (${d}/${m}) — ${today.length} tarea(s):`);
    today.forEach((t, i) => lines.push(`  ${i + 1}. ${taskName(t)}`));
  } else {
    lines.push("📅 Hoy: sin tareas programadas.");
  }

  if (overdue.length) {
    lines.push(`\n⚠️  ATRASADAS — ${overdue.length} tarea(s):`);
    overdue.forEach((t, i) =>
      lines.push(`  ${i + 1}. ${taskName(t)}  [${(t.dueDate || "?").slice(0, 10)}]`),
    );
  }

  if (!today.length && !overdue.length) lines.push("✅ Focus vacío — sin pendientes.");

  return ok(lines.join("\n"), { today, overdue });
}

export async function showBacklog(env) {
  const { overdue = [] } = await getFocus(env);
  if (!overdue.length) return ok("✅ Sin tareas atrasadas. El backlog está limpio.", { overdue: [] });

  const lines = [`⚠️  BACKLOG — ${overdue.length} tarea(s) atrasada(s):`];
  overdue.forEach((t, i) =>
    lines.push(`  ${i + 1}. ${taskName(t)}  [${(t.dueDate || "?").slice(0, 10)}]`),
  );
  return ok(lines.join("\n"), { overdue });
}

export async function markDone(env, query) {
  const data = await getFocus(env);
  const all = [...(data.today || []), ...(data.overdue || [])];

  const { task, error } = resolveOne(query, all, "en el Focus");
  if (error) return error;

  await patchTask(env, task.id, { status: await resolveDoneStatus(env) });
  return ok(`✅ «${taskName(task)}» marcada como terminada.`, { task });
}

export async function moveTask(env, query, dateExpr) {
  const data = await getFocus(env);
  const all = [...(data.today || []), ...(data.overdue || [])];

  const { task, error } = resolveOne(query, all, "en el Focus");
  if (error) return error;

  const target = parseRelativeDate(dateExpr);
  await patchTask(env, task.id, { dueDate: toNotionDate(target) });
  return ok(`📅 «${taskName(task)}» movida para ${friendlyDate(target)}.`, {
    task,
    newDate: target,
  });
}

export async function promoteFromBacklog(env, query, dateExpr = "hoy") {
  const { overdue = [] } = await getFocus(env);
  if (!overdue.length) return ok("No hay tareas atrasadas en el backlog.", { moved: [] });

  const target = parseRelativeDate(dateExpr);
  const notionDate = toNotionDate(target);
  const friendly = friendlyDate(target);

  const wantsAll = !query || ["todas", "all", "todo"].includes(String(query).toLowerCase());

  if (wantsAll) {
    const moved = [];
    const errors = [];
    for (const t of overdue) {
      try {
        await patchTask(env, t.id, { dueDate: notionDate });
        moved.push(taskName(t));
      } catch (e) {
        errors.push(`${taskName(t)}: ${e.message}`);
      }
    }
    let msg = `📅 ${moved.length} tarea(s) del backlog movidas a ${friendly}.`;
    if (errors.length) msg += `\n⚠️  Errores: ${errors.join("; ")}`;
    return ok(msg, { moved, errors, newDate: target });
  }

  const { task, error } = resolveOne(query, overdue, "en el backlog");
  if (error) return error;

  await patchTask(env, task.id, { dueDate: notionDate });
  return ok(`📅 «${taskName(task)}» movida a ${friendly}.`, { task, newDate: target });
}

/**
 * Crea una tarea nueva en el Focus.
 *
 * `tipo` se valida contra las opciones reales del select de Notion: si no
 * existe, se rechaza con la lista válida en vez de inventar una opción nueva.
 */
export async function createTask(env, { title, dueDate, tipo, focusOnly, subtasks } = {}) {
  const clean = String(title || "").trim();
  if (!clean) return fail("Falta el título de la tarea.");

  let resolvedTipo = String(tipo || "").trim();
  if (resolvedTipo) {
    const opts = await getFieldOptions(env);
    const valid = opts.tipo || [];
    const hit = valid.find((o) => normalize(o) === normalize(resolvedTipo));
    if (!hit) {
      return fail(
        `El tipo «${resolvedTipo}» no existe en Notion.\nOpciones válidas: ${valid.join(", ")}`,
        { validTipos: valid },
      );
    }
    resolvedTipo = hit; // usa la capitalización exacta del schema
  }

  const target = parseRelativeDate(dueDate || "hoy");
  const body = {
    title: clean,
    dueDate: toNotionDate(target),
    focusOnly: Boolean(focusOnly),
  };
  if (resolvedTipo) body.tipo = resolvedTipo;
  if (Array.isArray(subtasks) && subtasks.length) {
    body.subtasks = subtasks.map((s) => ({
      title: String(typeof s === "string" ? s : s?.title || "").trim(),
      done: typeof s === "string" ? false : Boolean(s?.done),
    })).filter((s) => s.title);
  }

  const res = await request(env, "POST", "/api/manager/tasks", body);
  return ok(`✅ Tarea «${clean}» creada para ${friendlyDate(target)}.`, {
    id: res.id,
    title: clean,
    dueDate: target,
    tipo: resolvedTipo || "Music Knobs",
  });
}
