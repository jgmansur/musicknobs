#!/usr/bin/env python3
"""
engram_write.py — Escribe observaciones en Engram DB con soporte FTS5.

Python tiene FTS5 nativo en sqlite3. Se usa para escrituras desde el
api-server TypeScript que no puede compilar better-sqlite3.

Uso:
  python3 engram_write.py --op insert --data '{...json...}'
  python3 engram_write.py --op update --id 91 --data '{...json...}'
  python3 engram_write.py --op delete --id 91
"""

import argparse
import json
import sqlite3
import sys
import os
import secrets
from datetime import datetime

ENGRAM_DB = os.environ.get('ENGRAM_DB_PATH', '/Users/jaystudio/.engram/engram.db')

def now_str() -> str:
    return datetime.now().strftime('%Y-%m-%d %H:%M:%S')

def new_sync_id() -> str:
    return secrets.token_hex(8)

def checkpoint(conn: sqlite3.Connection) -> None:
    """Force WAL checkpoint so sql.js (which reads main DB file) sees the changes."""
    conn.execute("PRAGMA wal_checkpoint(PASSIVE)")

def insert_observation(data: dict) -> int:
    conn = sqlite3.connect(ENGRAM_DB)
    try:
        now = now_str()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO observations (
                title, content, topic_key, type, scope, project,
                session_id, sync_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            data.get('title', ''),
            data.get('content', ''),
            data.get('topic_key', ''),
            data.get('type', 'note'),
            data.get('scope', 'project'),
            data.get('project', ''),
            data.get('session_id', 'finance-v2-api'),
            new_sync_id(),
            now,
            now
        ))
        conn.commit()
        last_id = cursor.lastrowid
        checkpoint(conn)
        return last_id
    finally:
        conn.close()

def update_observation(obs_id: int, patch: dict) -> bool:
    conn = sqlite3.connect(ENGRAM_DB)
    try:
        cursor = conn.cursor()
        row = cursor.execute(
            "SELECT content, topic_key FROM observations WHERE id = ? AND deleted_at IS NULL",
            (obs_id,)
        ).fetchone()
        if not row:
            return False

        existing = {}
        try:
            existing = json.loads(row[0])
        except Exception:
            pass

        existing.update(patch)
        cursor.execute(
            "UPDATE observations SET content = ?, updated_at = ? WHERE id = ?",
            (json.dumps(existing, ensure_ascii=False), now_str(), obs_id)
        )
        conn.commit()
        ok = cursor.rowcount > 0
        if ok:
            checkpoint(conn)
        return ok
    finally:
        conn.close()

def delete_observation(obs_id: int, topic_prefix: str = '') -> bool:
    conn = sqlite3.connect(ENGRAM_DB)
    try:
        cursor = conn.cursor()
        row = cursor.execute(
            "SELECT topic_key FROM observations WHERE id = ? AND deleted_at IS NULL",
            (obs_id,)
        ).fetchone()
        if not row:
            return False
        if topic_prefix and not row[0].startswith(topic_prefix):
            return False
        # Soft delete (Engram convention)
        cursor.execute(
            "UPDATE observations SET deleted_at = ? WHERE id = ?",
            (now_str(), obs_id)
        )
        conn.commit()
        ok = cursor.rowcount > 0
        if ok:
            checkpoint(conn)
        return ok
    finally:
        conn.close()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--op', required=True, choices=['insert', 'update', 'delete'])
    parser.add_argument('--data', help='JSON data for insert/update')
    parser.add_argument('--id', type=int, help='Observation ID for update/delete')
    parser.add_argument('--topic-prefix', default='', help='Safety check for delete')
    args = parser.parse_args()

    if args.op == 'insert':
        if not args.data:
            print(json.dumps({'error': '--data required for insert'}))
            sys.exit(1)
        data = json.loads(args.data)
        obs_id = insert_observation(data)
        print(json.dumps({'ok': True, 'id': obs_id}))

    elif args.op == 'update':
        if not args.id or not args.data:
            print(json.dumps({'error': '--id and --data required for update'}))
            sys.exit(1)
        patch = json.loads(args.data)
        ok = update_observation(args.id, patch)
        print(json.dumps({'ok': ok}))

    elif args.op == 'delete':
        if not args.id:
            print(json.dumps({'error': '--id required for delete'}))
            sys.exit(1)
        ok = delete_observation(args.id, args.topic_prefix)
        print(json.dumps({'ok': ok}))

if __name__ == '__main__':
    main()
