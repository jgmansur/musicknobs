# Finance Intake Skill — Claude Desktop

## Cuándo activar este skill

Se activa automáticamente cuando Jay menciona cualquiera de estos patrones:
- Un gasto: "gasté", "pagué", "me cobraron", "compré", "salió", "costó"
- Un ingreso: "entró", "me pagaron", "cobré", "deposité", "recibí"
- Un gasto fijo: "el pago de", "cuota de", "suscripción", "renta", "luz", "telcel", "gas"
- Una deuda: "debo", "adeudo", "me queda de la deuda", "abono a"
- Un recuerdo: "recuerda que", "anota esto para el diario", "memoriza que hoy"
- Pelo: "me corté el pelo", "me fui a cortar", "peluquería", "barbería"
- Salud Mariel (RSM): "recibo de Mariel", "farmacia Mariel", "consulta de Mariel", "medicamento Mariel"
- Manda una foto de recibo o ticket

---

## Flujo de procesamiento

### PASO 1 — Extracción de entidades

Extraer del mensaje de Jay:

| Campo | Descripción | Default |
|-------|-------------|---------|
| `tipo` | gasto / ingreso / fijo / deuda / recuerdo / pelo / rsm | gasto |
| `monto` | número sin signos | requerido |
| `moneda` | MXN / USD | MXN |
| `concepto` | qué se compró/pagó | requerido |
| `lugar` | dónde fue | "" |
| `forma_pago` | Santander débito / Santander crédito / Efectivo / BBVA / etc | "" |
| `fecha` | YYYY-MM-DD | hoy |

Si Jay manda foto: usar visión para extraer estos datos del recibo. Confirmar con Jay si algo no está claro.

### PASO 2 — Guardar en Engram

Usar `mem_save` con el topic_key apropiado:

| Tipo | Topic Key |
|------|-----------|
| Gasto diario | `finance/gasto/YYYY-MM/HHMMSS` |
| Ingreso | `finance/ingreso/YYYY-MM/HHMMSS` |
| Gasto fijo | `finance/fijo/slug-del-concepto` |
| Deuda | `finance/deuda/slug-del-concepto` |
| Recuerdo | `finance/recuerdo/YYYY-MM-DD` |
| Pelo | `finance/pelo/YYYY-MM-DD` |
| RSM (salud Mariel) | `finance/rsm/YYYY-MM/HHMMSS` |

El slug se construye lowercase con guiones: "Telcel Jay" → "telcel-jay".

Contenido del observation:
```json
{
  "fecha": "2026-04-17",
  "monto": 450.00,
  "moneda": "MXN",
  "concepto": "Gasolina",
  "lugar": "BP Insurgentes",
  "forma_pago": "Santander débito",
  "tipo": "Gasto",
  "fuente": "claude-desktop"
}
```

### PASO 3 — Escribir a Google Sheets

Ejecutar el script:

```bash
python3 /Users/jaystudio/Documents/GitHub/Apps/musicknobs/finance-v2/tools/finance_write.py \
  --sheet [gastos|fijos|deudas|recuerdos|rsm|pelo] \
  --data '{...json...}'
```

Mapeo tipo → sheet:
- `gasto` → `--sheet gastos`
- `ingreso` → `--sheet gastos` (tipo="Ingreso")
- `fijo` → `--sheet fijos`
- `deuda` → `--sheet deudas`
- `recuerdo` → `--sheet recuerdos`
- `pelo` → `--sheet pelo`
- `rsm` → `--sheet rsm`

### PASO 4 — Confirmar a Jay

Responder con un resumen conciso:

```
✓ Guardado: Gasolina — $450 MXN
  Lugar: BP Insurgentes | Forma de pago: Santander débito
  → Engram: finance/gasto/2026-04/142356
  → Google Sheets: Control de Gastos ✓
```

Si el script falla, avisar a Jay pero indicar que Engram sí quedó guardado.

---

## Ejemplos de Inputs y Parsing

**"Gasté $450 en gasolina en BP con Santander"**
```json
{"tipo":"gasto","monto":450,"concepto":"Gasolina","lugar":"BP","forma_pago":"Santander débito","fecha":"hoy"}
```

**"Me cobraron $870 de Telcel este mes"**
```json
{"tipo":"fijo","monto":870,"concepto":"Telcel","forma_pago":"","fecha":"hoy"}
```

**"Entré $5,000 de royalties de Spotify"**
```json
{"tipo":"ingreso","monto":5000,"concepto":"Royalties Spotify","lugar":"","forma_pago":"","fecha":"hoy"}
```

**"Me corté el pelo, pagué $280 en efectivo"**
```json
{"tipo":"pelo","monto":280,"concepto":"Corte de pelo","forma_pago":"Efectivo","fecha":"hoy"}
```

**"Recibo de la farmacia de Mariel, $350"**
```json
{"tipo":"rsm","monto":350,"concepto":"Farmacia","fecha":"hoy"}
```

**"Anota que hoy fuimos al cine con los niños"**
```json
{"tipo":"recuerdo","texto":"Fuimos al cine con los niños","fecha":"hoy"}
```

---

## Reglas importantes

- **NUNCA** tocar `/finance-dashboard/` ni `/finance-mcp-server/` — son proyectos separados en producción
- Si Jay no especifica forma de pago, dejar vacío y preguntar solo si es un gasto grande (+$500)
- Si el monto es ambiguo (¿MXN o USD?), preguntar antes de guardar
- Para recuerdos, el texto es libre — no estructurar demasiado
- Para gastos fijos que ya existen en el sheet, usar `--sheet fijos` con `estado: "Pagado"` si Jay dice que ya pagó

---

## Credenciales y rutas

| Recurso | Ruta |
|---------|------|
| Script de escritura | `/Users/jaystudio/Documents/GitHub/Apps/musicknobs/finance-v2/tools/finance_write.py` |
| Credenciales (.env) | `/Users/jaystudio/Documents/GitHub/Apps/musicknobs/finance-mcp-server/.env` |
| Engram DB | `/Users/jaystudio/.engram/engram.db` |

---

## Contexto del proyecto

Finance v2 es la nueva arquitectura donde Claude Desktop es el canal de entrada de datos financieros de Jay. El objetivo es que Jay pueda registrar cualquier gasto simplemente hablando — sin abrir el dashboard, sin llenar formularios. Los datos quedan en Engram (fuente de verdad) y en Google Sheets (para que el dashboard actual siga funcionando sin cambios).
