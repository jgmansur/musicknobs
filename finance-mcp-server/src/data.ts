import { config } from "./config.js";
import { findSpreadsheetByName, sheetsBatchUpdate, sheetsClear, sheetsGet, sheetsGetSpreadsheet, sheetsUpdate } from "./google.js";
import { inDateRange, normalizeText, parseNumber } from "./utils.js";

const DOCS_SHEET = "DocumentosArchivador";
const DOCS_PROFILE_SHEET = "DocumentosPerfiles";
const PROMPTS_SHEET = "PromptVault";
const ACCOUNTS_SHEET_FALLBACK_NAME = "Finance Dashboard - Cuentas";
const WIDGET_CACHE_SHEET = "WidgyCache";

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
  creditLimit: number;
  creditLimitVisible: boolean;
  currency: string;
  investmentType: string;
};

type FxSnapshot = {
  usdMxn: number;
  btcMxn: number;
  source: string;
  stale: boolean;
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

async function resolveAccountsSheetId(): Promise<string> {
  let id = config.spreadsheets.accounts;
  if (!id) {
    if (discoveredAccountsSheetId === null) {
      discoveredAccountsSheetId = await findSpreadsheetByName(ACCOUNTS_SHEET_FALLBACK_NAME);
    }
    id = discoveredAccountsSheetId || "";
  }
  return id;
}

export async function getAccounts(): Promise<AccountRow[]> {
  const id = await resolveAccountsSheetId();
  if (!id) return [];
  const rows = await sheetsGet(id, "A2:K");
  return rows.map((row) => ({
    id: row[0] || "",
    name: row[1] || "",
    balance: parseNumber(row[2]),
    type: row[3] || "bank",
    hidden: (row[4] || "").toUpperCase() === "TRUE",
    creditLimit: Math.abs(parseNumber(row[5])),
    creditLimitVisible: (row[6] || "").toUpperCase() === "TRUE",
    currency: row[7] || "MXN",
    investmentType: row[8] || "custom",
  }));
}

async function fetchUsdMxnRate(): Promise<number | null> {
  try {
    const r = await fetch("https://open.er-api.com/v6/latest/USD");
    if (!r.ok) return null;
    const data = (await r.json()) as { rates?: Record<string, number> };
    const rate = parseNumber(data?.rates?.MXN);
    return rate > 0 ? rate : null;
  } catch {
    return null;
  }
}

async function fetchBtcMxnRate(): Promise<number | null> {
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=mxn");
    if (!r.ok) return null;
    const data = (await r.json()) as { bitcoin?: { mxn?: number } };
    const rate = parseNumber(data?.bitcoin?.mxn);
    return rate > 0 ? rate : null;
  } catch {
    return null;
  }
}

async function getFxSnapshot(): Promise<FxSnapshot> {
  const [usdMxnRemote, btcMxnRemote] = await Promise.all([fetchUsdMxnRate(), fetchBtcMxnRate()]);
  const usdMxn = usdMxnRemote || 17;
  const btcMxn = btcMxnRemote || 1_500_000;
  return {
    usdMxn,
    btcMxn,
    source: "open.er-api+coingecko",
    stale: !usdMxnRemote || !btcMxnRemote,
  };
}

function convertToMxn(balance: number, currency: string, fx: FxSnapshot): number {
  const curr = (currency || "MXN").toString().trim().toUpperCase();
  if (curr === "USD") return balance * fx.usdMxn;
  if (curr === "BTC") return balance * fx.btcMxn;
  return balance;
}

