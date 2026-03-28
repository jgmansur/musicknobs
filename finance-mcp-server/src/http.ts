import Fastify from "fastify";
import cors from "@fastify/cors";
import { z } from "zod";
import { assertConfig, config } from "./config.js";
import {
  findProfileField,
  getExpensesByAccount,
  getFixedStatus,
  getFinanceSummary,
  getInvestmentsSnapshot,
  getWidgetAccountsSnapshot,
  getWidgetDashboardSnapshot,
  searchPrompts,
  searchDocuments,
} from "./data.js";
import { syncAiMirror } from "./mirror.js";

assertConfig();

const app = Fastify({ logger: true });

await app.register(cors, {
  origin: true,
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Authorization", "Content-Type", "x-widget-token"],
});

app.addHook("onRequest", async (req, reply) => {
  if (req.url === "/health") return;

  if (req.url.startsWith("/api/widget/accounts") || req.url.startsWith("/api/widget/dashboard")) {
    const expected = (config.widgetToken || "").trim();
    const queryToken = String((req.query as Record<string, unknown>)?.token || "").trim();
    const headerToken = String(req.headers["x-widget-token"] || "").trim();
    const token = headerToken || queryToken;
    if (!expected) {
      return reply.code(503).send({ error: "Widget endpoint disabled" });
    }
    if (!token || token !== expected) {
      return reply.code(401).send({ error: "Unauthorized" });
    }
    return;
  }

  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token || token !== config.apiToken) {
    return reply.code(401).send({ error: "Unauthorized" });
  }
});

app.get("/health", async () => ({ ok: true, service: "finance-mcp-server" }));

app.get("/api/profile/field", async (req, reply) => {
  const schema = z.object({
    member: z.string().optional(),
    field: z.enum(["curp", "passportMx", "passportUs", "visaUs", "birthDate", "name", "notes"]),
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  const data = await findProfileField(parsed.data.member, parsed.data.field);
  return data || { error: "No profile match found" };
});

app.get("/api/finance/summary", async (req, reply) => {
  const schema = z.object({
    from: z.string().optional(),
    to: z.string().optional(),
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  return getFinanceSummary(parsed.data.from, parsed.data.to);
});

app.get("/api/finance/by-account", async (req, reply) => {
  const schema = z.object({
    account: z.string().min(1),
    from: z.string().optional(),
    to: z.string().optional(),
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  return getExpensesByAccount(parsed.data.account, parsed.data.from, parsed.data.to);
});

app.get("/api/investments", async () => getInvestmentsSnapshot());

app.get("/api/fixed/status", async (req, reply) => {
  const schema = z.object({
    month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  return getFixedStatus(parsed.data.month);
});

app.get("/api/documents/search", async (req, reply) => {
  const schema = z.object({
    query: z.string().min(1),
    member: z.string().optional(),
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  return searchDocuments(parsed.data.query, parsed.data.member);
});

app.get("/api/prompts/search", async (req, reply) => {
  const schema = z.object({
    query: z.string().optional().default(""),
    platform: z.string().optional(),
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  return searchPrompts(parsed.data.query, parsed.data.platform);
});

app.get("/api/widget/accounts", async (req, reply) => {
  const schema = z.object({
    token: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(20).optional(),
    includeHidden: z.coerce.boolean().optional(),
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  reply.header("Cache-Control", "no-store, max-age=0");
  reply.header("Pragma", "no-cache");
  return getWidgetAccountsSnapshot(parsed.data.limit || 8, !!parsed.data.includeHidden);
});

app.get("/api/widget/dashboard", async (req, reply) => {
  const schema = z.object({
    token: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(20).optional(),
    includeHidden: z.coerce.boolean().optional(),
    focusAccount: z.string().optional(),
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  reply.header("Cache-Control", "no-store, max-age=0");
  reply.header("Pragma", "no-cache");
  return getWidgetDashboardSnapshot(
    parsed.data.limit || 6,
    !!parsed.data.includeHidden,
    (parsed.data.focusAccount || "Santander").trim() || "Santander",
    { preferCache: true },
  );
});

app.get("/api/widget/dashboard/live", async (req, reply) => {
  const schema = z.object({
    token: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(20).optional(),
    includeHidden: z.coerce.boolean().optional(),
    focusAccount: z.string().optional(),
  });
  const parsed = schema.safeParse(req.query);
  if (!parsed.success) return reply.code(400).send({ error: parsed.error.flatten() });
  reply.header("Cache-Control", "no-store, max-age=0");
  reply.header("Pragma", "no-cache");
  return getWidgetDashboardSnapshot(
    parsed.data.limit || 6,
    !!parsed.data.includeHidden,
    (parsed.data.focusAccount || "Santander").trim() || "Santander",
    { preferCache: false },
  );
});

app.post("/api/ai-mirror/sync", async (_req, reply) => {
  try {
    return await syncAiMirror();
  } catch (error) {
    reqLogError(error);
    return reply.code(500).send({ error: "AI mirror sync failed", details: String((error as Error)?.message || error) });
  }
});

app.get("/api/ai-mirror/sync", async (_req, reply) => {
  try {
    return await syncAiMirror();
  } catch (error) {
    reqLogError(error);
    return reply.code(500).send({ error: "AI mirror sync failed", details: String((error as Error)?.message || error) });
  }
});

function reqLogError(error: unknown) {
  app.log.error(error);
}

async function main() {
  await app.listen({ port: config.port, host: "0.0.0.0" });
}

main().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
