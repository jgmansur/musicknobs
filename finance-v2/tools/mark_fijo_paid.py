#!/usr/bin/env python3
"""
mark_fijo_paid.py — Marca un gasto fijo como pagado (o pendiente) en Google Sheets.

Uso:
  python3 mark_fijo_paid.py --concepto "Telcel"
  python3 mark_fijo_paid.py --concepto "Telcel Jay" --cuota 1
  python3 mark_fijo_paid.py --concepto "Escuela Roby" --cuota 2
  python3 mark_fijo_paid.py --concepto "Telcel" --unpay         # revertir a pendiente
  python3 mark_fijo_paid.py --list                              # listar todos los fijos del mes
"""

import argparse
import json
import sys
import base64
from difflib import SequenceMatcher

SPREADSHEET_FIXED_ID = '1EoK2KTAKAkAtdaeTVYBU1Gf3K-B7PuHzFpA4Pd39hWA'
ENV_PATH = '/Users/jaystudio/Documents/GitHub/Apps/musicknobs/finance-mcp-server/.env'


# ─── Credenciales ────────────────────────────────────────────────────────────

def load_credentials():
    env_vars = {}
    with open(ENV_PATH) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, _, val = line.partition('=')
            env_vars[key.strip()] = val.strip().strip('"').strip("'")
    return env_vars

def get_sheets_service(env_vars):
    try:
        from google.oauth2.service_account import Credentials
        from googleapiclient.discovery import build
    except ImportError:
        print("ERROR: pip3 install google-auth google-api-python-client --break-system-packages")
        sys.exit(1)
    sa_json = json.loads(base64.b64decode(env_vars['GOOGLE_SERVICE_ACCOUNT_JSON_BASE64']).decode())
    creds = Credentials.from_service_account_info(
        sa_json, scopes=['https://www.googleapis.com/auth/spreadsheets']
    )
    return build('sheets', 'v4', credentials=creds)


# ─── Helpers de estados ───────────────────────────────────────────────────────

def parse_payment_states(raw, pagos_mes):
    """'101' → [True, False, True]"""
    count = max(1, int(pagos_mes or 1))
    chars = (str(raw or '')).replace(' ', '')[:count]
    states = [False] * count
    for i, c in enumerate(chars):
        if i < count:
            states[i] = (c == '1')
    return states

def serialize_payment_states(states):
    """[True, False, True] → '101'"""
    return ''.join('1' if s else '0' for s in states)

def parse_bool(val):
    return str(val).strip().upper() in ('TRUE', '1', 'YES')


# ─── Leer sheet ──────────────────────────────────────────────────────────────

def read_all_rows(service):
    result = service.spreadsheets().values().get(
        spreadsheetId=SPREADSHEET_FIXED_ID,
        range='Hoja 1!A:P'
    ).execute()
    return result.get('values', [])

def parse_rows(rows):
    """
    Columnas (0-indexed):
      0=dia, 1=concepto, 2=gasto, 3=ingreso, 4=categoria,
      5=isPaid(legacy), 6=pagosMes, 7=pagosEstado, 8=periodicidad,
      9=inicioMes, 10=pagador/forma, 11=budget, 12=moneda,
      13=waivedEstado, 14=linkGroup, 15=fechasPago
    """
    items = []
    for i, row in enumerate(rows[1:], start=2):  # row 2 en el sheet
        concepto = row[1].strip() if len(row) > 1 else ''
        if not concepto:
            continue
        pagos_mes = int(row[6]) if len(row) > 6 and str(row[6]).isdigit() else 1
        pagos_estado_raw = row[7] if len(row) > 7 else ''
        waived_raw = row[13] if len(row) > 13 else ''
        legacy_paid = parse_bool(row[5]) if len(row) > 5 else False
        pagos_estado = parse_payment_states(pagos_estado_raw, pagos_mes)
        pagos_hechos = sum(1 for p in pagos_estado if p)
        is_paid = pagos_hechos >= pagos_mes
        tipo = 'ingreso' if (not row[2].strip() if len(row) > 2 else True) and (row[3].strip() if len(row) > 3 else '') else 'gasto'
        items.append({
            'row_num': i,
            'concepto': concepto,
            'tipo': tipo,
            'pagos_mes': pagos_mes,
            'pagos_estado': pagos_estado,
            'pagos_hechos': pagos_hechos,
            'is_paid': is_paid,
            'pagos_estado_raw': pagos_estado_raw,
            'waived_raw': waived_raw,
            'legacy_paid': legacy_paid,
        })
    return items


# ─── Fuzzy match ──────────────────────────────────────────────────────────────

