#!/usr/bin/env python3
"""
update_escolaridad.py — Actualiza escolaridad.json con los archivos actuales de Drive.

Uso:
  python3 update_escolaridad.py              # actualiza lista de docs
  python3 update_escolaridad.py --list       # muestra archivos sin modificar JSON

Los análisis (materias, calificaciones, advertencias) se preservan.
Para actualizar el análisis: editar escolaridad.json manualmente
o pedir a Claude que lo haga tras revisar los PDFs.
"""
import json, base64, argparse, sys
from pathlib import Path
from datetime import datetime
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

ENV_PATH  = Path('/Users/jaystudio/Documents/GitHub/Apps/musicknobs/finance-mcp-server/.env')
JSON_PATH = Path('/Users/jaystudio/Documents/GitHub/Apps/musicknobs/finance-dashboard/public/escolaridad.json')
DRIVE_FILE   = 'https://drive.google.com/file/d/{}/view'
DRIVE_FOLDER = 'https://drive.google.com/drive/folders/{}'

CHILDREN = {
    'roby': {
        'nombre': 'Roberta',
        'grado':  '3° de Primaria',
        'escuela': 'Vasconcelos',
        'folderId': '1aCicbFzXUY566WCaqaArTUH9lcBhr5fr',
    },
    'hans': {
        'nombre': 'Hans',
        'grado':  '3° de Primaria',
        'escuela': 'Vasconcelos',
        'folderId': '1PG71hyEE3dhDGO7Pn02RR-S-LdvKqHDQ',
    },
}

def load_env():
    env = {}
    with open(ENV_PATH) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                k, _, v = line.partition('=')
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env

def get_drive_service():
    env = load_env()
    sa_json = json.loads(base64.b64decode(env['GOOGLE_SERVICE_ACCOUNT_JSON_BASE64']).decode())
    creds = Credentials.from_service_account_info(
        sa_json, scopes=['https://www.googleapis.com/auth/drive.readonly'])
    return build('drive', 'v3', credentials=creds)

def list_recursive(service, folder_id):
    results = service.files().list(
        q=f"'{folder_id}' in parents and trashed=false",
        fields="files(id,name,mimeType,modifiedTime)",
        orderBy="name",
        pageSize=100
    ).execute()
    items = []
    for f in results.get('files', []):
        if f['mimeType'] == 'application/vnd.google-apps.folder':
            items.append({
                'type': 'folder',
                'name': f['name'],
                'id':   f['id'],
                'url':  DRIVE_FOLDER.format(f['id']),
                'children': list_recursive(service, f['id']),
            })
        else:
            items.append({
                'type':     'file',
                'name':     f['name'],
                'id':       f['id'],
                'url':      DRIVE_FILE.format(f['id']),
                'modified': f.get('modifiedTime', '')[:10],
            })
    return items

def count_files(docs):
    total = 0
    for d in docs:
        if d['type'] == 'file':
            total += 1
        elif d.get('children'):
            total += count_files(d['children'])
    return total

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--list', action='store_true', help='Solo listar, no guardar')
    args = parser.parse_args()

    print('Conectando a Google Drive...')
    service = get_drive_service()

    # Cargar JSON existente para preservar análisis
    existing = {}
    if JSON_PATH.exists():
        with open(JSON_PATH) as f:
            existing = json.load(f)

    data = {'updated': datetime.now().strftime('%Y-%m-%d')}

    for key, meta in CHILDREN.items():
        folder_id = meta['folderId']
        print(f'\nListando {meta["nombre"]} ({folder_id})...')
        docs = list_recursive(service, folder_id)
        count = count_files(docs)
        print(f'  → {count} archivo(s) encontrado(s)')

        # Preservar análisis anterior si existe
        prev_analysis = existing.get(key, {}).get('analysis', None)

        data[key] = {
            'nombre':    meta['nombre'],
            'grado':     meta['grado'],
            'escuela':   meta['escuela'],
            'folderId':  folder_id,
            'folderUrl': DRIVE_FOLDER.format(folder_id),
            'documentos': docs,
            'analysis':  prev_analysis,
        }

    if args.list:
        print('\n=== JSON que se generaría ===')
        print(json.dumps(data, indent=2, ensure_ascii=False))
        return

    with open(JSON_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f'\n✅ Guardado en {JSON_PATH}')
    print('Recuerda hacer build + deploy del dashboard para que los cambios sean visibles.')

if __name__ == '__main__':
    main()
