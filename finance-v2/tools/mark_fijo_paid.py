#!/usr/bin/env python3
"""
mark_fijo_paid.py — Marca gastos fijos como pagados (o los revierte).

Antes hacía dos escrituras a mano: volteaba el estado en la hoja Gastos Fijos y
además agregaba/quitaba la fila correspondiente en Control de Gastos. Las dos
hojas se migraron a Supabase, y en el modelo nuevo `POST /api/fixed/:id/pay`
hace ambas cosas de forma atómica: marca la cuota Y genera el movimiento contra
la cuenta del pagador. Por eso este script quedó mucho más corto.

La interfaz de línea de comandos no cambió (--concepto, --cuota, --unpay,
--list, --dry-run), porque el bridge de Telegram la usa tal cual.
"""
import argparse
import sys
from datetime import date
from difflib import SequenceMatcher

# El cliente del worker vive en ~/tools, fuera de este repo.
sys.path.insert(0, '/Users/jaystudio/tools')
import finance_api


def cargar_fijos():
    periodo = date.today().strftime('%Y-%m')
    fijos = finance_api.api_get('/api/fijos', period=periodo).get('fijos', [])
    items = []
    for f in fijos:
        partes = f.get('partes') or {}
        total = f.get('pagos_mes') or 1
        # La API entrega las partes como dict {"0": {paid, waived}}; aquí se
        # aplana a lista para poder razonar por índice como antes.
        estado = [bool(partes.get(str(i), {}).get('paid') or partes.get(str(i), {}).get('waived'))
                  for i in range(total)]
        items.append({
            'id': f['id'],
            'concepto': f.get('concepto') or '',
            'tipo': f.get('tipo') or 'gasto',
            'pagador': f.get('pagador') or '',
            'pagos_mes': total,
            'pagos_estado': estado,
            'pagos_hechos': sum(1 for p in estado if p),
            'is_paid': all(estado) if estado else False,
        })
    return items


def best_match(query, items, threshold=0.4):
    """Mismo criterio que la versión de hoja: substring exacto gana, y entre
    varios substrings gana el nombre más largo (el más específico)."""
    query_lower = query.lower()
    best = None
    best_score = 0
    best_name_len = 0
    for item in items:
        name = item['concepto'].lower()
        if query_lower in name or name in query_lower:
            score = 1.0
            if score > best_score or (score == best_score and len(name) > best_name_len):
                best_score = score
                best_name_len = len(name)
                best = item
        else:
            score = SequenceMatcher(None, query_lower, name).ratio()
            if score > best_score:
                best_score = score
                best_name_len = len(name)
                best = item
    if best_score >= threshold:
        return best, best_score
    return None, 0


