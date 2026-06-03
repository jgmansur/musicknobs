#!/usr/bin/env python3
"""
gmail_receipts.py — Busca recibos recientes en Gmail y genera comandos para finance_write.py.

Uso:
  python3 gmail_receipts.py [--days N] [--dry-run]

  --days N     Buscar recibos de los últimos N días (default: 7)
  --dry-run    Solo mostrar los comandos, no ejecutar finance_write.py

Senders soportados:
  - Santander (santander@envio.santander.com.mx)
  - Apple     (no_reply@email.apple.com)
  - Mercado Libre (no-reply@mercadolibre.com.mx) — solo confirmaciones de compra

Requiere: pip3 install google-auth google-auth-oauthlib google-auth-httplib2 google-api-python-client
"""

import argparse
import json
import os
import re
import subprocess
import sys
from base64 import urlsafe_b64decode
from datetime import datetime, timedelta

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
FINANCE_WRITE = os.path.join(SCRIPT_DIR, 'finance_write.py')

# Gmail OAuth scopes
SCOPES = ['https://www.googleapis.com/auth/gmail.readonly']
TOKEN_FILE = os.path.expanduser('~/.gmail_receipts_token.json')
CREDENTIALS_FILE = os.path.expanduser('~/.gmail_credentials.json')


# ── Parsers por remitente ──────────────────────────────────────────────────────

def parse_santander(body: str, date: datetime) -> dict | None:
    """Extrae datos de notificaciones de compra/pago de Santander."""
    # Comercio
    m = re.search(r'comercio\s+([A-Z0-9*\s]+?)(?:\s*<br|\s*\n|con tu tarjeta)', body, re.IGNORECASE)
    if not m:
        return None
    comercio = m.group(1).strip()

    # Monto
    m2 = re.search(r'monto de\s*\$([0-9,]+\.?\d*)\s*MXN', body, re.IGNORECASE)
    if not m2:
        return None
    monto = float(m2.group(1).replace(',', ''))

    # Hora exacta de la transacción (para topic key de Engram)
    m3 = re.search(r'las\s+(\d{1,2}:\d{2}:\d{2})', body)
    hora = m3.group(1).replace(':', '') if m3 else date.strftime('%H%M%S')

    return {
        'fecha': date.strftime('%Y-%m-%d'),
        'hora': hora,
        'monto': monto,
        'moneda': 'MXN',
        'concepto': comercio,
        'lugar': comercio,
        'forma_pago': 'Santander',
        'tipo': 'Gasto',
    }


def parse_apple(body: str, date: datetime) -> dict | None:
    """Extrae datos de facturas de Apple (App Store, suscripciones)."""
    # Producto
    product_m = re.search(
        r'<p class="custom-gzadzy">\s*([^<]+)</p>.*?<p class="custom-wogfc8">\s*([^<\n]+)',
        body, re.DOTALL
    )
    if not product_m:
        # Fallback: buscar patrones más simples
        product_m = re.search(r'"custom-gzadzy"[^>]*>([^<]+)<', body)
        product_name = product_m.group(1).strip() if product_m else 'Apple'
        subtitle_m = re.search(r'"custom-wogfc8"[^>]*>([^<]+)<', body)
        subtitle = subtitle_m.group(1).strip() if subtitle_m else ''
    else:
        product_name = product_m.group(1).strip()
        subtitle = product_m.group(2).strip()

    concepto = f"{product_name} — {subtitle}".rstrip(' —')

    # Monto total
    m2 = re.search(r'"custom-137u684"[^>]*>\$([0-9,]+\.?\d*)', body)
    if not m2:
        return None
    monto = float(m2.group(1).replace(',', ''))

    # Forma de pago (tarjeta)
    card_m = re.search(r'(Visa|Mastercard|Amex)[^•]*•+\s*(\d{4})', body, re.IGNORECASE)
    forma_pago = f"{card_m.group(1)} ••••{card_m.group(2)}" if card_m else ''

    return {
        'fecha': date.strftime('%Y-%m-%d'),
        'hora': date.strftime('%H%M%S'),
        'monto': monto,
        'moneda': 'MXN',
        'concepto': concepto,
        'lugar': 'Apple',
        'forma_pago': forma_pago,
        'tipo': 'Gasto',
    }


def parse_mercadolibre(body: str, subject: str, date: datetime) -> dict | None:
    """Extrae datos de confirmaciones de compra de Mercado Libre."""
    # Solo procesar correos de compra (no de envío)
    if 'compraste' not in subject.lower() and 'tu compra' not in subject.lower():
        return None

    # Producto desde el asunto
    concepto = re.sub(r'^compraste\s+\d+\s+unidades?\s+de\s+', '', subject, flags=re.IGNORECASE).strip()

    # Monto: ML envía monto en correo solo si hay desglose
    m = re.search(r'\$\s*([0-9,]+\.?\d*)', body)
    monto = float(m.group(1).replace(',', '')) if m else 0.0

    if not monto:
        return None  # Sin monto no podemos registrar

    return {
        'fecha': date.strftime('%Y-%m-%d'),
        'hora': date.strftime('%H%M%S'),
        'monto': monto,
        'moneda': 'MXN',
        'concepto': concepto,
        'lugar': 'Mercado Libre',
        'forma_pago': '',
        'tipo': 'Gasto',
    }


# ── Gmail API ─────────────────────────────────────────────────────────────────

