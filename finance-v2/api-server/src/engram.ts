/**
 * engram.ts — Capa de acceso a la base de datos Engram (SQLite local).
 *
 * STRATEGY: All DB operations go through Python subprocess.
 * Reason: Engram uses WAL mode + FTS5 triggers. sql.js (WASM) can't read
 * WAL-pending data and doesn't support FTS5. Python's native sqlite3 module
 * handles both correctly, always sees consistent data.
 *
 * Performance: ~30-80ms per operation (subprocess spawn). Acceptable for a
 * local personal finance API with low concurrency.
 */

import { execFileSync } from "child_process";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const ENGRAM_DB = process.env.ENGRAM_DB_PATH || "/Users/jaystudio/.engram/engram.db";
const __dirname = dirname(fileURLToPath(import.meta.url));
const PYTHON_WRITER = join(__dirname, "../../tools/engram_write.py");
const PYTHON_READER = join(__dirname, "../../tools/engram_read.py");

// ─── TYPES ───────────────────────────────────────────────────────────────────

export interface GastoRecord {
  id?: number;
  topic_key?: string;
  fecha: string;
  monto: number;
  moneda?: string;
  concepto: string;
  lugar?: string;
  forma_pago?: string;
  tipo?: string;
  recibo?: string;
  fuente?: string;
  created_at?: string;
}

export interface FijoRecord {
  id?: number;
  topic_key?: string;
  fecha: string;
  concepto: string;
  gasto?: number;
  ingreso?: number;
  categoria?: string;
  estado?: string;
  created_at?: string;
}

export interface DeudaRecord {
  id?: number;
  topic_key?: string;
  concepto: string;
  monto: number;
  created_at?: string;
}

export interface RecuerdoRecord {
  id?: number;
  topic_key?: string;
  fecha: string;
  texto: string;
  url?: string;
  created_at?: string;
}

export interface ResumenMes {
  month: string;
  total_gastos: number;
  total_ingresos: number;
  balance: number;
  count_gastos: number;
  count_ingresos: number;
  por_tipo: Record<string, number>;
  por_forma_pago: Record<string, number>;
}

// ─── PYTHON BRIDGE ───────────────────────────────────────────────────────────

function pyExec<T>(script: string, args: string[]): T {
  const out = execFileSync("python3", [script, ...args], {
    encoding: "utf8",
    timeout: 8000,
    env: { ...process.env, ENGRAM_DB_PATH: ENGRAM_DB },
  });
  return JSON.parse(out.trim()) as T;
}

// ─── READ ────────────────────────────────────────────────────────────────────

export async function getGastos(month?: string): Promise<GastoRecord[]> {
  return pyExec<GastoRecord[]>(PYTHON_READER, [
    "--query", "gastos",
    ...(month ? ["--month", month] : []),
  ]);
}

export async function getIngresos(month?: string): Promise<GastoRecord[]> {
  return pyExec<GastoRecord[]>(PYTHON_READER, [
    "--query", "ingresos",
    ...(month ? ["--month", month] : []),
  ]);
}

export async function getFijos(): Promise<FijoRecord[]> {
  return pyExec<FijoRecord[]>(PYTHON_READER, ["--query", "fijos"]);
}

export async function getDeudas(): Promise<DeudaRecord[]> {
  return pyExec<DeudaRecord[]>(PYTHON_READER, ["--query", "deudas"]);
}

export async function getResumen(month: string): Promise<ResumenMes> {
  const [gastos, ingresos] = await Promise.all([getGastos(month), getIngresos(month)]);

  const total_gastos = gastos.reduce((s, g) => s + (g.monto || 0), 0);
  const total_ingresos = ingresos.reduce((s, g) => s + (g.monto || 0), 0);

  const por_tipo: Record<string, number> = {};
  const por_forma_pago: Record<string, number> = {};

  for (const g of gastos) {
    const tipo = g.tipo || "Sin tipo";
    por_tipo[tipo] = (por_tipo[tipo] || 0) + g.monto;
    const fp = g.forma_pago || "Sin forma";
    por_forma_pago[fp] = (por_forma_pago[fp] || 0) + g.monto;
  }

  return {
    month,
    total_gastos,
    total_ingresos,
    balance: total_ingresos - total_gastos,
    count_gastos: gastos.length,
    count_ingresos: ingresos.length,
    por_tipo,
    por_forma_pago,
  };
}

// ─── WRITE ───────────────────────────────────────────────────────────────────

function pyWrite(args: string[]): { ok: boolean; id?: number; error?: string } {
  try {
    return pyExec<{ ok: boolean; id?: number; error?: string }>(PYTHON_WRITER, args);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

export async function saveGasto(data: GastoRecord): Promise<number> {
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const ts = now.replace(/[-: ]/g, "").slice(8, 14);
  const month = (data.fecha || now.slice(0, 7)).slice(0, 7);
  const isIngreso = (data.tipo || "").toLowerCase() === "ingreso";
  const topicKey = isIngreso
    ? `finance/ingreso/${month}/${ts}`
    : `finance/gasto/${month}/${ts}`;

  const title = `${isIngreso ? "Ingreso" : "Gasto"}: ${data.concepto}${data.monto ? ` — $${data.monto}` : ""}`;
  const content = JSON.stringify({
    fecha: data.fecha || now.slice(0, 10),
    monto: data.monto,
    moneda: data.moneda || "MXN",
    concepto: data.concepto,
    lugar: data.lugar || "",
    forma_pago: data.forma_pago || "",
    tipo: data.tipo || "Gasto",
    recibo: data.recibo || "",
    fuente: data.fuente || "api-server",
  });

  const result = pyWrite([
    "--op", "insert",
    "--data", JSON.stringify({ title, content, topic_key: topicKey, type: "note", scope: "project", project: "finance-v2" }),
  ]);
  if (!result.ok) throw new Error(result.error || "engram write failed");
  return result.id ?? 0;
}

export async function updateGasto(id: number, patch: Partial<GastoRecord>): Promise<boolean> {
  // Safety check: only update finance/gasto/* records
  const rows = pyExec<{ topic_key: string }[]>(PYTHON_READER, ["--query", "topic", "--id", String(id)]);
  if (!rows.length || !rows[0].topic_key.startsWith("finance/gasto/")) return false;

  const result = pyWrite([
    "--op", "update",
    "--id", String(id),
    "--data", JSON.stringify(patch),
  ]);
  return result.ok;
}

export async function deleteGasto(id: number): Promise<boolean> {
  const result = pyWrite([
    "--op", "delete",
    "--id", String(id),
    "--topic-prefix", "finance/gasto/",
  ]);
  return result.ok;
}

export async function saveRecuerdo(data: RecuerdoRecord): Promise<number> {
  const now = new Date().toISOString().replace("T", " ").slice(0, 19);
  const fecha = data.fecha || now.slice(0, 10);
  const topicKey = `finance/recuerdo/${fecha}`;
  const content = JSON.stringify({ fecha, texto: data.texto, url: data.url || "", fuente: "api-server" });

  const result = pyWrite([
    "--op", "insert",
    "--data", JSON.stringify({ title: `Recuerdo: ${fecha}`, content, topic_key: topicKey, type: "note", scope: "project", project: "finance-v2" }),
  ]);
  if (!result.ok) throw new Error(result.error || "engram write failed");
  return result.id ?? 0;
}
