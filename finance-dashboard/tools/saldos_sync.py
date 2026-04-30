#!/usr/bin/env python3
"""
saldos_sync.py — Sync Queue Processor

Lee filas pendientes del tab sync_queue en SALDOS_SHEET_ID,
guarda cada cambio en Engram (SQLite local) y marca como procesado.

Ejecutado cada 2 min por LaunchAgent: com.jaymansur.saldos.sync
"""

import json
import base64
import sqlite3
import sys
from datetime import datetime

SALDOS_SHEET_ID = '1-cX_qxld3ioSpcO9lEBPg90Db6AyK7SczpJTvj7rw4U'
ENGRAM_DB       = '/Users/jaystudio/.engram/engram.db'
ENV_PATH        = '/Users/jaystudio/Documents/GitHub/Apps/musicknobs/finance-mcp-server/.env'


def load_env():
    env = {}
    with open(ENV_PATH) as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, _, v = line.partition('=')
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def get_sheets_service(env):
    from google.oauth2.service_account import Credentials
    from googleapiclient.discovery import build
    sa = json.loads(base64.b64decode(env['GOOGLE_SERVICE_ACCOUNT_JSON_BASE64']).decode())
    creds = Credentials.from_service_account_info(
        sa, scopes=['https://www.googleapis.com/auth/spreadsheets'])
    return build('sheets', 'v4', credentials=creds)


def read_pending(service):
    result = service.spreadsheets().values().get(
        spreadsheetId=SALDOS_SHEET_ID,
        range='sync_queue!A2:E'
    ).execute()
    rows = result.get('values', [])
    pending = []
    for i, row in enumerate(rows):
        status = row[3] if len(row) > 3 else ''
        if status.lower() != 'processed':
            pending.append((i + 2, row))  # +2 because row 1 is header
    return pending


def mark_processed(service, row_num):
    service.spreadsheets().values().update(
        spreadsheetId=SALDOS_SHEET_ID,
        range=f'sync_queue!D{row_num}',
        valueInputOption='USER_ENTERED',
        body={'values': [['processed']]}
    ).execute()


def save_to_engram(payload: dict):
    now = datetime.utcnow().isoformat()
    account_id = payload.get('id', '')
    name = payload.get('name', 'Cuenta')
    balance = payload.get('balance', 0)
    title = f"Saldo actualizado: {name} — {balance}"
    content = json.dumps(payload, ensure_ascii=False, indent=2)
    topic_key = f"finance/saldo/{account_id}"

    with sqlite3.connect(ENGRAM_DB) as conn:
        # Update existing or insert new
        existing = conn.execute(
            "SELECT id FROM observations WHERE topic_key = ?", (topic_key,)
        ).fetchone()

        if existing:
            conn.execute(
                "UPDATE observations SET title=?, content=?, updated_at=? WHERE topic_key=?",
                (title, content, now, topic_key)
            )
        else:
            import os
            sync_id = base64.b16encode(os.urandom(8)).decode().lower()
            conn.execute(
                "INSERT INTO observations (title, content, topic_key, session_id, sync_id, created_at, updated_at, type) "
                "VALUES (?, ?, ?, 'saldos-sync', ?, ?, ?, 'manual')",
                (title, content, topic_key, sync_id, now, now)
            )
        conn.commit()
    print(f"  Engram updated: {topic_key} — {name}: {balance}")


def main():
    try:
        env = load_env()
        service = get_sheets_service(env)
    except Exception as e:
        print(f"ERROR init: {e}", file=sys.stderr)
        sys.exit(1)

    pending = read_pending(service)
    if not pending:
        print("No pending items.")
        return

    print(f"Processing {len(pending)} pending items...")
    for row_num, row in pending:
        try:
            action  = row[1] if len(row) > 1 else ''
            payload_str = row[2] if len(row) > 2 else '{}'
            payload = json.loads(payload_str)

            if action == 'update_account':
                save_to_engram(payload)
            else:
                print(f"  Unknown action: {action}")

            mark_processed(service, row_num)
        except Exception as e:
            print(f"  ERROR row {row_num}: {e}", file=sys.stderr)

    print("Done.")


if __name__ == '__main__':
    main()
