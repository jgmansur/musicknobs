#!/usr/bin/env python3
"""
finance_write.py — Escribe datos financieros a Google Sheets via service account.

Uso:
  python3 finance_write.py --sheet gastos --data '{"fecha":"2026-04-17","monto":450,"concepto":"Gasolina","lugar":"BP","forma_pago":"Santander débito","tipo":"Gasto"}'
  python3 finance_write.py --sheet fijos --data '{"fecha":"2026-04-17","concepto":"Telcel","gasto":500}'
  python3 finance_write.py --sheet deudas --data '{"concepto":"Crédito Santander","monto":5000}'
  python3 finance_write.py --sheet recuerdos --data '{"texto":"Fuimos al cine con los niños"}'
  python3 finance_write.py --sheet rsm --data '{"monto":350,"recibo":"Farmacia Benavides"}'
  python3 finance_write.py --sheet pelo --data '{"amount":250,"forma_pago":"Efectivo","notes":"Corte normal"}'
"""

import argparse
import json
import sys
import base64
import os
import subprocess
import time
import re
from datetime import datetime

RECEIPT_ITEMS_SHEET = 'Receipt Items'
RECEIPT_ITEMS_HEADERS = [
    'fecha', 'recibo_id', 'comercio', 'producto_raw', 'producto_normalizado',
    'categoria', 'subcategoria', 'cantidad', 'precio_unitario', 'total_item',
    'forma_pago', 'recibo', 'confianza'
]

ALLOWED_FORMAS_PAGO = {
    'Santander',
    'BBVA',
    'Bank of America',
    'Tarjeta de Crédito LikeU',
    'cuenta Mariel',
    'efectivo',
    'cetes',
    'Mifel',
    'bitcoin',
}

