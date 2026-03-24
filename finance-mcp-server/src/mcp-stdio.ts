import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { assertConfig } from "./config.js";
import {
  findProfileField,
  getExpensesByAccount,
  getFixedStatus,
  getFinanceSummary,
  getInvestmentsSnapshot,
  searchDocuments,
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

server.tool("sync_ai_mirror", {}, async () => {
  const result = await syncAiMirror();
  return { content: [{ type: "text", text: safeJson(result) }] };
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
