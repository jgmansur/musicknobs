#!/usr/bin/env python3
"""Migra Google Sheets → Supabase.

Cómo se evita contar doble el saldo
-----------------------------------
El saldo que hoy vive en la hoja Saldos YA refleja todos los movimientos
históricos. Si importáramos los 515 movimientos y además fijáramos ese saldo,
cada gasto contaría dos veces.

La solución: `opening_balance` = saldo actual de la hoja, y
`opening_balance_at` = momento de la migración. La vista `account_balances`
solo suma movimientos con `occurred_at >= opening_balance_at`, así que el
histórico queda disponible para análisis pero no altera el saldo. A partir de
la migración, cada movimiento nuevo sí mueve el saldo.

Uso:
    export SUPABASE_DB_URL='postgresql://...'
    python3 migrate_sheets.py --dry-run      # revisa antes de escribir
    python3 migrate_sheets.py --apply
"""

from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation

from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

SHEETS = {
    "gastos": "1pn1bsxj2LaoySXAVUvqfEJY1VR4R_T8NsTOqQnVW5Xw",
    "fijos": "1EoK2KTAKAkAtdaeTVYBU1Gf3K-B7PuHzFpA4Pd39hWA",
    "saldos": "1-cX_qxld3ioSpcO9lEBPg90Db6AyK7SczpJTvj7rw4U",
}

ENV_PATH = (
    "/Users/jaystudio/Documents/GitHub/Apps/musicknobs/finance-mcp-server/.env"
)

MX = timezone.utc  # los timestamps se normalizan a UTC al escribir

# Anomalías encontradas al convertir; se imprimen al final en vez de adivinar.
warnings: list[str] = []


# ---------------------------------------------------------------------------
# Conversión de formatos legacy
# ---------------------------------------------------------------------------
def parse_legacy_amount(raw: str, ctx: str) -> Decimal | None:
    """Convierte el formato español de la hoja ("$25.000,00") a Decimal.

    Punto = separador de miles, coma = decimal. El caso ambiguo es un punto
    solo ("1.300"): en español son mil trescientos, pero podría ser 1.3 mal
    escrito. Se resuelve como miles solo si van exactamente 3 dígitos después,
    y se registra la advertencia para que quede a la vista.
    """
    if raw is None:
        return None
    s = str(raw).strip()
    if not s:
        return None
    s = re.sub(r"[^\d,.\-]", "", s)
    if not s or s in {"-", ".", ","}:
        return None

    has_dot, has_comma = "." in s, "," in s
    if has_dot and has_comma:
        s = s.replace(".", "").replace(",", ".")
    elif has_comma:
        s = s.replace(",", ".")
    elif has_dot:
        if re.fullmatch(r"-?\d{1,3}(?:\.\d{3})+", s):
            s = s.replace(".", "")
        else:
            warnings.append(f"monto ambiguo '{raw}' interpretado como decimal en {ctx}")

    try:
        return Decimal(s)
    except InvalidOperation:
        warnings.append(f"monto ilegible '{raw}' en {ctx}")
        return None


def parse_legacy_date(raw: str, ctx: str) -> datetime | None:
    """Acepta '2026-02-04' y '4/02/2026 10:07:41'."""
    if not raw:
        return None
    s = str(raw).strip()

    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return datetime(int(m[1]), int(m[2]), int(m[3]), 12, 0, tzinfo=MX)

    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?)?", s)
    if m:
        return datetime(
            int(m[3]), int(m[2]), int(m[1]),
            int(m[4] or 12), int(m[5] or 0), int(m[6] or 0), tzinfo=MX,
        )

    warnings.append(f"fecha ilegible '{raw}' en {ctx}")
    return None


def parse_bool(raw) -> bool:
    return str(raw).strip().upper() in {"TRUE", "VERDADERO", "1", "SI", "SÍ"}


