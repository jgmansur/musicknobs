# Finance Core

Capa de datos y de ingesta automática para el Finance Dashboard.

Sustituye la captura manual por un flujo donde el banco avisa, el sistema parsea
y Jay solo aprueba. El dashboard actual sigue funcionando; esta capa se le monta
por debajo.

## Por qué existe

La hoja de Control de Gastos tenía un hueco de 22 días sin registrar (10 jul →
1 ago 2026) durante el cual sí hubo compras reales. La causa no es disciplina:
la app obligaba a Jay a ser la integración entre el banco y la hoja.

Dos errores de diseño se corrigen aquí:

1. **El saldo se capturaba a mano.** Ahora se deriva: `opening_balance` + suma
   de movimientos. Por eso `accounts` no tiene columna `balance`.
2. **El estado de pago de los fijos vivía como bit-fields serializados** dentro
   de celdas de texto, con parsing frágil y race conditions. Ahora cada parte es
   una fila con constraint único en `fixed_expense_payments`.

## Estructura

```
supabase/migrations/0001_init.sql   Esquema completo
worker/src/parsers.js               Parsers de alertas Santander y BBVA
worker/src/parsers.test.js          10 tests, incluye correo real de Santander
scripts/gmail_auth.py               Consentimiento único de Gmail
scripts/migrate_sheets.py           Sheets → Supabase (con --dry-run)
```

## Estado

| Pieza | Estado |
| --- | --- |
| Esquema SQL | **Aplicado** — PostgreSQL 17.6, 7 tablas, 2 vistas, 16 índices |
| Parsers | **Verificados** — 10/10 tests en verde |
| Migración | **Aplicada** — 7 cuentas, 504 movimientos, 46 fijos |
| Worker de ingesta | **Desplegado** — cron cada 15 min, verificado en producción |
| MCP de finanzas | **Listo** — 10 herramientas, 14 verificaciones en verde |
| Pestaña de bandeja | **Lista** — falta abrirla en el navegador |

Worker: `https://finance-core.musicknobs.workers.dev`

Proyecto Supabase: `isdjwvvojatoiwfuvuod`, región `us-west-2`, pooler `aws-1`.
La conexión va por **Session pooler** (puerto 5432): la conexión directa de
Supabase solo resuelve por IPv6 y no es alcanzable desde una red IPv4.

Saldos verificados contra la hoja tras migrar, con cero movimientos después del
ancla — o sea, no hubo doble conteo.

Los parsers de Santander (compra débito y TDC) están validados contra el correo
real `19faf44a66a1bc6f`. Los de BBVA se construyeron a partir de fragmentos de
snippet y **necesitan validarse contra cuerpos completos** en cuanto exista el
token de Gmail.

## Puesta en marcha

### 1. Crear el proyecto de Supabase

En [supabase.com](https://supabase.com) con la cuenta `jgmansur2@gmail.com`:
proyecto nuevo, región `us-east-1` o `us-west-1`, y guardar la contraseña de la
base de datos.

Después:

```bash
export SUPABASE_DB_URL='postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres'
psql "$SUPABASE_DB_URL" -f supabase/migrations/0001_init.sql
```

### 2. Migrar los datos

```bash
cd scripts
python3 migrate_sheets.py --dry-run   # revisar advertencias
python3 migrate_sheets.py --apply
```

Las hojas quedan intactas. La migración es idempotente para movimientos
(`source_ref` único por fila de origen).

### 3. Dar acceso a Gmail

Requiere un OAuth Client de tipo **Desktop app** del proyecto
`opengravity-telebot-2026`. La pantalla de consentimiento ya está en Production,
así que el refresh token no expira.

```bash
python3 scripts/gmail_auth.py /ruta/al/client_secret.json
```

Imprime `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET` y `GMAIL_REFRESH_TOKEN` para
guardar como secretos del Worker.

## Convenciones que el esquema hace cumplir

Reglas que hasta ahora vivían solo en la memoria del asistente y que aquí pasan
a ser parte del sistema:

- Una transferencia entre cuentas propias son **dos filas** con el mismo
  `transfer_group_id` y `kind = 'transfer'`. Los reportes las excluyen, así que
  nunca inflan el gasto.
- El saldo de una tarjeta de crédito se guarda **negativo** (deuda). La vista
  `account_balances` expone `display_balance` con el signo que se espera leer.
- Un movimiento nunca puede estar `paid` y `waived` a la vez.
- El mismo correo no puede generar dos movimientos: `gmail_message_id` es único
  en `pending_transactions` y `(source, source_ref)` es único en `transactions`.
- La ingesta **nunca** escribe directo a `transactions`. Todo pasa por
  `pending_transactions` y requiere aprobación.

## Notas de formato

Los montos de la hoja usan formato español (`$25.000,00` = veinticinco mil) y
los de los correos bancarios usan formato inglés (`$2,500.00`). Son funciones
distintas a propósito: `parse_legacy_amount` para migrar, `parseAmount` para
ingerir. No intercambiarlas.
