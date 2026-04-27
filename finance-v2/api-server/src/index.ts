/**
 * Finance v2 API Server — puerto 8788
 *
 * Expone los datos de Engram vía HTTP para el dashboard y otros consumidores.
 * Corre local, no se expone a internet.
 *
 * Para iniciar: npm run dev
 */

import "dotenv/config";
import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import {
  getGastos,
  getIngresos,
  getFijos,
  getDeudas,
  getResumen,
  saveGasto,
  updateGasto,
  deleteGasto,
  saveRecuerdo,
} from "./engram.js";

const PORT = Number(process.env.PORT || 8788);
const API_TOKEN = process.env.API_TOKEN || "";
const NOTION_TOKEN = process.env.NOTION_TOKEN || "";
const NOTION_VERSION = process.env.NOTION_VERSION || "2022-06-28";
const DEFAULT_MANAGER_CONTACTS_DB_ID = "c4d6cef4-ddcc-436a-9576-402994a4ddac";
const MANAGER_CONTACTS_DB_ID = process.env.MANAGER_CONTACTS_DB_ID || DEFAULT_MANAGER_CONTACTS_DB_ID;
const DEFAULT_MANAGER_CATALOG_DB_ID = "348c1932-ede8-8031-ac87-f876cd74a82b";
const MANAGER_CATALOG_DB_ID = process.env.MANAGER_CATALOG_DB_ID || DEFAULT_MANAGER_CATALOG_DB_ID;
const SKILLS_DB_ID = process.env.SKILLS_DB_ID || "3373d4f4-dc22-440e-9f54-a9f0fac5d822";

const GOOGLE_DRIVE_CANCIONES_DIR = "/Users/jaystudio/Library/CloudStorage/GoogleDrive-jgmansur2@gmail.com/My Drive/Manager App/Canciones";

const managerContactsFallback = [
  {
    nombre: "Rodrigo Navarro Montealegre",
    rol: "Contacto",
    correo: "",
    telefono: "+52 55 9195 7811",
    whatsapp: "https://wa.me/525591957811",
  },
  {
    nombre: "Patricia Monsell",
    rol: "Contacto",
    correo: "",
    telefono: "+52 415 101 6377",
    whatsapp: "https://wa.me/524151016377",
  },
  {
    nombre: "Kazim Mohamed",
    rol: "Contacto",
    correo: "",
    telefono: "+52 81 1044 6279",
    whatsapp: "https://wa.me/528110446279",
  },
  {
    nombre: "Elva Juanita Torres",
    rol: "Contacto",
    correo: "",
    telefono: "+52 81 1600 6251",
    whatsapp: "https://wa.me/528116006251",
  },
  {
    nombre: "Tecmilenio Oficina",
    rol: "Contacto",
    correo: "",
    telefono: "+52 81 1824 0040",
    whatsapp: "https://wa.me/528118240040",
  },
  {
    nombre: "Jay Mansur",
    rol: "Contacto",
    correo: "",
    telefono: "+52 55 4345 4693",
    whatsapp: "https://wa.me/5543454693",
  },
];

const app = Fastify({ logger: { level: "info" } });

await app.register(cors, {
  origin: true,
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type"],
});

// ─── AUTH ────────────────────────────────────────────────────────────────────

app.addHook("onRequest", async (req, reply) => {
  if (req.url === "/health") return;

  // Sin token configurado: acceso libre (solo local)
  if (!API_TOKEN) return;

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (token !== API_TOKEN) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
});

// ─── HEALTH ──────────────────────────────────────────────────────────────────

app.get("/health", async () => ({
  ok: true,
  service: "finance-v2-api-server",
  version: "0.1.0",
  manager: {
    contactsConfigured: Boolean(NOTION_TOKEN && MANAGER_CONTACTS_DB_ID),
    contactsDbId: MANAGER_CONTACTS_DB_ID,
  },
}));

// ─── GASTOS ──────────────────────────────────────────────────────────────────

app.get("/api/engram/gastos", async (req, reply) => {
  const schema = z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  return { data: await getGastos(parsed.data.month) };
});