FORMA_PAGO_ALIASES = {
    'santander': 'Santander',
    'bbva': 'BBVA',
    'bank of america': 'Bank of America',
    'boa': 'Bank of America',
    'tarjeta de credito likeu': 'Tarjeta de Crédito LikeU',
    'tarjeta de crédito likeu': 'Tarjeta de Crédito LikeU',
    'likeu': 'Tarjeta de Crédito LikeU',
    'tarjeta likeu': 'Tarjeta de Crédito LikeU',
    'cuenta mariel': 'cuenta Mariel',
    'efectivo': 'efectivo',
    'cetes': 'cetes',
    'mifel': 'Mifel',
    'bitcoin': 'bitcoin',
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
        print("ERROR: Instalar dependencias: pip3 install google-auth google-api-python-client --break-system-packages")
        sys.exit(1)

    sa_json = json.loads(base64.b64decode(env_vars['GOOGLE_SERVICE_ACCOUNT_JSON_BASE64']).decode())
    creds = Credentials.from_service_account_info(
        sa_json,
        scopes=['https://www.googleapis.com/auth/spreadsheets']
    )
    return build('sheets', 'v4', credentials=creds)

def format_date(date_str=None):
    """Normaliza fecha a formato DD/MM/YYYY que usa el sheet."""
    if not date_str:
        return datetime.now().strftime('%Y-%m-%d')
    return date_str

def format_amount(amount):
    """Formatea monto como número limpio."""
    if isinstance(amount, str):
        # Limpiar signos y espacios
        amount = amount.replace('$', '').replace(',', '').replace(' ', '').strip()
        try:
            return float(amount)
        except ValueError:
            return 0.0
    return float(amount)

def is_url(value):
    value = (value or '').strip().lower()
    return value.startswith('http://') or value.startswith('https://')

def drive_url_from_local_path(path):
    """Construye URL de Google Drive usando el item-id local de DriveFS."""
    path = (path or '').strip()
    if not path or not os.path.exists(path):
        return ''
    try:
        file_id = subprocess.check_output(
            ['xattr', '-p', 'com.google.drivefs.item-id#S', path],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except Exception:
        return ''
    if not file_id:
        return ''
    return f'https://drive.google.com/file/d/{file_id}/view'

def wait_for_drive_url(path, timeout_seconds=180, interval_seconds=5):
    """Espera a que DriveFS exponga item-id y devuelve URL."""
    path = (path or '').strip()
    if not path:
        return ''
    deadline = time.time() + max(0, int(timeout_seconds or 0))
    while True:
        url = drive_url_from_local_path(path)
        if url:
            return url
        if time.time() >= deadline:
            return ''
        time.sleep(max(1, int(interval_seconds or 1)))

def get_recibo_source_path(data):
    recibo = (data.get('recibo') or '').strip()
    if recibo and not is_url(recibo):
        return recibo
    return (data.get('recibo_path') or data.get('recibo_local_path') or '').strip()

def normalize_forma_pago(raw):
    raw = (raw or '').strip()
    if not raw:
        return ''

    normalized_key = raw.lower()
    if normalized_key in FORMA_PAGO_ALIASES:
        return FORMA_PAGO_ALIASES[normalized_key]

    for option in ALLOWED_FORMAS_PAGO:
        if raw.lower() == option.lower():
            return option

    allowed = ', '.join(sorted(ALLOWED_FORMAS_PAGO))
    raise ValueError(
        f"Forma de pago no permitida: '{raw}'. Usa una existente: {allowed}. "
        "Si necesitas una nueva, debe pedirse explícitamente."
    )

def resolve_recibo_value(data):
    """Acepta URL directa o path local de un archivo sincronizado con Google Drive."""
    recibo = (data.get('recibo') or '').strip()
    if is_url(recibo):
        return recibo
    if recibo:
        drive_url = drive_url_from_local_path(recibo)
        if drive_url:
            return drive_url
    recibo_path = (data.get('recibo_path') or data.get('recibo_local_path') or '').strip()
    if recibo_path:
        return drive_url_from_local_path(recibo_path)
    return ''

def append_row(service, spreadsheet_id, sheet_name, values):
    body = {'values': [values]}
    result = service.spreadsheets().values().append(
        spreadsheetId=spreadsheet_id,
        range=f'{sheet_name}!A:Z',
        valueInputOption='USER_ENTERED',
        insertDataOption='INSERT_ROWS',
        body=body
    ).execute()
    updated = result.get('updates', {}).get('updatedRows', 0)
    return updated

def append_rows(service, spreadsheet_id, sheet_name, rows):
    body = {'values': rows}
    result = service.spreadsheets().values().append(
        spreadsheetId=spreadsheet_id,
        range=f'{sheet_name}!A:Z',
        valueInputOption='USER_ENTERED',
        insertDataOption='INSERT_ROWS',
        body=body
    ).execute()
    return result.get('updates', {}).get('updatedRows', 0)

def append_row_with_meta(service, spreadsheet_id, sheet_name, values):
    body = {'values': [values]}
    result = service.spreadsheets().values().append(
        spreadsheetId=spreadsheet_id,
        range=f'{sheet_name}!A:Z',
        valueInputOption='USER_ENTERED',
        insertDataOption='INSERT_ROWS',
        body=body
    ).execute()
    updates = result.get('updates', {})
    return {
        'updated_rows': updates.get('updatedRows', 0),
        'updated_range': updates.get('updatedRange', ''),
    }

def ensure_sheet_tab(service, spreadsheet_id, sheet_name):
    meta = service.spreadsheets().get(
        spreadsheetId=spreadsheet_id,
        fields='sheets.properties.title'
    ).execute()
    titles = {s['properties']['title'] for s in meta.get('sheets', [])}
    if sheet_name in titles:
        return
    service.spreadsheets().batchUpdate(
        spreadsheetId=spreadsheet_id,
        body={'requests': [{'addSheet': {'properties': {'title': sheet_name}}}]}
    ).execute()

def ensure_headers(service, spreadsheet_id, sheet_name, headers):
    ensure_sheet_tab(service, spreadsheet_id, sheet_name)
    existing = service.spreadsheets().values().get(
        spreadsheetId=spreadsheet_id,
        range=f'{sheet_name}!A1:{chr(64 + len(headers))}1'
    ).execute().get('values', [])
    if existing and existing[0][:len(headers)] == headers:
        return
    service.spreadsheets().values().update(
        spreadsheetId=spreadsheet_id,
        range=f'{sheet_name}!A1:{chr(64 + len(headers))}1',
        valueInputOption='USER_ENTERED',
        body={'values': [headers]}
    ).execute()

def extract_row_number(updated_range):
    if not updated_range:
        return None
    match = re.search(r'![A-Z]+(\d+):[A-Z]+\d+', updated_range)
    if not match:
        return None
    return int(match.group(1))

def write_gastos(service, env_vars, data):
    """
    Columnas: Fecha, Lugar, Concepto, Monto, Tipo, Forma de Pago, Recibos
    """
    forma_pago = normalize_forma_pago(data.get('forma_pago', ''))
    receipt_input_path = get_recibo_source_path(data)
    recibo_url = resolve_recibo_value(data)
    row = [
        format_date(data.get('fecha')),
        data.get('lugar', ''),
        data.get('concepto', ''),
        format_amount(data.get('monto', 0)),
        data.get('tipo', 'Gasto'),
        forma_pago,
        recibo_url
    ]
    result = append_row_with_meta(service, env_vars['SPREADSHEET_LOG_ID'], 'Hoja 1', row)

    if not recibo_url and receipt_input_path:
        wait_seconds = int(os.getenv('FINANCE_RECIBO_WAIT_SECONDS', '180'))
        wait_interval = int(os.getenv('FINANCE_RECIBO_WAIT_INTERVAL_SECONDS', '5'))
        delayed_url = wait_for_drive_url(receipt_input_path, wait_seconds, wait_interval)
        target_row = extract_row_number(result.get('updated_range'))
        if delayed_url and target_row:
            service.spreadsheets().values().update(
                spreadsheetId=env_vars['SPREADSHEET_LOG_ID'],
                range=f'Hoja 1!G{target_row}',
                valueInputOption='USER_ENTERED',
                body={'values': [[delayed_url]]}
            ).execute()
            print(f"INFO: Link de recibo aplicado en Hoja 1!G{target_row}")
        elif receipt_input_path:
            print("WARNING: No se pudo obtener link de Drive dentro del tiempo de espera")

    return result.get('updated_rows', 0)

def write_fijos(service, env_vars, data):
    """
    Columnas: Fecha, Concepto, Gasto, Ingreso, Categoria, Pendiente/Pagado
    """
    row = [
        format_date(data.get('fecha')),
        data.get('concepto', ''),
        format_amount(data.get('gasto', 0)) if data.get('gasto') else '',
        format_amount(data.get('ingreso', 0)) if data.get('ingreso') else '',
        data.get('categoria', ''),
        data.get('estado', 'Pendiente')
    ]
    return append_row(service, env_vars['SPREADSHEET_FIXED_ID'], 'Hoja 1', row)

def write_deudas(service, env_vars, data):
    """
    Columnas: Concepto, Monto adeudado
    """
    row = [
        data.get('concepto', ''),
        format_amount(data.get('monto', 0))
    ]
    return append_row(service, env_vars['SPREADSHEET_AUTOS_ID'], 'Hoja 1', row)

def write_recuerdos(service, env_vars, data):
    """
    Columnas: fecha, texto, url  (sheet: Datos)
    """
    row = [
        format_date(data.get('fecha')),
        data.get('texto', ''),
        data.get('url', '')
    ]
    return append_row(service, env_vars['SPREADSHEET_RECUERDOS_ID'], 'Datos', row)

def write_rsm(service, env_vars, data):
    """
    Columnas: Fecha, Monto, Recibo
    """
    row = [
        format_date(data.get('fecha')),
        format_amount(data.get('monto', 0)),
        data.get('recibo', '')
    ]
    return append_row(service, env_vars['SPREADSHEET_RSM_ID'], 'Hoja 1', row)

def write_pelo(service, env_vars, data):
    """
    Sheet PeloLog en SPREADSHEET_AUTOS_ID
    Columnas: id, member, date, stylist, amount, receiptUrl, frontUrl, sideUrl, backUrl,
              notes, rating, expenseMarker, expenseRowNum, createdAt, updatedAt, formaPago
    """
    now = datetime.now().isoformat()
    ts_id = datetime.now().strftime('%Y%m%d%H%M%S')
    row = [
        f'pelo-{ts_id}',
        data.get('member', 'jay'),
        format_date(data.get('fecha')),
        data.get('stylist', ''),
        format_amount(data.get('amount', data.get('monto', 0))),
        data.get('receipt_url', ''),
        '', '', '',  # frontUrl, sideUrl, backUrl
        data.get('notes', data.get('notas', '')),
        data.get('rating', ''),
        '',  # expenseMarker (lo llena el dashboard)
        '',  # expenseRowNum
        now,
        now,
        data.get('forma_pago', data.get('formaPago', ''))
    ]
    return append_row(service, env_vars['SPREADSHEET_AUTOS_ID'], 'PeloLog', row)

def normalize_receipt_items(data):
    items = data.get('items') or data.get('receipt_items') or []
    if isinstance(items, dict):
        items = [items]
    if not isinstance(items, list):
        raise ValueError('receipt_items debe ser una lista de productos')
    return items

def write_receipt_items(service, env_vars, data):
    """
    Sheet Receipt Items en SPREADSHEET_LOG_ID.
    Columnas: fecha, recibo_id, comercio, producto_raw, producto_normalizado,
              categoria, subcategoria, cantidad, precio_unitario, total_item,
              forma_pago, recibo, confianza
    """
    spreadsheet_id = env_vars['SPREADSHEET_LOG_ID']
    ensure_headers(service, spreadsheet_id, RECEIPT_ITEMS_SHEET, RECEIPT_ITEMS_HEADERS)
    items = normalize_receipt_items(data)
    if not items:
        return 0

    receipt_id = data.get('recibo_id') or data.get('receipt_id') or f"receipt-{datetime.now().strftime('%Y%m%d%H%M%S')}"
    fecha = format_date(data.get('fecha'))
    comercio = data.get('comercio') or data.get('lugar', '')
    forma_pago = normalize_forma_pago(data.get('forma_pago', '')) if data.get('forma_pago') else ''
    recibo_url = resolve_recibo_value(data)
    rows = []
    for item in items:
        if not isinstance(item, dict):
            continue
        total_item = format_amount(item.get('total_item', item.get('total', item.get('monto', 0))))
        if total_item <= 0:
            continue
        rows.append([
            format_date(item.get('fecha') or fecha),
            item.get('recibo_id') or receipt_id,
            item.get('comercio') or comercio,
            item.get('producto_raw') or item.get('producto') or item.get('raw') or '',
            item.get('producto_normalizado') or item.get('normalizado') or item.get('producto') or '',
            item.get('categoria', ''),
            item.get('subcategoria', ''),
            format_amount(item.get('cantidad', 1)),
            format_amount(item.get('precio_unitario', item.get('unitario', 0))),
            total_item,
            item.get('forma_pago') or forma_pago,
            item.get('recibo') or recibo_url,
            item.get('confianza', item.get('confidence', '')),
        ])
    if not rows:
        return 0
    return append_rows(service, spreadsheet_id, RECEIPT_ITEMS_SHEET, rows)

SHEET_WRITERS = {
    'gastos': write_gastos,
    'fijos': write_fijos,
    'deudas': write_deudas,
    'recuerdos': write_recuerdos,
    'rsm': write_rsm,
    'pelo': write_pelo,
    'receipt_items': write_receipt_items,
}

def main():
    parser = argparse.ArgumentParser(description='Escribe datos financieros a Google Sheets')
    parser.add_argument('--sheet', required=True, choices=list(SHEET_WRITERS.keys()),
                        help='Tipo de sheet destino')
    parser.add_argument('--data', required=True, help='JSON con los datos a escribir')
    parser.add_argument('--dry-run', action='store_true', help='Muestra qué escribiría sin hacerlo')

    args = parser.parse_args()

    try:
        data = json.loads(args.data)
    except json.JSONDecodeError as e:
        print(f"ERROR: JSON inválido — {e}")
        sys.exit(1)

    if args.dry_run:
        print(f"[DRY RUN] sheet={args.sheet}")
        print(f"[DRY RUN] data={json.dumps(data, indent=2, ensure_ascii=False)}")
        return

    env_vars = load_credentials()
    service = get_sheets_service(env_vars)

    writer = SHEET_WRITERS[args.sheet]
    try:
        rows_added = writer(service, env_vars, data)
    except ValueError as e:
        print(f"ERROR: {e}")
        sys.exit(1)

    if rows_added:
        print(f"OK: {rows_added} fila(s) agregada(s) a '{args.sheet}'")
    else:
        print(f"WARNING: No se confirmó escritura (pero puede haber funcionado)")

if __name__ == '__main__':
    main()
