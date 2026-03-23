export function normalizeText(input: string): string {
  return (input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function parseNumber(value: unknown): number {
  if (typeof value === "number") return value;
  const str = String(value ?? "").replace(/[^\d.-]/g, "").trim();
  const n = Number(str);
  return Number.isFinite(n) ? n : 0;
}

export function parseDate(input: string): Date | null {
  if (!input) return null;
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function inDateRange(input: string, from?: string, to?: string): boolean {
  const d = parseDate(input);
  if (!d) return false;
  if (from) {
    const f = parseDate(from);
    if (f && d < f) return false;
  }
  if (to) {
    const t = parseDate(to);
    if (t && d > t) return false;
  }
  return true;
}

export function safeJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}
