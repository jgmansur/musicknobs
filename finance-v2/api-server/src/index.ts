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

// ─── START ───────────────────────────────────────────────────────────────────

async function main() {
  await app.listen({ port: PORT, host: "127.0.0.1" });
  console.log(`Finance v2 API running on http://127.0.0.1:${PORT}`);
}

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
