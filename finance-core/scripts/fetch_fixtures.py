#!/usr/bin/env python3
"""Baja correos bancarios reales y los guarda como fixtures para validar parsers.

Los fixtures traen movimientos reales de Jay, así que la carpeta está en el
.gitignore. Sirven para medir qué tan bien parsea cada plantilla antes de
poner el ingestor a correr en automático.

Uso:
    python3 fetch_fixtures.py [--days 90]
"""

from __future__ import annotations

import argparse
import base64
import json
import os

from google.oauth2.credentials import Credentials
from googleapiclient.discovery import build

HERE = os.path.dirname(os.path.abspath(__file__))
TOKEN = os.path.join(HERE, "token_gmail.json")
OUT = os.path.join(os.path.dirname(HERE), "fixtures")

SENDERS = [
    "santander@envio.santander.com.mx",
    "clientes@bbva.mx",
]


def body_html(payload: dict) -> str:
    """Extrae el HTML (o texto) de un payload de Gmail, recorriendo las partes."""
    if payload.get("body", {}).get("data"):
        raw = base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", "replace")
        if payload.get("mimeType") in ("text/html", "text/plain"):
            return raw
    best = ""
    for part in payload.get("parts", []) or []:
        got = body_html(part)
        if part.get("mimeType") == "text/html" and got:
            return got
        best = best or got
    return best


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=90)
    args = ap.parse_args()

    creds = Credentials.from_authorized_user_file(TOKEN)
    svc = build("gmail", "v1", credentials=creds)

    query = "(" + " OR ".join(f"from:{s}" for s in SENDERS) + f") newer_than:{args.days}d"
    os.makedirs(OUT, exist_ok=True)

    saved, token = 0, None
    while True:
        res = (
            svc.users()
            .messages()
            .list(userId="me", q=query, pageToken=token, maxResults=100)
            .execute()
        )
        for meta in res.get("messages", []):
            msg = (
                svc.users()
                .messages()
                .get(userId="me", id=meta["id"], format="full")
                .execute()
            )
            headers = {
                h["name"].lower(): h["value"] for h in msg["payload"].get("headers", [])
            }
            sender = headers.get("from", "")
            email = sender.split("<")[-1].strip("> ").lower()

            record = {
                "id": msg["id"],
                "threadId": msg.get("threadId"),
                "from": email,
                "subject": headers.get("subject", ""),
                "internalDate": msg.get("internalDate"),
                "html": body_html(msg["payload"]),
            }
            with open(os.path.join(OUT, f"{msg['id']}.json"), "w") as fh:
                json.dump(record, fh, ensure_ascii=False)
            saved += 1

        token = res.get("nextPageToken")
        if not token:
            break

    print(f"{saved} correos guardados en {OUT}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