# ---------------------------------------------------------------------------
# Lectura de Sheets
# ---------------------------------------------------------------------------
def sheets_client():
    env = {}
    with open(ENV_PATH) as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, _, v = line.partition("=")
            env[k.strip()] = v.strip().strip('"').strip("'")
    sa = json.loads(base64.b64decode(env["GOOGLE_SERVICE_ACCOUNT_JSON_BASE64"]).decode())
    creds = Credentials.from_service_account_info(
        sa, scopes=["https://www.googleapis.com/auth/spreadsheets.readonly"]
    )
    return build("sheets", "v4", credentials=creds)


def read(svc, sheet: str, rng: str) -> list[list[str]]:
    return (
        svc.spreadsheets()
        .values()
        .get(spreadsheetId=SHEETS[sheet], range=rng)
        .execute()
        .get("values", [])
    )


# ---------------------------------------------------------------------------
# Extracción
# ---------------------------------------------------------------------------
def extract_accounts(svc) -> list[dict]:
    rows = read(svc, "saldos", "Hoja 1!A2:K")
    out = []
    for i, r in enumerate(rows, start=2):
        r = r + [""] * (11 - len(r))
        if not r[0].strip():
            continue
        balance = parse_legacy_amount(r[2], f"Saldos!C{i}") or Decimal(0)
        acc_type = r[3].strip() or "bank"

        # La hoja guarda la deuda de tarjetas como número positivo. El esquema
        # usa signo de flujo de efectivo, así que una deuda es saldo negativo;
        # la vista `account_balances` la vuelve a mostrar positiva.
        if acc_type == "credit":
            balance = -abs(balance)

        out.append({
            "legacy_id": r[0].strip(),
            "name": r[1].strip(),
            "opening_balance": balance,
            "type": acc_type,
            "hidden": parse_bool(r[4]),
            "credit_limit": parse_legacy_amount(r[5], f"Saldos!F{i}") or Decimal(0),
            "credit_limit_visible": parse_bool(r[6]),
            "currency": (r[7].strip() or "MXN"),
            "investment_type": r[8].strip() or None,
            "custom_annual_rate": parse_legacy_amount(r[9], f"Saldos!J{i}") or Decimal(0),
            "bitcoin_initial_mxn": parse_legacy_amount(r[10], f"Saldos!K{i}") or Decimal(0),
        })
    return out


def extract_transactions(svc, account_by_name: dict[str, str]) -> list[dict]:
    rows = read(svc, "gastos", "Hoja 1!A2:G")
    out = []
    for i, r in enumerate(rows, start=2):
        r = r + [""] * (7 - len(r))
        fecha, lugar, concepto, monto, tipo, forma, recibo = (c.strip() for c in r[:7])
        if not fecha and not monto:
            continue

        occurred = parse_legacy_date(fecha, f"Gastos!A{i}")
        amount = parse_legacy_amount(monto, f"Gastos!D{i}")
        if occurred is None or amount is None:
            continue
        if amount == 0:
            # Filas de cuotas condonadas; no mueven dinero.
            continue

        kind = "ingreso" if tipo.lower().startswith("ingreso") else "gasto"
        signed = amount if kind == "ingreso" else -abs(amount)

        out.append({
            "legacy_row": i,
            "occurred_at": occurred,
            "amount": signed,
            "kind": kind,
            "merchant": lugar or None,
            "description": concepto or None,
            "receipt_url": recibo or None,
            "forma_pago": forma or None,
            "account_hint": account_by_name.get(forma.lower()),
            "source": "fijo" if lugar == "Gasto Fijo" else "import",
        })
    return out


def extract_fixed(svc) -> list[dict]:
    rows = read(svc, "fijos", "Hoja 1!A2:P")
    out = []
    for i, r in enumerate(rows, start=2):
        r = r + [""] * (16 - len(r))
        concepto = r[0].strip()
        if not concepto:
            continue
        monto = parse_legacy_amount(r[2], f"Fijos!C{i}")
        if monto is None:
            continue
        fechas = [int(x) for x in re.findall(r"\d+", r[15] or "") if 1 <= int(x) <= 31]
        out.append({
            "legacy_row": i,
            "concepto": concepto,
            "categoria": r[1].strip() or None,
            "monto": monto,
            "moneda": (r[3].strip() or "MXN"),
            "tipo": r[4].strip() or None,
            "pagos_mes": max(1, int(re.sub(r"\D", "", r[6]) or 1)),
            "periodicidad": r[8].strip() or None,
            "pagador": r[10].strip() or None,
            "budget_category": r[11].strip() or None,
            "link_group": r[14].strip() or None,
            "fechas_pago": fechas,
        })
    return out


