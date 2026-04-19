#!/usr/bin/env python3
"""
finance_delete.py — Busca y borra filas de Control de Gastos (u otras sheets).

Uso:
  python3 finance_delete.py --sheet gastos --concepto "Gasolina"
  python3 finance_delete.py --sheet gastos --concepto "Gasolina" --fecha 2026-04-18
  python3 finance_delete.py --sheet gastos --row 265          # borrar fila exacta (1-indexed, con header)
  python3 finance_delete.py --sheet gastos --concepto "X" --list  # solo mostrar, no borrar

Sheets soportadas: gastos, recuerdos, rsm, pelo
"""

import argparse
import json
import sys
import base64
from datetime import datetime


SHEET_CONFIG = {
    'gastos': {
        'env_key': 'SPREADSHEET_LOG_ID',
        'sheet_name': 'Hoja 1',
        'cols': ['Fecha', 'Lugar', 'Concepto', 'Monto', 'Tipo', 'FormaPago', 'Link', 'Moneda'],
        'search_col': 2,   # Concepto (0-indexed)
        'date_col': 0,     # Fecha (0-indexed)
        'range': 'Hoja 1!A:H',
    },
    'recuerdos': {
        'env_key': 'SPREADSHEET_RECUERDOS_ID',
        'sheet_name': 'Datos',
        'cols': ['Fecha', 'Texto', 'URL'],
        'search_col': 1,
        'date_col': 0,
        'range': 'Datos!A:C',
    },
    'rsm': {
        'env_key': 'SPREADSHEET_RSM_ID',
        'sheet_name': 'Hoja 1',
        'cols': ['Fecha', 'Monto', 'Recibo'],
        'search_col': 2,
        'date_col': 0,
        'range': 'Hoja 1!A:C',
    },
}


def load_credentials():
    env_path = '/Users/jaystudio/Documents/GitHub/Apps/musicknobs/finance-mcp-server/.env'
    env_vars = {}
    with open(env_path) as f:
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
        sa_json, scopes=['https://www.googleapis.com/auth/spreadsheets'])
    return build('sheets', 'v4', credentials=creds)


def get_sheet_id(service, spreadsheet_id, sheet_name):
    meta = service.spreadsheets().get(spreadsheetId=spreadsheet_id).execute()
    for s in meta['sheets']:
        if s['properties']['title'] == sheet_name:
            return s['properties']['sheetId']
    raise ValueError(f"Sheet '{sheet_name}' no encontrada")


def find_rows(rows, concepto, fecha, search_col, date_col):
    """Busca filas que coincidan y regresa índice real de sheet (1-based)."""
    matches = []
    query = concepto.lower().strip()
    for i, row in enumerate(rows):
        cell = row[search_col].lower() if len(row) > search_col else ''
        if query not in cell:
            continue
        if fecha:
            date_cell = row[date_col] if len(row) > date_col else ''
            if fecha not in date_cell:
                continue
        # rows viene sin header (all_rows[1:]), por eso +2 => fila real en sheet
        matches.append((i + 2, row))
    return matches


def delete_row(service, spreadsheet_id, sheet_id, row_index_1based):
    """Borra una fila por índice 1-based (con header en fila 1)."""
    zero_idx = row_index_1based - 1
    body = {'requests': [{'deleteDimension': {'range': {
        'sheetId': sheet_id,
        'dimension': 'ROWS',
        'startIndex': zero_idx,
        'endIndex': zero_idx + 1
    }}}]}
    service.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id, body=body).execute()


def print_row(idx, row, cols):
    parts = []
    for i, col in enumerate(cols):
        val = row[i] if len(row) > i else ''
        if val:
            parts.append(f"{col}: {val}")
    print(f"  [{idx}] " + " | ".join(parts))


