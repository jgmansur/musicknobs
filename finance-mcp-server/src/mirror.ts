import { config } from "./config.js";
import { getFixedStatus } from "./data.js";
import { createHash } from "node:crypto";
import {
  createSpreadsheet,
  findSpreadsheetByName,
  shareFileWithEmail,
  sheetsBatchUpdate,
  sheetsClear,
  sheetsGet,
  sheetsGetSpreadsheet,
  sheetsUpdate,
} from "./google.js";

const ACCOUNTS_SHEET_FALLBACK_NAME = "Finance Dashboard - Cuentas";
const MAX_TAB_NAME = 100;

type SourceBook = {
  key: string;
  spreadsheetId: string;
  title: string;
};

type EngramBridgeResult = {
  enabled: boolean;
  attempted: boolean;
  pushed: boolean;
  skippedReason?: string;
  statusCode?: number;
  error?: string;
};

function safeTabName(raw: string): string {
  return raw
    .replace(/[\\/?*\[\]:]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_TAB_NAME);
}

function buildTabName(bookKey: string, sourceTab: string): string {
  return safeTabName(`${bookKey}__${sourceTab}`);
}

async function resolveAccountsSheetId(): Promise<string> {
  if (config.spreadsheets.accounts) return config.spreadsheets.accounts;
  return (await findSpreadsheetByName(ACCOUNTS_SHEET_FALLBACK_NAME)) || "";
}

async function resolveMirrorSheet(): Promise<{ id: string; url: string; created: boolean }> {
  if (config.spreadsheets.aiMirror) {
    return { id: config.spreadsheets.aiMirror, url: `https://docs.google.com/spreadsheets/d/${config.spreadsheets.aiMirror}/edit`, created: false };
  }
  const found = await findSpreadsheetByName(config.aiMirrorName);
  if (found) {
    return { id: found, url: `https://docs.google.com/spreadsheets/d/${found}/edit`, created: false };
  }
  const created = await createSpreadsheet(config.aiMirrorName);
  if (config.aiMirrorShareEmail) {
    await shareFileWithEmail(created.id, config.aiMirrorShareEmail, "writer");
  }
  return { id: created.id, url: created.url, created: true };
}

async function getSourceBooks(): Promise<SourceBook[]> {
  const books: SourceBook[] = [
    { key: "log", spreadsheetId: config.spreadsheets.log, title: "Control de Gastos" },
    { key: "fixed", spreadsheetId: config.spreadsheets.fixed, title: "Gastos Fijos" },
    { key: "autos", spreadsheetId: config.spreadsheets.autos, title: "Autos+Docs+Pelo+Studio" },
    { key: "recuerdos", spreadsheetId: config.spreadsheets.recuerdos, title: "Bitacora Recuerdos" },
    { key: "rsm", spreadsheetId: config.spreadsheets.rsm, title: "Recibos Salud Mariel" },
  ].filter((b) => !!b.spreadsheetId);

  const accountsId = await resolveAccountsSheetId();
  if (accountsId) {
    books.push({ key: "accounts", spreadsheetId: accountsId, title: "Finance Dashboard - Cuentas" });
  }
  return books;
}

function metadataToMap(rows: string[][]): Map<string, string> {
  const map = new Map<string, string>();
  for (const row of rows) {
    const key = String(row[0] || "").trim();
    if (!key) continue;
    map.set(key, String(row[1] || "").trim());
  }
  return map;
}

async function pushEngramBridgeEvent(params: {
  signature: string;
  previousSignature: string;
  syncedAt: string;
  mirror: { id: string; url: string };
  books: SourceBook[];
  copied: Array<{ sourceBook: string; sourceTab: string; mirrorTab: string; rows: number; cols: number }>;
  fixedStatus: { month: string; pendingTotal: number; rows: Array<{ montoPendiente: number }> };
}): Promise<EngramBridgeResult> {
  const webhookUrl = (config.engram.webhookUrl || "").trim();
  const webhookToken = (config.engram.webhookToken || "").trim();

  if (!webhookUrl) {
    return {
      enabled: false,
      attempted: false,
      pushed: false,
      skippedReason: "ENGRAM_WEBHOOK_URL not configured",
    };
  }

  if (params.signature === params.previousSignature) {
    return {
      enabled: true,
      attempted: false,
      pushed: false,
      skippedReason: "No mirror changes detected",
    };
  }

  const totalCells = params.copied.reduce((sum, item) => sum + item.rows * Math.max(1, item.cols), 0);
  const pendingTop3 = params.fixedStatus.rows
    .slice(0, 3)
    .reduce((sum, row) => sum + Number(row.montoPendiente || 0), 0);

  const payload = {
    source: "finance-mcp-server",
    event: "finance_ai_mirror_changed",
    syncedAt: params.syncedAt,
    signature: params.signature,
    previousSignature: params.previousSignature,
    mirror: {
      spreadsheetId: params.mirror.id,
      url: params.mirror.url,
    },
    summary: {
      sourceBooks: params.books.length,
      mirroredTabs: params.copied.length,
      mirroredCellsApprox: totalCells,
    },
    financeSignals: {
      month: params.fixedStatus.month,
      fixedPendingTotal: params.fixedStatus.pendingTotal,
      pendingRows: params.fixedStatus.rows.length,
      top3PendingSum: pendingTop3,
    },
  };

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (webhookToken) {
    headers.Authorization = `Bearer ${webhookToken}`;
  }

  try {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        enabled: true,
        attempted: true,
        pushed: false,
        statusCode: response.status,
        error: body || `Webhook failed with status ${response.status}`,
      };
    }

    return {
      enabled: true,
      attempted: true,
      pushed: true,
      statusCode: response.status,
    };
  } catch (error) {
    return {
      enabled: true,
      attempted: true,
      pushed: false,
      error: String((error as Error)?.message || error),
    };
  }
}

