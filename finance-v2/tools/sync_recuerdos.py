#!/usr/bin/env python3
"""
sync_recuerdos.py — Sincroniza Bitácora Recuerdos (Google Sheets) → Engram SQLite.

Sheets es la fuente de verdad. Engram se actualiza para reflejar su estado actual:
- Recuerdos en Sheets que no están en Engram → se agregan
- Recuerdos en Engram que ya no están en Sheets → se marcan como deleted

Uso:
  python3 sync_recuerdos.py           # sincroniza
  python3 sync_recuerdos.py --dry-run # muestra qué haría sin hacer nada
  python3 sync_recuerdos.py --status  # muestra estado actual sin cambios
"""

import json
import base64
import sqlite3
import hashlib
import argparse
import os
from datetime import datetime


SPREADSHEET_ID = '1b5PyMcfBQX75BODYRn075Meu-aOMW1lxr81USGE6zJA'
SHEET_NAME     = 'Datos'
ENGRAM_DB      = '/Users/jaystudio/.engram/engram.db'
ENV_PATH       = '/Users/jaystudio/Documents/GitHub/Apps/musicknobs/finance-mcp-server/.env'
TOPIC_PREFIX   = 'finance/recuerdo/'


def load_env():
    env_vars = {}
    with open(ENV_PATH) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, _, v = line.partition('=')
            env_vars[k.strip()] = v.strip().strip('"').strip("'")
    return env_vars


def get_sheets_service(env_vars):
    from google.oauth2.service_account import Credentials
    from googleapiclient.discovery import build
    sa_json = json.loads(base64.b64decode(env_vars['GOOGLE_SERVICE_ACCOUNT_JSON_BASE64']).decode())
    creds = Credentials.from_service_account_info(
        sa_json, scopes=['https://www.googleapis.com/auth/spreadsheets.readonly'])
    return build('sheets', 'v4', credentials=creds)


def normalize_fecha(raw):
    """Convierte distintos formatos de fecha a YYYY-MM-DD."""
    if not raw:
        return datetime.now().strftime('%Y-%m-%d')
    raw = str(raw).strip()
    # Si es número (serial de Sheets)
    try:
        serial = float(raw)
        if serial > 10000:
            from datetime import timedelta
            d = datetime(1899, 12, 30) + timedelta(days=serial)
            return d.strftime('%Y-%m-%d')
    except ValueError:
        pass
    # Formatos comunes
    for fmt in ('%d/%m/%Y %H:%M:%S', '%Y-%m-%dT%H:%M:%S', '%Y-%m-%d', '%d/%m/%Y', '%m/%d/%Y'):
        try:
            return datetime.strptime(raw, fmt).strftime('%Y-%m-%d')
        except ValueError:
            continue
    return raw[:10] if len(raw) >= 10 else raw


def row_hash(fecha_iso, texto):
    """Hash único por contenido para detectar duplicados."""
    key = f"{fecha_iso}|{(texto or '').strip()}"
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def read_sheets(service):
    result = service.spreadsheets().values().get(
        spreadsheetId=SPREADSHEET_ID,
        range=f'{SHEET_NAME}!A2:C'
    ).execute()
    rows = result.get('values', [])
    records = []
    for i, row in enumerate(rows):
        fecha_raw = row[0] if len(row) > 0 else ''
        texto     = row[1] if len(row) > 1 else ''
        url       = row[2] if len(row) > 2 else ''
        if url.lower() == 'sin imagen':
            url = ''
        fecha_iso = normalize_fecha(fecha_raw)
        h = row_hash(fecha_iso, texto)
        records.append({
            'sheet_row': i + 2,
            'fecha_iso': fecha_iso,
            'texto': texto,
            'url': url,
            'hash': h,
        })
    return records


def read_engram(conn):
    c = conn.cursor()
    c.execute("""
        SELECT id, topic_key, title, content, normalized_hash, deleted_at
        FROM observations
        WHERE topic_key LIKE ? AND type = 'recuerdo'
    """, (TOPIC_PREFIX + '%',))
    rows = c.fetchall()
    result = {}
    for row in rows:
        eid, topic_key, title, content, nhash, deleted_at = row
        result[nhash] = {
            'id': eid,
            'topic_key': topic_key,
            'title': title,
            'content': content,
            'deleted_at': deleted_at,
        }
    return result


