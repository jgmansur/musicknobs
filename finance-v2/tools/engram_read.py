#!/usr/bin/env python3
"""
engram_read.py — Lee observaciones de Engram DB con topic_keys del dominio finance/*.

Python tiene soporte WAL nativo — siempre ve los datos más recientes,
incluyendo los escritos por otros procesos (Engram daemon, etc.).

Uso:
  python3 engram_read.py --query gastos [--month 2026-04]
  python3 engram_read.py --query ingresos [--month 2026-04]
  python3 engram_read.py --query fijos
  python3 engram_read.py --query deudas
  python3 engram_read.py --query topic --id 91
"""

import argparse
import json
import sqlite3
import sys
import os

ENGRAM_DB = os.environ.get('ENGRAM_DB_PATH', '/Users/jaystudio/.engram/engram.db')

def conn():
    c = sqlite3.connect(ENGRAM_DB)
    c.row_factory = sqlite3.Row
    return c

def safe_parse_json(content: str) -> dict:
    if not content:
        return {}
    try:
        parsed = json.loads(content)
        if isinstance(parsed, dict):
            return parsed
    except Exception:
        pass
    return {}

def parse_gasto_row(row) -> dict:
    data = safe_parse_json(row['content'])
    created_at = row['created_at'] or ''
    return {
        'id': row['id'],
        'topic_key': row['topic_key'] or '',
        'created_at': created_at,
        'fecha': data.get('fecha', created_at[:10]),
        'monto': float(data.get('monto', 0) or 0),
        'moneda': data.get('moneda', 'MXN'),
        'concepto': data.get('concepto', row['title'] or ''),
        'lugar': data.get('lugar', ''),
        'forma_pago': data.get('forma_pago', ''),
        'tipo': data.get('tipo', 'Gasto'),
        'recibo': data.get('recibo', ''),
        'fuente': data.get('fuente', ''),
    }

def query_gastos(month=None):
    c = conn()
    prefix = f'finance/gasto/{month}' if month else 'finance/gasto/'
    rows = c.execute(
        """SELECT id, title, content, topic_key, created_at
           FROM observations
           WHERE topic_key LIKE ? AND deleted_at IS NULL
           ORDER BY created_at DESC""",
        (f'{prefix}%',)
    ).fetchall()
    c.close()
    return [parse_gasto_row(r) for r in rows]

def query_ingresos(month=None):
    c = conn()
    prefix = f'finance/ingreso/{month}' if month else 'finance/ingreso/'
    rows = c.execute(
        """SELECT id, title, content, topic_key, created_at
           FROM observations
           WHERE topic_key LIKE ? AND deleted_at IS NULL
           ORDER BY created_at DESC""",
        (f'{prefix}%',)
    ).fetchall()
    c.close()
    return [parse_gasto_row(r) for r in rows]

def query_fijos():
    c = conn()
    rows = c.execute(
        """SELECT id, title, content, topic_key, created_at
           FROM observations
           WHERE topic_key LIKE 'finance/fijo/%' AND deleted_at IS NULL
           ORDER BY topic_key ASC"""
    ).fetchall()
    c.close()
    result = []
    for r in rows:
        data = safe_parse_json(r['content'])
        result.append({
            'id': r['id'],
            'topic_key': r['topic_key'],
            'created_at': r['created_at'],
            'fecha': data.get('fecha', ''),
            'concepto': data.get('concepto', r['title'] or ''),
            'gasto': float(data['gasto']) if data.get('gasto') is not None else None,
            'ingreso': float(data['ingreso']) if data.get('ingreso') is not None else None,
            'categoria': data.get('categoria', ''),
            'estado': data.get('estado', ''),
        })
    return result

def query_deudas():
    c = conn()
    rows = c.execute(
        """SELECT id, title, content, topic_key, created_at
           FROM observations
           WHERE topic_key LIKE 'finance/deuda/%' AND deleted_at IS NULL
           ORDER BY created_at DESC"""
    ).fetchall()
    c.close()
    result = []
    for r in rows:
        data = safe_parse_json(r['content'])
        result.append({
            'id': r['id'],
            'topic_key': r['topic_key'],
            'created_at': r['created_at'],
            'concepto': data.get('concepto', r['title'] or ''),
            'monto': float(data.get('monto', 0) or 0),
        })
    return result

def query_topic(obs_id):
    c = conn()
    row = c.execute(
        "SELECT id, topic_key FROM observations WHERE id = ? AND deleted_at IS NULL",
        (obs_id,)
    ).fetchone()
    c.close()
    if not row:
        return []
    return [{'id': row['id'], 'topic_key': row['topic_key']}]

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--query', required=True, choices=['gastos', 'ingresos', 'fijos', 'deudas', 'topic'])
    parser.add_argument('--month', help='YYYY-MM format')
    parser.add_argument('--id', type=int, help='Observation ID for topic query')
    args = parser.parse_args()

    if args.query == 'gastos':
        print(json.dumps(query_gastos(args.month), ensure_ascii=False))
    elif args.query == 'ingresos':
        print(json.dumps(query_ingresos(args.month), ensure_ascii=False))
    elif args.query == 'fijos':
        print(json.dumps(query_fijos(), ensure_ascii=False))
    elif args.query == 'deudas':
        print(json.dumps(query_deudas(), ensure_ascii=False))
    elif args.query == 'topic':
        if not args.id:
            print(json.dumps({'error': '--id required for topic query'}))
            sys.exit(1)
        print(json.dumps(query_topic(args.id), ensure_ascii=False))

if __name__ == '__main__':
    main()