export async function syncAiMirror() {
  const mirror = await resolveMirrorSheet();
  const books = await getSourceBooks();
  const mirrorMeta = await sheetsGetSpreadsheet(mirror.id);
  const existingTabs = new Set((mirrorMeta.sheets || []).map((s) => s.properties?.title || "").filter(Boolean));

  const copied: Array<{ sourceBook: string; sourceTab: string; mirrorTab: string; rows: number; cols: number }> = [];
  const addRequests: Array<{ addSheet: { properties: { title: string } } }> = [];

  const contentHash = createHash("sha256");

  for (const book of books) {
    const sourceMeta = await sheetsGetSpreadsheet(book.spreadsheetId);
    const sourceTabs = (sourceMeta.sheets || []).map((s) => s.properties?.title || "").filter(Boolean);
    for (const sourceTab of sourceTabs) {
      const mirrorTab = buildTabName(book.key, sourceTab);
      if (!existingTabs.has(mirrorTab)) {
        existingTabs.add(mirrorTab);
        addRequests.push({ addSheet: { properties: { title: mirrorTab } } });
      }
    }
  }

  if (addRequests.length) {
    await sheetsBatchUpdate(mirror.id, addRequests);
  }

  for (const book of books) {
    const sourceMeta = await sheetsGetSpreadsheet(book.spreadsheetId);
    const sourceTabs = (sourceMeta.sheets || []).map((s) => s.properties?.title || "").filter(Boolean);

    for (const sourceTab of sourceTabs) {
      const mirrorTab = buildTabName(book.key, sourceTab);
      const data = await sheetsGet(book.spreadsheetId, `${sourceTab}!A1:ZZ`);

      contentHash.update(book.key);
      contentHash.update("\u001f");
      contentHash.update(sourceTab);
      contentHash.update("\u001f");
      for (const row of data) {
        contentHash.update(row.join("\u241f"));
        contentHash.update("\n");
      }

      await sheetsClear(mirror.id, `${mirrorTab}!A1:ZZ`);
      if (data.length) {
        await sheetsUpdate(mirror.id, `${mirrorTab}!A1`, data);
      }
      copied.push({
        sourceBook: book.key,
        sourceTab,
        mirrorTab,
        rows: data.length,
        cols: data[0]?.length || 0,
      });
    }
  }

  const metadataTab = "sync_metadata";
  if (!existingTabs.has(metadataTab)) {
    await sheetsBatchUpdate(mirror.id, [{ addSheet: { properties: { title: metadataTab } } }]);
  }

  const previousMetadataRows = await sheetsGet(mirror.id, `${metadataTab}!A1:B200`).catch(() => [] as string[][]);
  const previousMetadata = metadataToMap(previousMetadataRows);
  const previousSignature = previousMetadata.get("engramLastSignature") || "";

  const now = new Date().toISOString();
  const currentSignature = contentHash.digest("hex");
  const fixedStatus = await getFixedStatus();

  const engramBridge = await pushEngramBridgeEvent({
    signature: currentSignature,
    previousSignature,
    syncedAt: now,
    mirror: { id: mirror.id, url: mirror.url },
    books,
    copied,
    fixedStatus,
  });

  const metadataRows = [
    ["lastSyncedAt", now],
    ["mirrorSpreadsheetId", mirror.id],
    ["sourceBooks", String(books.length)],
    ["tabsCopied", String(copied.length)],
    ["engramLastSignature", currentSignature],
    ["engramBridgeEnabled", engramBridge.enabled ? "TRUE" : "FALSE"],
    ["engramBridgeAttempted", engramBridge.attempted ? "TRUE" : "FALSE"],
    ["engramBridgePushed", engramBridge.pushed ? "TRUE" : "FALSE"],
    ["engramBridgeStatusCode", engramBridge.statusCode ? String(engramBridge.statusCode) : ""],
    ["engramBridgeSkippedReason", engramBridge.skippedReason || ""],
    ["engramBridgeError", engramBridge.error || ""],
  ];
  await sheetsClear(mirror.id, `${metadataTab}!A1:B200`);
  await sheetsUpdate(mirror.id, `${metadataTab}!A1`, metadataRows);

  const fixedStatusTab = "ai__fixed_status";
  if (!existingTabs.has(fixedStatusTab)) {
    await sheetsBatchUpdate(mirror.id, [{ addSheet: { properties: { title: fixedStatusTab } } }]);
  }
  const fixedRows: string[][] = [
    [
      "month",
      "rowNum",
      "concepto",
      "tipo",
      "monto",
      "pagosMes",
      "pagosHechos",
      "pagosPendientes",
      "montoPendiente",
      "dueThisMonth",
      "periodicidad",
      "startMonth",
    ],
    ...fixedStatus.rows.map((r) => [
      fixedStatus.month,
      String(r.rowNum),
      r.concepto,
      r.tipo,
      String(r.monto),
      String(r.pagosMes),
      String(r.pagosHechos),
      String(r.pagosPendientes),
      String(r.montoPendiente),
      r.dueThisMonth ? "TRUE" : "FALSE",
      r.periodicidad,
      r.startMonth,
    ]),
  ];
  await sheetsClear(mirror.id, `${fixedStatusTab}!A1:Z3000`);
  await sheetsUpdate(mirror.id, `${fixedStatusTab}!A1`, fixedRows);

  return {
    ok: true,
    mirrorSpreadsheetId: mirror.id,
    mirrorUrl: mirror.url,
    created: mirror.created,
    sources: books,
    copied,
    syncedAt: now,
    signature: currentSignature,
    engramBridge,
  };
}