def best_match(query, items, threshold=0.4):
    query_lower = query.lower()
    best = None
    best_score = 0
    for item in items:
        name = item['concepto'].lower()
        # Exact substring primero
        if query_lower in name or name in query_lower:
            score = 1.0
        else:
            score = SequenceMatcher(None, query_lower, name).ratio()
        if score > best_score:
            best_score = score
            best = item
    if best_score >= threshold:
        return best, best_score
    return None, 0


# ─── Escribir al sheet ────────────────────────────────────────────────────────

def update_payment(service, row_num, pagos_mes, pagos_estado):
    is_paid = all(pagos_estado)
    col_f = 'TRUE' if is_paid else 'FALSE'
    serialized = serialize_payment_states(pagos_estado)
    range_notation = f'Hoja 1!F{row_num}:H{row_num}'
    service.spreadsheets().values().update(
        spreadsheetId=SPREADSHEET_FIXED_ID,
        range=range_notation,
        valueInputOption='USER_ENTERED',
        body={'values': [[col_f, pagos_mes, serialized]]}
    ).execute()
    return is_paid, serialized


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description='Marca un gasto fijo como pagado')
    parser.add_argument('--concepto', help='Nombre (o parte del nombre) del gasto fijo')
    parser.add_argument('--cuota', type=int, default=None,
                        help='Número de cuota a marcar (1-based). Si no se especifica, marca todas.')
    parser.add_argument('--unpay', action='store_true',
                        help='Revertir a pendiente en lugar de marcar como pagado')
    parser.add_argument('--list', action='store_true', dest='list_all',
                        help='Listar todos los fijos con su estado actual')
    parser.add_argument('--dry-run', action='store_true',
                        help='Muestra qué haría sin escribir al sheet')
    args = parser.parse_args()

    env_vars = load_credentials()
    service = get_sheets_service(env_vars)
    rows = read_all_rows(service)
    items = parse_rows(rows)

    # ── Listar ──
    if args.list_all:
        print(f"\n{'#':<4} {'Concepto':<40} {'Tipo':<8} {'Cuotas':<8} {'Estado'}")
        print('─' * 75)
        for item in items:
            estado = '✅ Pagado' if item['is_paid'] else f"⏳ {item['pagos_hechos']}/{item['pagos_mes']}"
            print(f"{item['row_num']:<4} {item['concepto']:<40} {item['tipo']:<8} {item['pagos_mes']:<8} {estado}")
        return

    if not args.concepto:
        print("ERROR: Especifica --concepto o --list")
        sys.exit(1)

    # ── Buscar ──
    match, score = best_match(args.concepto, items)
    if not match:
        print(f"ERROR: No encontré ningún fijo que coincida con '{args.concepto}'")
        print("Usa --list para ver todos los disponibles.")
        sys.exit(1)

    item = match
    pagos_estado = list(item['pagos_estado'])
    pagos_mes = item['pagos_mes']
    new_value = not args.unpay  # True = pagado, False = pendiente

    # ── Cuota específica o todas ──
    if args.cuota is not None:
        idx = args.cuota - 1  # 1-based → 0-based
        if idx < 0 or idx >= pagos_mes:
            print(f"ERROR: Cuota {args.cuota} inválida. Este fijo tiene {pagos_mes} cuota(s).")
            sys.exit(1)
        pagos_estado[idx] = new_value
        cuota_desc = f"cuota {args.cuota}"
    else:
        pagos_estado = [new_value] * pagos_mes
        cuota_desc = "todas las cuotas" if pagos_mes > 1 else "pago único"

    accion = "↩️  Revertido a pendiente" if args.unpay else "✅ Marcado como pagado"

    if args.dry_run:
        print(f"[DRY RUN] Fijo encontrado: '{item['concepto']}' (row {item['row_num']}, score={score:.2f})")
        print(f"[DRY RUN] Acción: {accion} — {cuota_desc}")
        print(f"[DRY RUN] Estado nuevo: {serialize_payment_states(pagos_estado)}")
        return

    is_all_paid, serialized = update_payment(service, item['row_num'], pagos_mes, pagos_estado)
    paid_count = sum(1 for p in pagos_estado if p)

    print(f"\n{accion}: {item['concepto']}")
    print(f"  Cuota(s): {cuota_desc}")
    print(f"  Progreso: {paid_count}/{pagos_mes} pagos")
    print(f"  Estado guardado: {serialized}")
    if is_all_paid:
        print(f"  🎉 ¡Completamente pagado este mes!")


if __name__ == '__main__':
    main()