function normalizePaymentKey(value: unknown): string {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function getAccountMatchKeys(acc: AccountRow): string[] {
  const keys = new Set<string>();
  const add = (v: unknown) => {
    const k = normalizePaymentKey(v);
    if (k) keys.add(k);
  };
  add(acc.name);
  if (acc.type === "cash") add("efectivo");
  if (acc.type === "invest") {
    add("inversion");
    add("inversiones");
    add("inversión");
    if ((acc.investmentType || "").toLowerCase() === "cetes") add("cetes");
    if ((acc.investmentType || "").toLowerCase() === "mifel") add("mifel");
    if ((acc.investmentType || "").toLowerCase() === "bitcoin") {
      add("bitcoin");
      add("btc");
    }
  }
  return [...keys];
}

function getAccountIdByPayment(accounts: AccountRow[], formaPago: unknown): string | null {
  const key = normalizePaymentKey(formaPago);
  if (!key) return null;
  let partial: string | null = null;
  for (const acc of accounts) {
    const keys = getAccountMatchKeys(acc);
    if (keys.includes(key)) return acc.id;
    if (!partial && keys.some((k) => k.length >= 4 && (key.includes(k) || k.includes(key)))) {
      partial = acc.id;
    }
  }
  return partial;
}

async function ensureWidgetCacheSheet(spreadsheetId: string): Promise<void> {
  const meta = await sheetsGetSpreadsheet(spreadsheetId);
  const exists = (meta.sheets || []).some((s) => (s.properties?.title || "") === WIDGET_CACHE_SHEET);
  if (!exists) {
    await sheetsBatchUpdate(spreadsheetId, [{ addSheet: { properties: { title: WIDGET_CACHE_SHEET } } }]);
  }
  const header = await sheetsGet(spreadsheetId, `${WIDGET_CACHE_SHEET}!A1:C1`).catch(() => []);
  const current = (header[0] || []).map((x) => String(x || "").trim().toLowerCase());
  if ((current[0] || "") !== "key" || (current[1] || "") !== "value" || (current[2] || "") !== "updatedat") {
    await sheetsUpdate(spreadsheetId, `${WIDGET_CACHE_SHEET}!A1:C1`, [["key", "value", "updatedAt"]]);
  }
}

async function loadWidgetCache(spreadsheetId: string): Promise<Record<string, string>> {
  await ensureWidgetCacheSheet(spreadsheetId);
  const rows = await sheetsGet(spreadsheetId, `${WIDGET_CACHE_SHEET}!A2:C`).catch(() => []);
  const out: Record<string, string> = {};
  for (const row of rows) {
    const key = String(row[0] || "").trim();
    if (!key) continue;
    out[key] = String(row[1] || "");
  }
  return out;
}

async function saveWidgetCache(spreadsheetId: string, cache: Record<string, string>): Promise<void> {
  const now = new Date().toISOString();
  const keys = Object.keys(cache).sort();
  const values = [["key", "value", "updatedAt"], ...keys.map((k) => [k, cache[k], now])];
  await sheetsClear(spreadsheetId, `${WIDGET_CACHE_SHEET}!A1:C`);
  await sheetsUpdate(spreadsheetId, `${WIDGET_CACHE_SHEET}!A1:C${values.length}`, values);
}

async function getDebtImpactMxn(): Promise<number> {
  if (!config.spreadsheets.autos) return 0;
  const rows = await sheetsGet(config.spreadsheets.autos, "Hoja 1!A2:D").catch(() => []);
  return rows.reduce((sum, row) => {
    const hidden = String(row[2] || "").toUpperCase() === "TRUE";
    if (hidden) return sum;
    return sum + Math.max(0, parseNumber(row[1]));
  }, 0);
}

async function getLogTotalsByAccountMxn(accounts: AccountRow[], fx: FxSnapshot): Promise<Record<string, number>> {
  const rows = await getExpenses();
  const totals: Record<string, number> = {};
  for (const row of rows) {
    const accountId = getAccountIdByPayment(accounts, row.formaPago);
    if (!accountId) continue;
    const amountMxn = convertToMxn(Math.abs(parseNumber(row.monto)), row.moneda, fx);
    const signed = row.tipo === "Ingreso" ? amountMxn : row.tipo === "Gasto" ? -amountMxn : 0;
    totals[accountId] = Number(totals[accountId] || 0) + signed;
  }
  return totals;
}

export async function getWidgetAccountsSnapshot(limit = 8, includeHidden = false) {
  const [accounts, fx] = await Promise.all([getAccounts(), getFxSnapshot()]);
  const visible = accounts.filter((a) => includeHidden || !a.hidden);
  const mapped = visible.map((a) => {
    const balanceOriginal = parseNumber(a.balance);
    const balanceMxn = convertToMxn(balanceOriginal, a.currency, fx);
    return {
      name: a.name,
      type: a.type,
      balanceMxn: Math.round(balanceMxn),
    };
  });

  const sorted = mapped.sort((a, b) => Math.abs(b.balanceMxn) - Math.abs(a.balanceMxn));
  const sliced = sorted.slice(0, Math.max(1, Math.min(20, Math.trunc(limit) || 8)));
  const assetsMxn = mapped.filter((a) => a.balanceMxn > 0).reduce((s, a) => s + a.balanceMxn, 0);
  const liabilitiesMxn = Math.abs(mapped.filter((a) => a.balanceMxn < 0).reduce((s, a) => s + a.balanceMxn, 0));
  const netMxn = mapped.reduce((s, a) => s + a.balanceMxn, 0);

  return {
    ok: true,
    updatedAt: new Date().toISOString(),
    totals: {
      netMxn: Math.round(netMxn),
      assetsMxn: Math.round(assetsMxn),
      liabilitiesMxn: Math.round(liabilitiesMxn),
      countVisible: mapped.length,
    },
    accounts: sliced,
    meta: {
      fxSource: fx.source,
      fxStale: fx.stale,
    },
  };
}

type DashboardWidgetSnapshot = {
  ok: true;
  updatedAt: string;
  totals: {
    balanceDisponibleMxn: number;
    balanceDisponibleWithDebtMxn: number;
    balanceRealMxn: number;
    balanceRealWithDebtMxn: number;
    pendingFixedMxn: number;
    debtImpactMxn: number;
  };
  highlights: {
    focusAccountRealMxn: number;
    focusAccountFound: boolean;
    focusAccount: string;
  };
  accounts: Array<{
    name: string;
    type: string;
    realMxn: number;
  }>;
  meta: {
    cacheSheet: string;
    fxSource: string;
    fxStale: boolean;
    cacheWritable: boolean;
  };
};

async function resolveWidgetCacheSpreadsheetId(): Promise<string> {
  if (config.spreadsheets.rsm) return config.spreadsheets.rsm;
  if (config.spreadsheets.autos) return config.spreadsheets.autos;
  return resolveAccountsSheetId();
}

export async function getWidgetDashboardSnapshot(limit = 6, includeHidden = false, focusAccount = "Santander"): Promise<DashboardWidgetSnapshot> {
  const [accounts, fx, fixedStatus, debtImpact] = await Promise.all([
    getAccounts(),
    getFxSnapshot(),
    getFixedStatus(),
    getDebtImpactMxn(),
  ]);

  const cacheSpreadsheetId = await resolveWidgetCacheSpreadsheetId();
  let cacheWritable = true;
  const cache: Record<string, string> = {};
  if (cacheSpreadsheetId) {
    try {
      Object.assign(cache, await loadWidgetCache(cacheSpreadsheetId));
    } catch {
      cacheWritable = false;
    }
  } else {
    cacheWritable = false;
  }
  const logTotalsByAccount = await getLogTotalsByAccountMxn(accounts, fx);
  let cacheChanged = false;

  const visible = accounts.filter((a) => includeHidden || !a.hidden);
  const rows = visible.map((acc) => {
    const idKey = String(acc.id || "");
    const cacheKey = `anchor:${idKey}`;
    const currentLog = Number(logTotalsByAccount[idKey] || 0);
    if (!(cacheKey in cache)) {
      cache[cacheKey] = String(currentLog);
      cacheChanged = true;
    }
    const anchor = parseNumber(cache[cacheKey]);
    const adjustment = currentLog - (Number.isFinite(anchor) ? anchor : currentLog);
    const signedBase = acc.type === "credit" ? -Math.abs(acc.balance || 0) : Number(acc.balance || 0);
    const signedBaseMxn = convertToMxn(Math.abs(signedBase), acc.currency, fx) * (signedBase < 0 ? -1 : 1);
    const limitMxn = acc.type === "credit" && acc.creditLimitVisible ? convertToMxn(Math.abs(acc.creditLimit || 0), acc.currency, fx) : 0;
    const realMxn = signedBaseMxn + adjustment + limitMxn;
    return {
      id: idKey,
      name: String(acc.name || "Cuenta"),
      type: String(acc.type || "bank"),
      realMxn,
    };
  });

  const balanceDisponibleBase = rows.reduce((s, a) => s + a.realMxn, 0);
  const balanceDisponibleWithDebt = balanceDisponibleBase - debtImpact;
  const pendingFixedMxn = fixedStatus.pendingTotal;
  const balanceReal = balanceDisponibleBase - pendingFixedMxn;
  const balanceRealWithDebt = balanceDisponibleWithDebt - pendingFixedMxn;

  const sorted = [...rows].sort((a, b) => Math.abs(b.realMxn) - Math.abs(a.realMxn));
  const outAccounts = sorted.slice(0, Math.max(1, Math.min(20, Math.trunc(limit) || 6))).map((a) => ({
    name: a.name,
    type: a.type,
    realMxn: Math.round(a.realMxn),
  }));

  const targetKey = normalizePaymentKey(focusAccount);
  const focus = rows.find((a) => normalizePaymentKey(a.name) === targetKey)
    || rows.find((a) => {
      const k = normalizePaymentKey(a.name);
      return k.includes(targetKey) || targetKey.includes(k);
    });

  const nextCacheValues: Record<string, string> = {
    "snapshot.balanceDisponibleMxn": String(Math.round(balanceDisponibleBase)),
    "snapshot.balanceDisponibleWithDebtMxn": String(Math.round(balanceDisponibleWithDebt)),
    "snapshot.balanceRealMxn": String(Math.round(balanceReal)),
    "snapshot.balanceRealWithDebtMxn": String(Math.round(balanceRealWithDebt)),
    "snapshot.pendingFixedMxn": String(Math.round(pendingFixedMxn)),
    "snapshot.debtImpactMxn": String(Math.round(debtImpact)),
    "snapshot.focusAccount": focusAccount,
    "snapshot.focusAccountRealMxn": String(Math.round(focus?.realMxn || 0)),
    "snapshot.updatedAt": new Date().toISOString(),
  };

  for (const [k, v] of Object.entries(nextCacheValues)) {
    if (cache[k] !== v) {
      cache[k] = v;
      cacheChanged = true;
    }
  }

  if (cacheSpreadsheetId && cacheChanged && cacheWritable) {
    try {
      await saveWidgetCache(cacheSpreadsheetId, cache);
    } catch {
      cacheWritable = false;
    }
  }

  return {
    ok: true,
    updatedAt: new Date().toISOString(),
    totals: {
      balanceDisponibleMxn: Math.round(balanceDisponibleBase),
      balanceDisponibleWithDebtMxn: Math.round(balanceDisponibleWithDebt),
      balanceRealMxn: Math.round(balanceReal),
      balanceRealWithDebtMxn: Math.round(balanceRealWithDebt),
      pendingFixedMxn: Math.round(pendingFixedMxn),
      debtImpactMxn: Math.round(debtImpact),
    },
    highlights: {
      focusAccountRealMxn: Math.round(focus?.realMxn || 0),
      focusAccountFound: !!focus,
      focusAccount,
    },
    accounts: outAccounts,
    meta: {
      cacheSheet: WIDGET_CACHE_SHEET,
      fxSource: fx.source,
      fxStale: fx.stale,
      cacheWritable,
    },
  };
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
