import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { assertConfig } from "./config.js";
import {
  addTransaction,
  findProfileField,
  getAccounts,
  getExpensesByAccount,
  getFixedStatus,
  getFinanceSummary,
  getInvestmentsSnapshot,
  getTransactions,
  markFixedPaid,
  searchPrompts,
  searchDocuments,
  updateAccountBalance,
} from "./data.js";
import { syncAiMirror } from "./mirror.js";
import { safeJson } from "./utils.js";

assertConfig();

const server = new McpServer({
  name: "finance-mcp-server",
  version: "0.1.0",
});

server.tool(
  "get_profile_field",
  {
    member: z.string().optional(),
    field: z.enum(["curp", "passportMx", "passportUs", "visaUs", "birthDate", "name", "notes"]),
  },
  async ({ member, field }) => {
    const result = await findProfileField(member, field);
    return {
      content: [
        {
          type: "text",
          text: safeJson(result || { error: "No profile match found" }),
        },
      ],
    };
  },
);

server.tool(
  "get_finance_summary",
  {
    from: z.string().optional(),
    to: z.string().optional(),
  },
  async ({ from, to }) => {
    const result = await getFinanceSummary(from, to);
    return { content: [{ type: "text", text: safeJson(result) }] };
  },
);

server.tool(
  "get_expenses_by_account",
  {
    account: z.string(),
    from: z.string().optional(),
    to: z.string().optional(),
  },
  async ({ account, from, to }) => {
    const result = await getExpensesByAccount(account, from, to);
    return { content: [{ type: "text", text: safeJson(result) }] };
  },
);

server.tool(
  "get_fixed_status",
  {
    month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  },
  async ({ month }) => {
    const result = await getFixedStatus(month);
    return { content: [{ type: "text", text: safeJson(result) }] };
  },
);

server.tool("get_investments_snapshot", {}, async () => {
  const result = await getInvestmentsSnapshot();
  return { content: [{ type: "text", text: safeJson(result) }] };
});

server.tool(
  "search_documents",
  {
    query: z.string(),
    member: z.string().optional(),
  },
  async ({ query, member }) => {
    const result = await searchDocuments(query, member);
    return { content: [{ type: "text", text: safeJson(result) }] };
  },
);

server.tool(
  "search_prompts",
  {
    query: z.string().optional(),
    platform: z.string().optional(),
  },
  async ({ query, platform }) => {
    const result = await searchPrompts(query || "", platform);
    return { content: [{ type: "text", text: safeJson(result) }] };
  },
);

server.tool("sync_ai_mirror", {}, async () => {
  const result = await syncAiMirror();
  return { content: [{ type: "text", text: safeJson(result) }] };
});

server.tool(
  "get_accounts",
  {
    includeHidden: z.boolean().optional(),
  },
  async ({ includeHidden }) => {
    const accounts = await getAccounts();
    const visible = includeHidden ? accounts : accounts.filter((a) => !a.hidden);
    return { content: [{ type: "text", text: safeJson({ count: visible.length, accounts: visible }) }] };
  },
);

server.tool(
  "get_transactions",
  {
    from: z.string().optional(),
    to: z.string().optional(),
    search: z.string().optional(),
    limit: z.number().int().positive().optional(),
  },
  async ({ from, to, search, limit }) => {
    const result = await getTransactions(from, to, search, limit);
    return { content: [{ type: "text", text: safeJson(result) }] };
  },
);

server.tool(
  "add_transaction",
  {
    lugar: z.string(),
    monto: z.number().positive(),
    tipo: z.enum(["Gasto", "Ingreso"]),
    formaPago: z.string().optional(),
    concepto: z.string().optional(),
    fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    moneda: z.enum(["MXN", "USD"]).optional(),
  },
  async ({ lugar, monto, tipo, formaPago, concepto, fecha, moneda }) => {
    await addTransaction({ lugar, monto, tipo, formaPago, concepto, fecha, moneda });
    return {
      content: [
        {
          type: "text",
          text: safeJson({
            ok: true,
            message: `Transacción agregada: ${tipo} $${monto} en ${lugar}`,
            fecha: fecha || new Date().toISOString().slice(0, 10),
          }),
        },
      ],
    };
  },
);

server.tool(
  "update_account_balance",
  {
    account: z.string(),
    balance: z.number(),
    currency: z.enum(["MXN", "USD", "BTC"]).optional(),
  },
  async ({ account, balance, currency }) => {
    await updateAccountBalance(account, balance, currency);
    return {
      content: [
        {
          type: "text",
          text: safeJson({
            ok: true,
            message: `Saldo actualizado: ${account} → ${balance}${currency ? ` ${currency}` : ""}`,
          }),
        },
      ],
    };
  },
);

server.tool(
  "mark_fixed_paid",
  {
    rowNum: z.number().int().min(2),
    partIndex: z.number().int().min(0).nullable().optional(),
    paid: z.boolean(),
  },
  async ({ rowNum, partIndex, paid }) => {
    await markFixedPaid(rowNum, partIndex ?? null, paid);
    return {
      content: [
        {
          type: "text",
          text: safeJson({
            ok: true,
            message: `Gasto fijo fila ${rowNum} ${paid ? "marcado como pagado" : "desmarcado"} (parte ${partIndex ?? "todas"})`,
          }),
        },
      ],
    };
  },
);

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
