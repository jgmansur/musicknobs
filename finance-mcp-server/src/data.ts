import { config } from "./config.js";
import { findSpreadsheetByName, sheetsGet } from "./google.js";
import { inDateRange, normalizeText, parseNumber } from "./utils.js";

const DOCS_SHEET = "DocumentosArchivador";
const DOCS_PROFILE_SHEET = "DocumentosPerfiles";
const PROMPTS_SHEET = "PromptVault";
const ACCOUNTS_SHEET_FALLBACK_NAME = "Finance Dashboard - Cuentas";

let discoveredAccountsSheetId: string | null = null;

type ExpenseRow = {
  fecha: string;
  lugar: string;
  concepto: string;
  monto: number;
  tipo: "Gasto" | "Ingreso";
  formaPago: string;
  fotos: string;
  moneda: string;
};

type ProfileRow = {
  member: string;
  name: string;
  birthDate: string;
  birthWeight: string;
  curp: string;
  passportMx: string;
  passportUs: string;
  visaUs: string;
  photoUrl: string;
  vaccinesJson: string;
  notes: string;
  updatedAt: string;
};

type DocumentoRow = {
  member: string;
  title: string;
  type: string;
  tags: string;
  notes: string;
  expiryDate: string;
  url: string;
};

type AccountRow = {
  id: string;
  name: string;
  balance: number;
  type: string;
  hidden: boolean;
  currency: string;
  investmentType: string;
};

type PromptRow = {
  id: string;
  title: string;
  content: string;
  platform: string;
  size: "small" | "long";
  tags: string;
  status: string;
  favorite: boolean;
  useCount: number;
  lastUsedAt: string;
  createdAt: string;
  updatedAt: string;
};

type FixedStatusRow = {
  rowNum: number;
  concepto: string;
  tipo: "gasto" | "ingreso";
  monto: number;
  pagosMes: number;
  pagosHechos: number;
  pagosPendientes: number;
  montoPendiente: number;
  dueThisMonth: boolean;
  periodicidad: "mensual" | "bimestral";
  startMonth: string;
};

function toHeaderMap(headers: string[]) {
  const map = new Map<string, number>();
  headers.forEach((h, i) => map.set((h || "").trim(), i));
  return map;
}

function getCell(row: string[], map: Map<string, number>, key: string): string {
  const idx = map.get(key);
  if (idx === undefined) return "";
  return (row[idx] || "").toString();
}

function parsePaymentsTotal(value: unknown): number {
  const n = Math.trunc(parseNumber(value));
  return Number.isFinite(n) && n > 0 ? n : 1;
}

function parseBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  const raw = String(value ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "si";
}

function parsePaymentStates(raw: unknown, total: number, legacyPaid = false): boolean[] {
  const count = parsePaymentsTotal(total);
  if (!raw && legacyPaid) return new Array(count).fill(true);
  const chars = String(raw || "")
    .replace(/[^01]/g, "")
    .slice(0, count)
    .split("");
  const states = new Array(count).fill(false);
  for (let i = 0; i < chars.length; i++) states[i] = chars[i] === "1";
  return states;
}

function parseFixedPeriodicity(value: unknown): "mensual" | "bimestral" {
  return String(value || "").trim().toLowerCase() === "bimestral" ? "bimestral" : "mensual";
}

function parseStartMonth(value: unknown, fallbackYm: string): string {
  const raw = String(value || "").trim();
  return /^\d{4}-\d{2}$/.test(raw) ? raw : fallbackYm;
}

function monthDiff(fromYm: string, toYm: string): number {
  const [fy, fm] = fromYm.split("-").map(Number);
  const [ty, tm] = toYm.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm);
}

function isFixedDueThisMonth(periodicity: "mensual" | "bimestral", startMonth: string, nowMonth: string): boolean {
  if (periodicity !== "bimestral") return true;
  const diff = monthDiff(startMonth, nowMonth);
  if (diff < 0) return false;
  return diff % 2 === 0;
}

export async function getExpenses(from?: string, to?: string): Promise<ExpenseRow[]> {
  const rows = await sheetsGet(config.spreadsheets.log, "Hoja 1!A2:H");
  return rows
    .map((row) => {
      const tipoRaw = (row[4] || "").toLowerCase();
      return {
        fecha: row[0] || "",
        lugar: row[1] || "",
        concepto: row[2] || "",
        monto: parseNumber(row[3]),
        tipo: tipoRaw === "ingreso" ? "Ingreso" : "Gasto",
        formaPago: row[5] || "",
        fotos: row[6] || "",
        moneda: row[7] || "MXN",
      } as ExpenseRow;
    })
    .filter((row) => (from || to ? inDateRange(row.fecha, from, to) : true));
}