def insert_recuerdo(conn, record, dry_run=False):
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    topic_key = f"{TOPIC_PREFIX}{record['fecha_iso']}/{record['hash']}"
    title = record['texto'][:80] + ('…' if len(record['texto']) > 80 else '')
    content_obj = {
        'fecha': record['fecha_iso'],
        'texto': record['texto'],
        'url': record['url'],
        'fuente': 'sync_recuerdos',
    }
    content = json.dumps(content_obj, ensure_ascii=False)
    sync_id = os.urandom(8).hex()

    if dry_run:
        print(f"  [ADD] {record['fecha_iso']} — {title}")
        return

    c = conn.cursor()
    c.execute("""
        INSERT INTO observations
          (title, content, topic_key, type, scope, project, session_id, sync_id, normalized_hash, created_at, updated_at)
        VALUES (?, ?, ?, 'recuerdo', 'project', 'jaystudio', 'sync-recuerdos', ?, ?, ?, ?)
    """, (title, content, topic_key, sync_id, record['hash'], now, now))
    conn.commit()


def restore_recuerdo(conn, engram_entry, dry_run=False):
    """Restaura un recuerdo marcado como deleted que volvió a aparecer en Sheets."""
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    if dry_run:
        print(f"  [RESTORE] {engram_entry['title'][:60]}")
        return
    c = conn.cursor()
    c.execute("UPDATE observations SET deleted_at = NULL, updated_at = ? WHERE id = ?",
              (now, engram_entry['id']))
    conn.commit()


def soft_delete_recuerdo(conn, engram_entry, dry_run=False):
    """Marca como deleted un recuerdo que ya no está en Sheets."""
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    if dry_run:
        print(f"  [DELETE] {engram_entry['title'][:60]}")
        return
    c = conn.cursor()
    c.execute("UPDATE observations SET deleted_at = ?, updated_at = ? WHERE id = ?",
              (now, now, engram_entry['id']))
    conn.commit()


def main():
    parser = argparse.ArgumentParser(description='Sync Bitácora Recuerdos → Engram')
    parser.add_argument('--dry-run', action='store_true', help='Mostrar cambios sin aplicarlos')
    parser.add_argument('--status', action='store_true', help='Solo mostrar estado actual')
    args = parser.parse_args()

    print('Conectando a Google Sheets...')
    env_vars = load_env()
    service = get_sheets_service(env_vars)
    sheet_records = read_sheets(service)
    print(f'  Sheets: {len(sheet_records)} recuerdos')

    conn = sqlite3.connect(ENGRAM_DB)
    engram_map = read_engram(conn)
    active_engram = {h: e for h, e in engram_map.items() if not e['deleted_at']}
    deleted_engram = {h: e for h, e in engram_map.items() if e['deleted_at']}
    print(f'  Engram: {len(active_engram)} activos, {len(deleted_engram)} eliminados')

    sheet_hashes = {r['hash'] for r in sheet_records}

    # Calcular diff
    to_add     = [r for r in sheet_records if r['hash'] not in engram_map]
    to_restore = [r for r in sheet_records if r['hash'] in deleted_engram]
    to_delete  = [e for h, e in active_engram.items() if h not in sheet_hashes]

    print(f'\nDiff:')
    print(f'  Por agregar:   {len(to_add)}')
    print(f'  Por restaurar: {len(to_restore)}')
    print(f'  Por eliminar:  {len(to_delete)}')

    if args.status:
        conn.close()
        return

    if not to_add and not to_restore and not to_delete:
        print('\n✅ Todo sincronizado. Sin cambios.')
        conn.close()
        return

    if args.dry_run:
        print('\n[DRY RUN] Cambios que se aplicarían:')

    if to_add:
        print(f'\nAgregando {len(to_add)} recuerdos...')
        for r in to_add:
            insert_recuerdo(conn, r, dry_run=args.dry_run)

    if to_restore:
        print(f'\nRestaurando {len(to_restore)} recuerdos...')
        for r in to_restore:
            restore_recuerdo(conn, deleted_engram[r['hash']], dry_run=args.dry_run)

    if to_delete:
        print(f'\nEliminando {len(to_delete)} recuerdos de Engram (ya no están en Sheets)...')
        for e in to_delete:
            soft_delete_recuerdo(conn, e, dry_run=args.dry_run)

    conn.close()

    if args.dry_run:
        print('\n[DRY RUN completado — sin cambios reales]')
    else:
        print(f'\n✅ Sincronización completa.')
        print(f'   +{len(to_add)} agregados  ~{len(to_restore)} restaurados  -{len(to_delete)} eliminados')


if __name__ == '__main__':
    main()
