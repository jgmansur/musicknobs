#!/usr/bin/env python3
"""Migra los catálogos de Google Sheets → Supabase: autos, estudio y recetas.

Qué se mueve y qué no
---------------------
Se mueven los DATOS. Los archivos (fotos, facturas, pólizas, recetas
escaneadas) se quedan en Google Drive: estas tablas solo guardan la URL.

Las hojas NO se borran ni se tocan. Después de correr esto los datos viven en
los dos lados, que es justo lo que permite verificar antes de cambiar la app.

Es idempotente: usa `legacy_key` (el id de texto que la fila tenía en la hoja)
con ON CONFLICT DO UPDATE, así que se puede correr las veces que haga falta.

Uso:
    python3 migrate_catalogos.py --dry-run    # revisa antes de escribir
    python3 migrate_catalogos.py --apply
"""

from __future__ import annotations

import argparse
import base64
import json
import sys
from datetime import datetime

import psycopg
from google.oauth2.service_account import Credentials
from googleapiclient.discovery import build

ENV_FINANCE = '/Users/jaystudio/Documents/GitHub/Apps/musicknobs/finance-core/.env'
ENV_SHEETS = '/Users/jaystudio/Documents/GitHub/Apps/musicknobs/finance-mcp-server/.env'

# Autos, Reparaciones y Propiedades viven en el workbook de Deudas.
SHEET_DEUDAS = '1dKxhgqazskm15lx0f6FNCA0gpJ7i5glfxkusiH3b0Uk'
SHEET_ESTUDIO = '1dKxhgqazskm15lx0f6FNCA0gpJ7i5glfxkusiH3b0Uk'


def leer_env(path):
    env = {}
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            k, _, v = line.partition('=')
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


def sheets_service():
    env = leer_env(ENV_SHEETS)
    sa = json.loads(base64.b64decode(env['GOOGLE_SERVICE_ACCOUNT_JSON_BASE64']).decode())
    creds = Credentials.from_service_account_info(
        sa, scopes=['https://www.googleapis.com/auth/spreadsheets.readonly'])
    return build('sheets', 'v4', credentials=creds)


def leer_hoja(svc, sheet_id, rango):
    """Una pestaña puede no existir todavía: el dashboard las crea la primera
    vez que se abre el módulo. Eso no es un error, simplemente no hay nada que
    migrar."""
    try:
        return svc.spreadsheets().values().get(
            spreadsheetId=sheet_id, range=rango).execute().get('values', [])
    except Exception as e:
        if 'Unable to parse range' in str(e):
            print(f"  (la pestaña de {rango.split('!')[0]} no existe todavía)")
            return []
        raise


def filas_como_dicts(rows):
    """Primera fila = encabezados. Devuelve dicts con las llaves de la hoja."""
    if not rows:
        return []
    headers = [(h or '').strip() for h in rows[0]]
    out = []
    for row in rows[1:]:
        if not any((c or '').strip() for c in row):
            continue
        out.append({h: (row[i] if i < len(row) else '') for i, h in enumerate(headers) if h})
    return out


# ── Normalizadores ────────────────────────────────────────────────────────

def num(v):
    """'$2.000,00' / '1910,3' / '2000' → Decimal-compatible float, o None."""
    s = str(v or '').strip().replace('$', '').replace(' ', '')
    if not s:
        return None
    if ',' in s and '.' in s:
        s = s.replace('.', '').replace(',', '.') if s.rfind(',') > s.rfind('.') else s.replace(',', '')
    elif ',' in s:
        s = s.replace(',', '.')
    try:
        return float(s)
    except ValueError:
        return None


def entero(v):
    f = num(v)
    return int(f) if f is not None else None


def fecha(v):
    """Solo se aceptan fechas que se entiendan; lo demás va como NULL para no
    inventar datos."""
    s = str(v or '').strip()
    if not s:
        return None
    for fmt in ('%Y-%m-%d', '%d/%m/%Y', '%d/%m/%y', '%Y/%m/%d'):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def booleano(v):
    return str(v or '').strip().upper() in ('TRUE', 'SI', 'SÍ', 'YES', '1')


def texto(v):
    s = str(v or '').strip()
    return s or None


# ── Migraciones ───────────────────────────────────────────────────────────