export async function getProfileRows(): Promise<ProfileRow[]> {
  const [head, rows] = await Promise.all([
    sheetsGet(config.spreadsheets.autos, `${DOCS_PROFILE_SHEET}!A1:AZ1`),
    sheetsGet(config.spreadsheets.autos, `${DOCS_PROFILE_SHEET}!A2:AZ`),
  ]);
  const headers = (head[0] || []).map((h) => h.trim());
  const map = toHeaderMap(headers);
  return rows.map((row) => ({
    member: getCell(row, map, "member"),
    name: getCell(row, map, "name"),
    birthDate: getCell(row, map, "birthDate"),
    birthWeight: getCell(row, map, "birthWeight"),
    curp: getCell(row, map, "curp"),
    passportMx: getCell(row, map, "passportMx"),
    passportUs: getCell(row, map, "passportUs"),
    visaUs: getCell(row, map, "visaUs"),
    photoUrl: getCell(row, map, "photoUrl"),
    vaccinesJson: getCell(row, map, "vaccinesJson"),
    notes: getCell(row, map, "notes"),
    updatedAt: getCell(row, map, "updatedAt"),
  }));
}

export async function getDocumentoRows(): Promise<DocumentoRow[]> {
  const [head, rows] = await Promise.all([
    sheetsGet(config.spreadsheets.autos, `${DOCS_SHEET}!A1:AZ1`),
    sheetsGet(config.spreadsheets.autos, `${DOCS_SHEET}!A2:AZ`),
  ]);
  const headers = (head[0] || []).map((h) => h.trim());
  const map = toHeaderMap(headers);
  return rows.map((row) => ({
    member: getCell(row, map, "member"),
    title: getCell(row, map, "title"),
    type: getCell(row, map, "type"),
    tags: getCell(row, map, "tags"),
    notes: getCell(row, map, "notes"),
    expiryDate: getCell(row, map, "expiryDate"),
    url: getCell(row, map, "url") || getCell(row, map, "driveUrl"),
  }));
}

export async function getPromptRows(): Promise<PromptRow[]> {
  const [head, rows] = await Promise.all([
    sheetsGet(config.spreadsheets.autos, `${PROMPTS_SHEET}!A1:AZ1`).catch(() => []),
    sheetsGet(config.spreadsheets.autos, `${PROMPTS_SHEET}!A2:AZ`).catch(() => []),
  ]);
  const headers = (head[0] || []).map((h) => h.trim());
  if (!headers.length) return [];
  const map = toHeaderMap(headers);
  return rows
    .map((row) => {
      const size: PromptRow["size"] = getCell(row, map, "size") === "long" ? "long" : "small";
      return {
      id: getCell(row, map, "id"),
      title: getCell(row, map, "title"),
      content: getCell(row, map, "content"),
      platform: getCell(row, map, "platform"),
      size,
      tags: getCell(row, map, "tags"),
      status: getCell(row, map, "status"),
      favorite: ["true", "1"].includes(getCell(row, map, "favorite").toLowerCase()),
      useCount: parseNumber(getCell(row, map, "useCount")),
      lastUsedAt: getCell(row, map, "lastUsedAt"),
      createdAt: getCell(row, map, "createdAt"),
      updatedAt: getCell(row, map, "updatedAt"),
      };
    })
    .filter((p) => p.id && p.title);
}

export async function searchPrompts(query: string, platform?: string) {
  const q = normalizeText(query || "");
  const p = normalizeText(platform || "");
  const prompts = await getPromptRows();
  const rows = prompts.filter((item) => {
    if (p && normalizeText(item.platform) !== p) return false;
    if (!q) return true;
    const hay = normalizeText(`${item.title} ${item.content} ${item.tags} ${item.platform} ${item.status}`);
    return hay.includes(q);
  });
  rows.sort((a, b) => Number(b.favorite) - Number(a.favorite) || parseNumber(b.useCount) - parseNumber(a.useCount));
  return {
    query,
    platform: platform || null,
    count: rows.length,
    rows: rows.slice(0, 200),
  };
}

export async function getAccounts(): Promise<AccountRow[]> {
  let id = config.spreadsheets.accounts;
  if (!id) {
    if (discoveredAccountsSheetId === null) {
      discoveredAccountsSheetId = await findSpreadsheetByName(ACCOUNTS_SHEET_FALLBACK_NAME);
    }
    id = discoveredAccountsSheetId || "";
  }
  if (!id) return [];
  const rows = await sheetsGet(id, "A2:K");
  return rows.map((row) => ({
    id: row[0] || "",
    name: row[1] || "",
    balance: parseNumber(row[2]),
    type: row[3] || "bank",
    hidden: (row[4] || "").toUpperCase() === "TRUE",
    currency: row[7] || "MXN",
    investmentType: row[8] || "custom",
  }));
}

export async function findProfileField(member: string | undefined, field: keyof ProfileRow) {
  const rows = await getProfileRows();
  const memberKey = normalizeText(member || "");
  const row = memberKey
    ? rows.find((r) => normalizeText(r.member) === memberKey || normalizeText(r.name).includes(memberKey))
    : rows[0];
  if (!row) return null;
  return {
    member: row.member,
    name: row.name,
    field,
    value: row[field] || "",
    updatedAt: row.updatedAt,
  };
}