# ---------------------------------------------------------------------------
# Escritura
# ---------------------------------------------------------------------------
def apply_to_supabase(accounts, transactions, fixed) -> None:
    try:
        import psycopg
    except ImportError:
        sys.exit("Falta psycopg: pip3 install 'psycopg[binary]'")

    dsn = os.environ.get("SUPABASE_DB_URL")
    if not dsn:
        sys.exit("Falta SUPABASE_DB_URL en el entorno.")

    now = datetime.now(timezone.utc)

    with psycopg.connect(dsn) as conn, conn.cursor() as cur:
        ids: dict[str, str] = {}
        for a in accounts:
            cur.execute(
                """
                insert into accounts (legacy_id, name, type, currency, hidden,
                    credit_limit, credit_limit_visible, investment_type,
                    custom_annual_rate, bitcoin_initial_mxn,
                    opening_balance, opening_balance_at)
                values (%(legacy_id)s, %(name)s, %(type)s, %(currency)s, %(hidden)s,
                    %(credit_limit)s, %(credit_limit_visible)s, %(investment_type)s,
                    %(custom_annual_rate)s, %(bitcoin_initial_mxn)s,
                    %(opening_balance)s, %(at)s)
                on conflict (legacy_id) do update set
                    name = excluded.name,
                    opening_balance = excluded.opening_balance,
                    opening_balance_at = excluded.opening_balance_at
                returning id
                """,
                {**a, "at": now},
            )
            ids[a["name"].lower()] = cur.fetchone()[0]

        fallback = next(iter(ids.values()))
        for t in transactions:
            account_id = ids.get((t["forma_pago"] or "").lower(), fallback)
            cur.execute(
                """
                insert into transactions (occurred_at, account_id, amount, kind,
                    merchant, description, receipt_url, source, source_ref)
                values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                on conflict (source, source_ref) where source_ref is not null
                do nothing
                """,
                (
                    t["occurred_at"], account_id, t["amount"], t["kind"],
                    t["merchant"], t["description"], t["receipt_url"],
                    t["source"], f"sheet:gastos:{t['legacy_row']}",
                ),
            )

        for f in fixed:
            cur.execute(
                """
                insert into fixed_expenses (legacy_row, concepto, categoria, monto,
                    moneda, tipo, pagos_mes, periodicidad, pagador,
                    budget_category, link_group, fechas_pago)
                values (%(legacy_row)s, %(concepto)s, %(categoria)s, %(monto)s,
                    %(moneda)s, %(tipo)s, %(pagos_mes)s, %(periodicidad)s, %(pagador)s,
                    %(budget_category)s, %(link_group)s, %(fechas_pago)s)
                """,
                f,
            )
        conn.commit()


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--apply", action="store_true", help="escribe en Supabase")
    ap.add_argument("--dry-run", action="store_true", default=True)
    args = ap.parse_args()

    svc = sheets_client()
    accounts = extract_accounts(svc)
    by_name = {a["name"].lower(): a["legacy_id"] for a in accounts}
    transactions = extract_transactions(svc, by_name)
    fixed = extract_fixed(svc)

    print(f"Cuentas:     {len(accounts)}")
    print(f"Movimientos: {len(transactions)}")
    print(f"Fijos:       {len(fixed)}")
    print()
    for a in accounts:
        print(f"  {a['name']:<28} {a['opening_balance']:>16} {a['currency']}")

    if warnings:
        print(f"\n{len(warnings)} advertencias de conversión:")
        for w in warnings[:25]:
            print(f"  - {w}")
        if len(warnings) > 25:
            print(f"  ... y {len(warnings) - 25} más")

    if args.apply:
        apply_to_supabase(accounts, transactions, fixed)
        print("\nMigración aplicada.")
    else:
        print("\nSimulación. Corre con --apply para escribir.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