def main():
    parser = argparse.ArgumentParser(description='Marca un gasto fijo como pagado')
    parser.add_argument('--concepto', help='Nombre (o parte del nombre) del gasto fijo')
    parser.add_argument('--cuota', type=int, default=None,
                        help='Número de cuota a marcar (1-based). Si no se especifica, '
                             'marca la SIGUIENTE pendiente (o revierte la última pagada).')
    parser.add_argument('--unpay', action='store_true',
                        help='Revertir a pendiente en lugar de marcar como pagado')
    parser.add_argument('--list', action='store_true', dest='list_all',
                        help='Listar todos los fijos con su estado actual')
    parser.add_argument('--dry-run', action='store_true',
                        help='Muestra qué haría sin escribir')
    args = parser.parse_args()

    try:
        items = cargar_fijos()
    except Exception as e:
        print(f"ERROR: no pude leer los fijos de finance-core — {e}")
        sys.exit(1)

    # ── Listar ──
    if args.list_all:
        print(f"\n{'Concepto':<40} {'Tipo':<8} {'Cuotas':<8} {'Estado'}")
        print('─' * 71)
        for item in items:
            estado = '✅ Pagado' if item['is_paid'] else f"⏳ {item['pagos_hechos']}/{item['pagos_mes']}"
            print(f"{item['concepto']:<40} {item['tipo']:<8} {item['pagos_mes']:<8} {estado}")
        return

    if not args.concepto:
        print("ERROR: Especifica --concepto o --list")
        sys.exit(1)

    # ── Buscar ──
    item, score = best_match(args.concepto, items)
    if not item:
        print(f"ERROR: No encontré ningún fijo que coincida con '{args.concepto}'")
        print("Usa --list para ver todos los disponibles.")
        sys.exit(1)

    pagos_mes = item['pagos_mes']
    marcar_pagado = not args.unpay

    # ── Qué cuotas tocar ──
    if args.cuota is not None:
        idx = args.cuota - 1
        if idx < 0 or idx >= pagos_mes:
            print(f"ERROR: Cuota {args.cuota} inválida. Este fijo tiene {pagos_mes} cuota(s).")
            sys.exit(1)
        objetivo = [idx]
        cuota_desc = f"cuota {args.cuota}"
    else:
        # Sin --cuota se toca UNA sola: la siguiente pendiente al pagar, o la
        # última pagada al revertir. Antes marcaba todas de un golpe, y como el
        # bridge llama así al detectar una compra de súper, una ida al súper
        # saldaba el fijo completo.
        estado = item['pagos_estado']
        if marcar_pagado:
            siguiente = next((i for i, pagada in enumerate(estado) if not pagada), None)
        else:
            siguiente = next((i for i in range(pagos_mes - 1, -1, -1) if estado[i]), None)
        objetivo = [] if siguiente is None else [siguiente]
        if pagos_mes > 1:
            cuota_desc = f"cuota {siguiente + 1}" if siguiente is not None else "ninguna"
        else:
            cuota_desc = "pago único"

    # Solo se tocan las que de verdad cambian: la API rechaza repagar una parte,
    # y revertir una que nunca se pagó no tiene sentido.
    a_cambiar = [i for i in objetivo if item['pagos_estado'][i] != marcar_pagado]
    accion = "↩️  Revertido a pendiente" if args.unpay else "✅ Marcado como pagado"

    if not a_cambiar:
        estado_txt = "pagada(s)" if marcar_pagado else "pendiente(s)"
        print(f"\nSin cambios: '{item['concepto']}' — {cuota_desc} ya está(n) {estado_txt}.")
        return

    cuenta = None
    if marcar_pagado:
        cuenta = finance_api.buscar_cuenta(item['pagador']) if item['pagador'] else None
        if not cuenta:
            print(f"ERROR: '{item['concepto']}' tiene forma de pago "
                  f"'{item['pagador'] or 'vacía'}' y no la pude resolver a una cuenta.")
            sys.exit(1)

    if args.dry_run:
        print(f"[DRY RUN] Fijo encontrado: '{item['concepto']}' (score={score:.2f})")
        print(f"[DRY RUN] Acción: {accion} — {cuota_desc}")
        print(f"[DRY RUN] Cuotas que cambian: {[i + 1 for i in a_cambiar]}")
        if cuenta:
            print(f"[DRY RUN] Cuenta: {cuenta['name']}")
        return

    periodo = date.today().strftime('%Y-%m')
    hechas, fallidas = [], []
    for idx in a_cambiar:
        try:
            if marcar_pagado:
                finance_api.api_post(f"/api/fixed/{item['id']}/pay",
                                     {'partIndex': idx, 'accountId': cuenta['id']})
            else:
                finance_api.api_post(f"/api/fijos/{item['id']}/unpay",
                                     {'partIndex': idx, 'period': periodo})
            hechas.append(idx + 1)
        except Exception as e:
            fallidas.append((idx + 1, str(e)))

    if hechas:
        print(f"\n{accion}: {item['concepto']}")
        print(f"  Cuota(s): {', '.join(str(c) for c in hechas)} de {pagos_mes}")
        if marcar_pagado:
            print(f"  Cuenta: {cuenta['name']} — el movimiento se generó solo")
        total_ahora = item['pagos_hechos'] + (len(hechas) if marcar_pagado else -len(hechas))
        print(f"  Progreso: {total_ahora}/{pagos_mes} pagos")
        if marcar_pagado and total_ahora >= pagos_mes:
            print("  🎉 ¡Completamente pagado este mes!")

    if fallidas:
        for cuota, err in fallidas:
            print(f"  ⚠️  Cuota {cuota}: {err}")
        if not hechas:
            sys.exit(1)


if __name__ == '__main__':
    main()