export async function getFinanceSummary(from?: string, to?: string) {
  const [expenses, accounts, fixedStatus] = await Promise.all([getExpenses(from, to), getAccounts(), getFixedStatus()]);
  const ingresos = expenses.filter((e) => e.tipo === "Ingreso").reduce((s, e) => s + e.monto, 0);
  const gastos = expenses.filter((e) => e.tipo === "Gasto").reduce((s, e) => s + e.monto, 0);
  const porCuenta = expenses.reduce<Record<string, { ingresos: number; gastos: number; neto: number }>>((acc, row) => {
    const key = row.formaPago || "Sin formaPago";
    const cur = acc[key] || { ingresos: 0, gastos: 0, neto: 0 };
    if (row.tipo === "Ingreso") {
      cur.ingresos += row.monto;
      cur.neto += row.monto;
    } else {
      cur.gastos += row.monto;
      cur.neto -= row.monto;
    }
    acc[key] = cur;
    return acc;
  }, {});

  return {
    from: from || null,
    to: to || null,
    movimientos: expenses.length,
    ingresos,
    gastos,
    neto: ingresos - gastos,
    cuentas: accounts,
    fixedPendingTotal: fixedStatus.pendingTotal,
    fixedPendingByConcept: fixedStatus.rows,
    porCuenta,
  };
}

export async function getFixedStatus(referenceYm?: string): Promise<{ month: string; pendingTotal: number; rows: FixedStatusRow[] }> {
  const rawRows = await sheetsGet(config.spreadsheets.fixed, "Hoja 1!A2:N");
  const now = new Date();
  const currentYm = referenceYm || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const rows = rawRows.map((row, idx) => {
    const gRaw = parseNumber(row[2]);
    const nRaw = parseNumber(row[3]);
    const monto = Math.abs(gRaw || nRaw);
    const tipo: "gasto" | "ingreso" = gRaw > 0 ? "gasto" : "ingreso";
    const pagosMes = parsePaymentsTotal(row[6]);
    const paidLegacy = parseBool(row[5]);
    const pagosEstado = parsePaymentStates(row[7], pagosMes, paidLegacy);
    const pagosHechos = pagosEstado.filter(Boolean).length;
    const pagosPendientes = Math.max(0, pagosMes - pagosHechos);
    const periodicidad = parseFixedPeriodicity(row[8]);
    const startMonth = parseStartMonth(row[9], currentYm);
    const dueThisMonth = isFixedDueThisMonth(periodicidad, startMonth, currentYm);
    const partAmount = monto / pagosMes;
    const montoPendiente = dueThisMonth ? partAmount * pagosPendientes : 0;

    return {
      rowNum: idx + 2,
      concepto: String(row[1] || "").trim(),
      tipo,
      monto,
      pagosMes,
      pagosHechos,
      pagosPendientes,
      montoPendiente,
      dueThisMonth,
      periodicidad,
      startMonth,
    } as FixedStatusRow;
  });

  const gastoRows = rows
    .filter((r) => r.tipo === "gasto" && r.dueThisMonth)
    .sort((a, b) => b.montoPendiente - a.montoPendiente);
  const pendingTotal = gastoRows.reduce((sum, r) => sum + r.montoPendiente, 0);

  return {
    month: currentYm,
    pendingTotal,
    rows: gastoRows,
  };
}

export async function getExpensesByAccount(account: string, from?: string, to?: string) {
  const key = normalizeText(account);
  const rows = (await getExpenses(from, to)).filter((r) => normalizeText(r.formaPago).includes(key));
  const totalGastos = rows.filter((r) => r.tipo === "Gasto").reduce((s, r) => s + r.monto, 0);
  const totalIngresos = rows.filter((r) => r.tipo === "Ingreso").reduce((s, r) => s + r.monto, 0);
  return {
    account,
    from: from || null,
    to: to || null,
    count: rows.length,
    totalGastos,
    totalIngresos,
    neto: totalIngresos - totalGastos,
    rows: rows.slice(0, 200),
  };
}

export async function getInvestmentsSnapshot() {
  const accounts = await getAccounts();
  const investments = accounts.filter((a) => a.type === "invest");
  const total = investments.reduce((s, i) => s + Math.abs(i.balance), 0);
  return {
    total,
    count: investments.length,
    rows: investments,
  };
}

export async function searchDocuments(query: string, member?: string) {
  const q = normalizeText(query);
  const m = normalizeText(member || "");
  const docs = await getDocumentoRows();
  const rows = docs.filter((d) => {
    if (m && normalizeText(d.member) !== m) return false;
    const hay = normalizeText(`${d.title} ${d.type} ${d.tags} ${d.notes}`);
    return hay.includes(q);
  });
  return {
    query,
    member: member || null,
    count: rows.length,
    rows: rows.slice(0, 200),
  };
}