def get_gmail_service():
    try:
        from google.oauth2.credentials import Credentials
        from google_auth_oauthlib.flow import InstalledAppFlow
        from google.auth.transport.requests import Request
        from googleapiclient.discovery import build
    except ImportError:
        print("ERROR: Instalar dependencias:")
        print("  pip3 install google-auth google-auth-oauthlib google-api-python-client")
        sys.exit(1)

    creds = None
    if os.path.exists(TOKEN_FILE):
        creds = Credentials.from_authorized_user_file(TOKEN_FILE, SCOPES)

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            from google.auth.transport.requests import Request
            creds.refresh(Request())
        else:
            if not os.path.exists(CREDENTIALS_FILE):
                print(f"ERROR: Credenciales OAuth no encontradas en {CREDENTIALS_FILE}")
                print("Descarga oauth2 credentials desde Google Cloud Console y guárdalas ahí.")
                sys.exit(1)
            flow = InstalledAppFlow.from_client_secrets_file(CREDENTIALS_FILE, SCOPES)
            creds = flow.run_local_server(port=0)
        with open(TOKEN_FILE, 'w') as f:
            f.write(creds.to_json())

    return build('gmail', 'v1', credentials=creds)


def get_message_body(msg: dict) -> str:
    """Extrae el cuerpo HTML o texto plano de un mensaje de Gmail."""
    payload = msg.get('payload', {})

    def extract_from_part(part):
        mime = part.get('mimeType', '')
        if mime in ('text/html', 'text/plain'):
            data = part.get('body', {}).get('data', '')
            if data:
                return urlsafe_b64decode(data + '==').decode('utf-8', errors='replace')
        for subpart in part.get('parts', []):
            result = extract_from_part(subpart)
            if result:
                return result
        return ''

    return extract_from_part(payload)


def search_receipts(service, days: int) -> list[dict]:
    """Busca recibos en Gmail de los últimos `days` días."""
    after = (datetime.now() - timedelta(days=days)).strftime('%Y/%m/%d')
    senders = [
        'from:santander@envio.santander.com.mx',
        'from:no_reply@email.apple.com',
        'from:no-reply@mercadolibre.com.mx',
    ]
    query = f"({' OR '.join(senders)}) after:{after}"

    results = service.users().messages().list(userId='me', q=query, maxResults=50).execute()
    messages = results.get('messages', [])

    receipts = []
    for msg_ref in messages:
        msg = service.users().messages().get(
            userId='me', msgId=msg_ref['id'], format='full'
        ).execute()

        headers = {h['name']: h['value'] for h in msg['payload'].get('headers', [])}
        sender = headers.get('From', '')
        subject = headers.get('Subject', '')
        date_str = headers.get('Date', '')
        try:
            from email.utils import parsedate_to_datetime
            date = parsedate_to_datetime(date_str)
        except Exception:
            date = datetime.now()

        body = get_message_body(msg)

        if 'santander' in sender.lower():
            if 'Pago/Compra' in subject or 'compra' in subject.lower():
                parsed = parse_santander(body, date)
        elif 'apple.com' in sender.lower():
            parsed = parse_apple(body, date)
        elif 'mercadolibre' in sender.lower():
            parsed = parse_mercadolibre(body, subject, date)
        else:
            parsed = None

        if parsed:
            receipts.append(parsed)

    return receipts


# ── Output ────────────────────────────────────────────────────────────────────

def make_finance_write_cmd(receipt: dict) -> str:
    """Genera el comando finance_write.py para un recibo."""
    data = {k: v for k, v in receipt.items() if k != 'hora'}
    return (
        f"python3 {FINANCE_WRITE} "
        f"--sheet gastos "
        f"--data '{json.dumps(data, ensure_ascii=False)}'"
    )


def run_finance_write(receipt: dict) -> bool:
    """Ejecuta finance_write.py para registrar el recibo."""
    data = {k: v for k, v in receipt.items() if k != 'hora'}
    cmd = [
        sys.executable, FINANCE_WRITE,
        '--sheet', 'gastos',
        '--data', json.dumps(data, ensure_ascii=False),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode == 0:
        return True
    print(f"  ERROR: {result.stderr.strip()}", file=sys.stderr)
    return False


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--days', type=int, default=7, help='Días a buscar hacia atrás (default: 7)')
    parser.add_argument('--dry-run', action='store_true', help='Solo mostrar comandos, no ejecutar')
    args = parser.parse_args()

    print(f"Buscando recibos de los últimos {args.days} días...\n")

    service = get_gmail_service()
    receipts = search_receipts(service, args.days)

    if not receipts:
        print("No se encontraron recibos nuevos.")
        return

    print(f"Encontrados {len(receipts)} recibo(s):\n")
    ok = 0
    for r in receipts:
        tag = "[DRY-RUN]" if args.dry_run else "[REGISTRANDO]"
        print(f"{tag} {r['fecha']}  {r['lugar']:<35} ${r['monto']:>8.2f} {r['moneda']}")
        print(f"   Concepto: {r['concepto']}")
        print(f"   Forma de pago: {r['forma_pago'] or '—'}")
        if args.dry_run:
            print(f"   CMD: {make_finance_write_cmd(r)}")
        else:
            success = run_finance_write(r)
            if success:
                print("   ✓ Guardado en Google Sheets")
                ok += 1
            else:
                print("   ✗ Error al guardar")
        print()

    if not args.dry_run:
        print(f"Resultado: {ok}/{len(receipts)} recibos registrados.")


if __name__ == '__main__':
    main()