def migrar_autos(cur, svc, dry):
    filas = filas_como_dicts(leer_hoja(svc, SHEET_DEUDAS, 'Autos!A1:AZ'))
    for f in filas:
        if not f.get('id'):
            continue
        datos = (
            f['id'], texto(f.get('marca')) or '?', texto(f.get('modelo')) or '?',
            texto(f.get('anio')), num(f.get('valorFactura')), entero(f.get('kilometraje')),
            texto(f.get('propietario')), booleano(f.get('tieneSeguro')),
            texto(f.get('placa')), texto(f.get('vin')),
            texto(f.get('polizaSeguro')), fecha(f.get('vencimientoPoliza')),
            fecha(f.get('vencimientoTenencia')), num(f.get('pagoTenencia')),
            entero(f.get('proximaRevisionKm')), texto(f.get('contratoPrestamo')),
            texto(f.get('emergenciaInterior')), texto(f.get('emergenciaMetro')),
            texto(f.get('reporteSiniestros1')), texto(f.get('reporteSiniestros2')),
            texto(f.get('tipoLlantas')),
            texto(f.get('fotoAuto')), texto(f.get('facturaArchivo')), texto(f.get('polizaArchivo')),
            texto(f.get('tarjetaCirculacionFrente')), texto(f.get('tarjetaCirculacionAtras')),
            texto(f.get('llantasFoto')), texto(f.get('certificadoPolarizado')),
            texto(f.get('tablaPagos')), texto(f.get('tablaPagosSeguro')),
            texto(f.get('extraDoc1Nombre')), texto(f.get('extraDoc1Url')),
            texto(f.get('extraDoc2Nombre')), texto(f.get('extraDoc2Url')),
        )
        if dry:
            print(f"  auto: {datos[1]} {datos[2]} ({datos[3]}) placa={datos[8]}")
            continue
        cur.execute("""
            insert into cars (legacy_key, marca, modelo, anio, valor_factura, kilometraje,
                propietario, tiene_seguro, placa, vin, poliza_seguro, vencimiento_poliza,
                vencimiento_tenencia, pago_tenencia, proxima_revision_km, contrato_prestamo,
                emergencia_interior, emergencia_metro, reporte_siniestros_1, reporte_siniestros_2,
                tipo_llantas, foto_auto, factura_archivo, poliza_archivo, tarjeta_frente,
                tarjeta_atras, llantas_foto, certificado_polarizado, tabla_pagos,
                tabla_pagos_seguro, extra_doc_1_nombre, extra_doc_1_url, extra_doc_2_nombre,
                extra_doc_2_url)
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
                    %s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            on conflict (legacy_key) do update set
                marca=excluded.marca, modelo=excluded.modelo, anio=excluded.anio,
                valor_factura=excluded.valor_factura, kilometraje=excluded.kilometraje,
                propietario=excluded.propietario, tiene_seguro=excluded.tiene_seguro,
                placa=excluded.placa, vin=excluded.vin, poliza_seguro=excluded.poliza_seguro,
                vencimiento_poliza=excluded.vencimiento_poliza,
                vencimiento_tenencia=excluded.vencimiento_tenencia,
                pago_tenencia=excluded.pago_tenencia,
                proxima_revision_km=excluded.proxima_revision_km,
                foto_auto=excluded.foto_auto, factura_archivo=excluded.factura_archivo,
                poliza_archivo=excluded.poliza_archivo, updated_at=now()
        """, datos)
    return len(filas)


def migrar_reparaciones(cur, svc, dry):
    filas = filas_como_dicts(leer_hoja(svc, SHEET_DEUDAS, 'Reparaciones!A1:AZ'))
    huerfanas = 0
    for f in filas:
        if not f.get('id'):
            continue
        if dry:
            print(f"  reparación: {texto(f.get('reparacion'))} · {num(f.get('costo'))} {f.get('moneda') or 'MXN'}")
            continue
        cur.execute('select id from cars where legacy_key = %s', (f.get('carId'),))
        car = cur.fetchone()
        if not car:
            # Sin auto padre no se puede insertar: se reporta en vez de perderla.
            huerfanas += 1
            continue
        cur.execute("""
            insert into car_repairs (legacy_key, car_id, reparacion, costo, moneda, lugar,
                fecha, descripcion, forma_pago, foto, recibo)
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            on conflict (legacy_key) do update set
                reparacion=excluded.reparacion, costo=excluded.costo, moneda=excluded.moneda,
                lugar=excluded.lugar, fecha=excluded.fecha, descripcion=excluded.descripcion,
                forma_pago=excluded.forma_pago, foto=excluded.foto, recibo=excluded.recibo,
                updated_at=now()
        """, (
            f['id'], car[0], texto(f.get('reparacion')) or '?', num(f.get('costo')) or 0,
            texto(f.get('moneda')) or 'MXN', texto(f.get('lugar')), fecha(f.get('fecha')),
            texto(f.get('descripcion')), texto(f.get('formaPago')),
            texto(f.get('foto')), texto(f.get('recibo')),
        ))
    if huerfanas:
        print(f"  ⚠️  {huerfanas} reparación(es) sin auto padre: NO se migraron")
    return len(filas)