def main():
    parser = argparse.ArgumentParser(description='Borra filas de Google Sheets financieros')
    parser.add_argument('--sheet', required=True, choices=list(SHEET_CONFIG.keys()))
    parser.add_argument('--concepto', help='Texto a buscar (substring, case-insensitive)')
    parser.add_argument('--fecha', help='Filtrar por fecha (YYYY-MM-DD)')
    parser.add_argument('--row', type=int, help='Número de fila exacto a borrar (1-indexed, header=1)')
    parser.add_argument('--list', action='store_true', dest='list_only',
                        help='Solo mostrar coincidencias, no borrar')
    parser.add_argument('--yes', action='store_true', help='Confirmar borrado sin preguntar')
    args = parser.parse_args()

    if not args.concepto and not args.row:
        print("ERROR: Necesitas --concepto o --row")
        sys.exit(1)

    cfg = SHEET_CONFIG[args.sheet]
    env_vars = load_credentials()
    service = get_sheets_service(env_vars)
    spreadsheet_id = env_vars[cfg['env_key']]

    # Borrar por número de fila exacto
    if args.row:
        if args.list_only:
            # Leer y mostrar esa fila
            result = service.spreadsheets().values().get(
                spreadsheetId=spreadsheet_id,
                range=f"{cfg['sheet_name']}!A{args.row}:{chr(ord('A') + len(cfg['cols']))}{args.row}"
            ).execute()
            row = result.get('values', [[]])[0]
            print(f"Fila {args.row}:")
            print_row(args.row, row, cfg['cols'])
            return

        if not args.yes:
            confirm = input(f"¿Borrar fila {args.row} de '{args.sheet}'? (s/N): ")
            if confirm.lower() not in ('s', 'si', 'sí', 'y', 'yes'):
                print("Cancelado.")
                return

        sheet_id = get_sheet_id(service, spreadsheet_id, cfg['sheet_name'])
        delete_row(service, spreadsheet_id, sheet_id, args.row)
        print(f"✅ Fila {args.row} eliminada de '{args.sheet}'")
        return

    # Buscar por concepto
    result = service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id, range=cfg['range']).execute()
    all_rows = result.get('values', [])

    if not all_rows:
        print("Sheet vacía o sin datos.")
        return

    # Fila 1 = header, búsqueda desde fila 2
    data_rows = all_rows[1:]
    matches = find_rows(data_rows, args.concepto, args.fecha,
                        cfg['search_col'], cfg['date_col'])

    if not matches:
        print(f"No se encontraron filas con concepto '{args.concepto}'" +
              (f" y fecha '{args.fecha}'" if args.fecha else "") + ".")
        return

    print(f"Se encontraron {len(matches)} fila(s):")
    for real_row, row in matches:
        print_row(real_row, row, cfg['cols'])

    if args.list_only:
        return

    if len(matches) == 1:
        real_row, row = matches[0]
        if not args.yes:
            confirm = input(f"\n¿Borrar esta fila? (s/N): ")
            if confirm.lower() not in ('s', 'si', 'sí', 'y', 'yes'):
                print("Cancelado.")
                return
        sheet_id = get_sheet_id(service, spreadsheet_id, cfg['sheet_name'])
        delete_row(service, spreadsheet_id, sheet_id, real_row)
        print(f"✅ Eliminado: {row[cfg['search_col']] if len(row) > cfg['search_col'] else ''}")

    else:
        if not args.yes:
            print("\nVarias coincidencias. Opciones:")
            print("  --row N      → borrar fila específica")
            print("  --fecha X    → filtrar por fecha para reducir resultados")
            print("  --yes        → borrar TODAS las coincidencias (cuidado)")
            return

        # --yes con múltiples: borrar de abajo hacia arriba para no desplazar índices
        sheet_id = get_sheet_id(service, spreadsheet_id, cfg['sheet_name'])
        rows_to_delete = sorted([r for r, _ in matches], reverse=True)
        for r in rows_to_delete:
            delete_row(service, spreadsheet_id, sheet_id, r)
            print(f"✅ Fila {r} eliminada")


if __name__ == '__main__':
    main()
