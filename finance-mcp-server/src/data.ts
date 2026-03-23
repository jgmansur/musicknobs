import { config } from "./config.js";
import { findSpreadsheetByName, sheetsGet } from "./google.js";
import { inDateRange, normalizeText, parseNumber } from "./utils.js";

const DOCS_SHEET = "DocumentosArchivador";
const DOCS_PROFILE_SHEET = "DocumentosPerfiles";
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
  const [expenses, accounts] = await Promise.all([getExpenses(from, to), getAccounts()]);
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
    porCuenta,
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