def migrar_estudio(cur, svc, dry):
    total = 0
    for hoja, tipo, rango in (('EstudioInventario', 'equipo', 'EstudioInventario!A1:AZ'),
                              ('EstudioPlugins', 'plugin', 'EstudioPlugins!A1:AZ')):
        filas = filas_como_dicts(leer_hoja(svc, SHEET_ESTUDIO, rango))
        total += len(filas)
        for f in filas:
            if not f.get('id'):
                continue
            if dry:
                print(f"  {tipo}: {texto(f.get('name'))} · {num(f.get('precioUsd'))} USD")
                continue
            cur.execute("""
                insert into studio_gear (legacy_key, tipo, name, marca, modelo, descripcion,
                    categoria, cantidad, precio_usd, currency, anio_compra, fecha_compra,
                    site, serial, licencia, account, notas, forma_pago, foto)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                on conflict (legacy_key) do update set
                    name=excluded.name, marca=excluded.marca, categoria=excluded.categoria,
                    cantidad=excluded.cantidad, precio_usd=excluded.precio_usd,
                    fecha_compra=excluded.fecha_compra, forma_pago=excluded.forma_pago,
                    foto=excluded.foto, updated_at=now()
            """, (
                f['id'], tipo, texto(f.get('name')) or '?', texto(f.get('marca')),
                texto(f.get('modelo')), texto(f.get('descripcion')), texto(f.get('categoria')),
                entero(f.get('cantidad')) or 1, num(f.get('precioUsd')),
                texto(f.get('currency')) or 'USD', texto(f.get('anioCompra')),
                fecha(f.get('fechaCompra')), texto(f.get('site')), texto(f.get('serial')),
                texto(f.get('licencia')), texto(f.get('account')), texto(f.get('notas')),
                texto(f.get('formaPago')), texto(f.get('foto')),
            ))
    return total


def migrar_recetas(cur, svc, dry):
    filas = filas_como_dicts(leer_hoja(svc, SHEET_DEUDAS, 'RecetasMedicas!A1:AZ'))
    for f in filas:
        if not f.get('id'):
            continue
        try:
            meds = json.loads(f.get('medicamentos') or '[]')
            if not isinstance(meds, list):
                meds = []
        except (ValueError, TypeError):
            meds = []
        if dry:
            print(f"  receta: {texto(f.get('member'))} · {texto(f.get('doctor'))} · {len(meds)} medicamento(s)")
            continue
        cur.execute("""
            insert into prescriptions (legacy_key, member, fecha, doctor, especialidad,
                diagnostico, medicamentos, indicaciones, proxima_cita, vigencia_hasta,
                notas, foto_url, foto_url_2, recibo_url, monto_consulta, forma_pago)
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
            on conflict (legacy_key) do update set
                member=excluded.member, fecha=excluded.fecha, doctor=excluded.doctor,
                diagnostico=excluded.diagnostico, medicamentos=excluded.medicamentos,
                monto_consulta=excluded.monto_consulta, updated_at=now()
        """, (
            f['id'], texto(f.get('member')) or 'yo', fecha(f.get('fecha')),
            texto(f.get('doctor')), texto(f.get('especialidad')), texto(f.get('diagnostico')),
            json.dumps(meds), texto(f.get('indicaciones')), fecha(f.get('proximaCita')),
            fecha(f.get('vigenciaHasta')), texto(f.get('notas')),
            texto(f.get('fotoUrl')), texto(f.get('fotoUrl2')), texto(f.get('reciboUrl')),
            num(f.get('montoConsulta')), texto(f.get('formaPago')),
        ))
    return len(filas)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--apply', action='store_true')
    args = ap.parse_args()
    if not (args.dry_run or args.apply):
        args.dry_run = True

    svc = sheets_service()
    env = leer_env(ENV_FINANCE)

    with psycopg.connect(env['SUPABASE_DB_URL']) as conn:
        with conn.cursor() as cur:
            print('── Autos ──');         n1 = migrar_autos(cur, svc, args.dry_run)
            print('── Reparaciones ──');  n2 = migrar_reparaciones(cur, svc, args.dry_run)
            print('── Estudio ──');       n3 = migrar_estudio(cur, svc, args.dry_run)
            print('── Recetas ──');       n4 = migrar_recetas(cur, svc, args.dry_run)
        if args.apply:
            conn.commit()

    modo = 'DRY RUN (no se escribió nada)' if args.dry_run else 'APLICADO'
    print(f"\n{modo}: autos={n1} reparaciones={n2} estudio={n3} recetas={n4}")


if __name__ == '__main__':
    main()