app.get("/api/engram/ingresos", async (req, reply) => {
  const schema = z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  return { data: await getIngresos(parsed.data.month) };
});

app.post("/api/engram/gasto", async (req, reply) => {
  const schema = z.object({
    fecha: z.string().optional(),
    monto: z.number().positive(),
    moneda: z.string().optional().default("MXN"),
    concepto: z.string().min(1),
    lugar: z.string().optional().default(""),
    forma_pago: z.string().optional().default(""),
    tipo: z.enum(["Gasto", "Ingreso", "gasto", "ingreso"]).optional().default("Gasto"),
    recibo: z.string().optional().default(""),
    fuente: z.string().optional().default("api-server"),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const id = await saveGasto(parsed.data);
  return reply.code(201).send({ ok: true, id });
});

app.put("/api/engram/gasto/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const schema = z.object({
    concepto: z.string().optional(),
    monto: z.number().optional(),
    lugar: z.string().optional(),
    forma_pago: z.string().optional(),
    tipo: z.string().optional(),
    fecha: z.string().optional(),
    recibo: z.string().optional(),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const ok = await updateGasto(Number(id), parsed.data);
  if (!ok) return reply.code(404).send({ error: "Gasto not found or not editable" });
  return { ok: true };
});

app.delete("/api/engram/gasto/:id", async (req, reply) => {
  const { id } = req.params as { id: string };
  const ok = await deleteGasto(Number(id));
  if (!ok) return reply.code(404).send({ error: "Gasto not found or not deletable" });
  return { ok: true };
});

// ─── FIJOS ───────────────────────────────────────────────────────────────────

app.get("/api/engram/fijos", async () => {
  return { data: await getFijos() };
});

// ─── DEUDAS ──────────────────────────────────────────────────────────────────

app.get("/api/engram/deudas", async () => {
  return { data: await getDeudas() };
});

// ─── RECUERDOS ───────────────────────────────────────────────────────────────

app.post("/api/engram/recuerdo", async (req, reply) => {
  const schema = z.object({
    texto: z.string().min(1),
    fecha: z.string().optional(),
    url: z.string().optional().default(""),
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const id = await saveRecuerdo(parsed.data);
  return reply.code(201).send({ ok: true, id });
});

// ─── RESUMEN ─────────────────────────────────────────────────────────────────

app.get("/api/engram/resumen", async (req, reply) => {
  const currentMonth = new Date().toISOString().slice(0, 7);
  const schema = z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/).optional().default(currentMonth),
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  return await getResumen(parsed.data.month);
});

// ─── MANAGER APP ─────────────────────────────────────────────────────────────

type NotionPage = {
  properties?: Record<string, any>;
};

function notionRichTextToString(value: any): string {
  if (!Array.isArray(value)) return "";
  return value.map((x) => x?.plain_text || "").join("").trim();
}

function readNotionTitle(props: Record<string, any>): string {
  const titleProp = Object.values(props).find((p: any) => p?.type === "title");
  return notionRichTextToString((titleProp as any)?.title);
}

function readNotionEmail(props: Record<string, any>): string {
  for (const [name, prop] of Object.entries(props)) {
    const key = name.toLowerCase();
    if (!["email", "correo", "mail", "e-mail"].some((k) => key.includes(k))) continue;
    if ((prop as any)?.type === "email") return (prop as any).email || "";
    if ((prop as any)?.type === "rich_text") return notionRichTextToString((prop as any).rich_text);
  }
  return "";
}

function readNotionPhone(props: Record<string, any>): string {
  for (const [name, prop] of Object.entries(props)) {
    const key = name.toLowerCase();
    if (!["telefono", "teléfono", "phone", "cel", "movil", "móvil"].some((k) => key.includes(k))) continue;
    if ((prop as any)?.type === "phone_number") return (prop as any).phone_number || "";
    if ((prop as any)?.type === "rich_text") return notionRichTextToString((prop as any).rich_text);
  }
  return "";
}

function readNotionWhatsapp(props: Record<string, any>): string {
  for (const [name, prop] of Object.entries(props)) {
    const key = name.toLowerCase();
    if (!["whatsapp", "wa"].some((k) => key.includes(k))) continue;
    if ((prop as any)?.type === "url") return (prop as any).url || "";
    if ((prop as any)?.type === "rich_text") return notionRichTextToString((prop as any).rich_text);
  }
  return "";
}

function readNotionRole(props: Record<string, any>): string {
  for (const [name, prop] of Object.entries(props)) {
    const key = name.toLowerCase();
    if (!["rol", "role", "puesto", "cargo"].some((k) => key.includes(k))) continue;
    if ((prop as any)?.type === "select") return (prop as any).select?.name || "";
    if ((prop as any)?.type === "rich_text") return notionRichTextToString((prop as any).rich_text);
    if ((prop as any)?.type === "multi_select") {
      return ((prop as any).multi_select || []).map((x: any) => x?.name).filter(Boolean).join(", ");
    }
  }
  return "";
}

function readNotionMultiSelect(props: Record<string, any>, possibleKeys: string[]): string {
  for (const [name, prop] of Object.entries(props)) {
    const key = name.toLowerCase();
    if (!possibleKeys.some((k) => key.includes(k))) continue;
    if ((prop as any)?.type === "multi_select") {
      return ((prop as any).multi_select || []).map((x: any) => x?.name).filter(Boolean).join(", ");
    }
    if ((prop as any)?.type === "select") return (prop as any).select?.name || "";
    if ((prop as any)?.type === "rich_text") return notionRichTextToString((prop as any).rich_text);
  }
  return "";
}

function readNotionUrl(props: Record<string, any>, possibleKeys: string[]): string {
  for (const [name, prop] of Object.entries(props)) {
    const key = name.toLowerCase();
    if (!possibleKeys.some((k) => key.includes(k))) continue;
    if ((prop as any)?.type === "url" && (prop as any).url) return (prop as any).url;
    if ((prop as any)?.type === "rich_text") {
      const text = notionRichTextToString((prop as any).rich_text);
      if (text) return text;
    }
  }
  return "";
}

async function queryNotionDatabase(dbOrDataSourceId: string) {
  const endpoints = [
    `https://api.notion.com/v1/data_sources/${dbOrDataSourceId}/query`,
    `https://api.notion.com/v1/databases/${dbOrDataSourceId}/query`,
  ];

  let lastError = "";

  for (const url of endpoints) {
    const notionResp = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${NOTION_TOKEN}`,
        "Notion-Version": NOTION_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ page_size: 100 }),
    });

    if (notionResp.ok) {
      return notionResp.json() as Promise<{ results?: NotionPage[] }>;
    }

    lastError = await notionResp.text();
  }

  throw new Error(lastError || "Notion query failed");
}

app.get("/api/manager/contacts", async (req, reply) => {
  if (!NOTION_TOKEN) {
    return {
      source: "fallback",
      warning: "NOTION_TOKEN not configured. Returning local fallback contacts.",
      data: managerContactsFallback,
    };
  }

  try {
    const payload = await queryNotionDatabase(MANAGER_CONTACTS_DB_ID);
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
  } catch (e: any) {
    return reply.code(500).send({ error: "Manager contacts error", details: String(e?.message || e), data: [] });
  }
});

app.get("/api/manager/catalog", async (req, reply) => {
  if (!NOTION_TOKEN) return { data: [] };
  try {
    const payload = await queryNotionDatabase(MANAGER_CATALOG_DB_ID);
    const data = (payload.results || []).map((page) => {
      const props = page.properties || {};
      return {
        id: page.id,
        obra: readNotionTitle(props),
        autores: readNotionMultiSelect(props, ["autor", "autores"]),
        generos: readNotionMultiSelect(props, ["genero", "género"]),
        drive: readNotionUrl(props, ["play", "youtube url"]),
      };
    });
    return { data };
  } catch (e: any) {
    return reply.code(500).send({ error: "Catalog error", details: String(e?.message || e), data: [] });
  }
});

app.get("/api/skills", async (req, reply) => {
  if (!NOTION_TOKEN) return { skills: [] };
  try {
    const payload = await queryNotionDatabase(SKILLS_DB_ID);
    const skills = (payload.results || []).map((page: any) => {
      const props = page.properties || {};
      return {
        name: notionRichTextToString(props["Nombre"]?.title || []),
        description: notionRichTextToString(props["Descripción"]?.rich_text || []),
        category: props["Categoría"]?.select?.name || "",
        scope: props["Scope"]?.select?.name || "",
        ais: (props["AIs Instalados"]?.multi_select || []).map((x: any) => x.name),
        trigger: notionRichTextToString(props["Trigger"]?.rich_text || []),
        howTo: notionRichTextToString(props["Cómo usar"]?.rich_text || []),
        skillPath: notionRichTextToString(props["Ruta SKILL.md"]?.rich_text || []),
        version: notionRichTextToString(props["Versión"]?.rich_text || []),
      };
    }).filter((s: any) => s.name);
    return { skills };
  } catch (e: any) {
    return reply.code(500).send({ error: "Skills error", details: String(e?.message || e), skills: [] });
  }
});

// Helper for finding files recursively
function getAudioFilesRecursively(dir: string, fileList: string[] = []) {
  if (!fs.existsSync(dir)) return fileList;
  const files = fs.readdirSync(dir);
  for (const file of files) {
    const filePath = path.join(dir, file);
    if (fs.statSync(filePath).isDirectory()) {
      getAudioFilesRecursively(filePath, fileList);
    } else if (file.endsWith(".mp3") || file.endsWith(".wav") || file.endsWith(".m4a")) {
      fileList.push(filePath);
    }
  }
  return fileList;
}

app.post("/api/manager/catalog/sync", async (req, reply) => {
  if (!NOTION_TOKEN) return reply.code(400).send({ error: "NOTION_TOKEN not configured" });

  try {
    // 1. Get existing Notion entries 
    const payload = await queryNotionDatabase(MANAGER_CATALOG_DB_ID);
    const existingTitles = new Set(
      (payload.results || []).map((page) => readNotionTitle(page.properties || {}).toLowerCase())
    );

    // 2. Read local drive folder
    const audioFiles = getAudioFilesRecursively(GOOGLE_DRIVE_CANCIONES_DIR);
    let synced = 0;

    for (const filePath of audioFiles) {
      const fileName = path.basename(filePath, path.extname(filePath)); // "Perra Soledad"
      if (existingTitles.has(fileName.toLowerCase())) continue; // Already in DB

      // Get genre from parent folder name
      const parentDir = path.basename(path.dirname(filePath));
      const genre = parentDir !== "Canciones" ? parentDir : "Otro";

      // 3. Obtain Google Drive file ID from xattr
      let driveUrl = "";
      try {
        const xattrCmd = `xattr -p "com.google.drivefs.item-id#S" "${filePath}"`;
        const driveId = execSync(xattrCmd, { encoding: "utf-8", stdio: "pipe" }).trim();
        if (driveId) {
          driveUrl = `https://drive.google.com/file/d/${driveId}/view?usp=drive_link`;
        }
      } catch (e) {
        // xattr failed or attribute not present
      }

      // 4. Create in Notion
      const createResp = await fetch("https://api.notion.com/v1/pages", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${NOTION_TOKEN}`,
          "Notion-Version": NOTION_VERSION,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          parent: { database_id: MANAGER_CATALOG_DB_ID },
          properties: {
            "Name": { title: [{ text: { content: fileName } }] },
            "Autores": { multi_select: [{ name: "Jay Mansur" }] },
            "Genero": { multi_select: [{ name: genre }] },
            "Play": { url: driveUrl || null }
          }
        }),
      });

      if (createResp.ok) {
        synced++;
        existingTitles.add(fileName.toLowerCase());
      }
    }

    return { ok: true, synced };
  } catch (e: any) {
    return reply.code(500).send({ error: "Sync failed", details: String(e?.message || e) });
  }
});

// ─── START ───────────────────────────────────────────────────────────────────

async function main() {
  await app.listen({ port: PORT, host: "127.0.0.1" });
  console.log(`Finance v2 API running on http://127.0.0.1:${PORT}`);
}

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
