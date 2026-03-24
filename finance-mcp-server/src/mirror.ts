import { config } from "./config.js";
import { getFixedStatus } from "./data.js";
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
  ].filter((b) => !!b.spreadsheetId);

  const accountsId = await resolveAccountsSheetId();
  if (accountsId) {
    books.push({ key: "accounts", spreadsheetId: accountsId, title: "Finance Dashboard - Cuentas" });
  }
  return books;
}

export async function syncAiMirror() {
  const mirror = await resolveMirrorSheet();
  const books = await getSourceBooks();
  const mirrorMeta = await sheetsGetSpreadsheet(mirror.id);
  const existingTabs = new Set((mirrorMeta.sheets || []).map((s) => s.properties?.title || "").filter(Boolean));

  const copied: Array<{ sourceBook: string; sourceTab: string; mirrorTab: string; rows: number; cols: number }> = [];
  const addRequests: Array<{ addSheet: { properties: { title: string } } }> = [];

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

  const now = new Date().toISOString();
  const metadataRows = [
    ["lastSyncedAt", now],
    ["mirrorSpreadsheetId", mirror.id],
    ["sourceBooks", String(books.length)],
    ["tabsCopied", String(copied.length)],
  ];
  await sheetsClear(mirror.id, `${metadataTab}!A1:B200`);
  await sheetsUpdate(mirror.id, `${metadataTab}!A1`, metadataRows);

  const fixedStatusTab = "ai__fixed_status";
  if (!existingTabs.has(fixedStatusTab)) {
    await sheetsBatchUpdate(mirror.id, [{ addSheet: { properties: { title: fixedStatusTab } } }]);
  }
  const fixedStatus = await getFixedStatus();
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
  };
}
