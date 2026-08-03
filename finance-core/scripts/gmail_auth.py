#!/usr/bin/env python3
"""Consentimiento único para leer Gmail desde el ingestor de finanzas.

Lo corres UNA vez. Abre el navegador, aceptas, y deja dos cosas:

  1. token_gmail.json   — para probar los parsers localmente contra correo real.
  2. El refresh_token impreso en pantalla, que va como secreto del Worker.

La pantalla de consentimiento del proyecto Jay App ya está en Production, así
que el refresh token no expira a los 7 días. Va a aparecer una advertencia de
"app no verificada": es esperado, la app es de uso interno.

Uso:
    python3 gmail_auth.py [ruta/al/client_secret.json]
"""

import json
import os
import sys

from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

DEFAULT_CLIENT_SECRET = (
    "/Users/jaystudio/Library/CloudStorage/GoogleDrive-jgmansur2@gmail.com/"
    "My Drive/MUSIC KNOBS/client_secret.json"
)

HERE = os.path.dirname(os.path.abspath(__file__))
TOKEN_PATH = os.path.join(HERE, "token_gmail.json")


def main() -> int:
    client_secret = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_CLIENT_SECRET

    if not os.path.exists(client_secret):
        print(f"No encontré el client secret en:\n  {client_secret}\n")
        print("Descarga un OAuth Client de tipo 'Desktop app' del proyecto")
        print("opengravity-telebot-2026 y pásame la ruta como argumento.")
        return 1

    with open(client_secret) as fh:
        data = json.load(fh)
    if "installed" not in data:
        kind = ", ".join(data.keys())
        print(f"Ese client es de tipo '{kind}' y necesito uno 'Desktop app' (installed).")
        print("Crea uno nuevo en GCP → APIs y servicios → Credenciales.")
        return 1

    flow = InstalledAppFlow.from_client_secrets_file(client_secret, SCOPES)
    creds = flow.run_local_server(port=0, prompt="consent", access_type="offline")

    with open(TOKEN_PATH, "w") as fh:
        fh.write(creds.to_json())
    os.chmod(TOKEN_PATH, 0o600)

    # Los secretos se escriben a disco, nunca a stdout: lo que se imprime queda
    # en el historial de la terminal y en los transcripts del asistente.
    secrets_path = os.path.join(HERE, "gmail_secrets.env")
    with open(secrets_path, "w") as fh:
        fh.write(f"GMAIL_CLIENT_ID={creds.client_id}\n")
        fh.write(f"GMAIL_CLIENT_SECRET={creds.client_secret}\n")
        fh.write(f"GMAIL_REFRESH_TOKEN={creds.refresh_token}\n")
    os.chmod(secrets_path, 0o600)

    print(f"\nListo. Token guardado en {TOKEN_PATH}")
    print(f"Secretos del Worker en {secrets_path} (no se imprimen a propósito).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
