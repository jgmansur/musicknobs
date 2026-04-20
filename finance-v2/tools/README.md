# Finance v2 Tools - Sync Contract

## Critical rule: fixed payments must affect expense log

`mark_fijo_paid.py` is not a visual-only toggle.

When a fixed expense is marked as paid, the script must:
- Update payment state in `Gastos Fijos` (columns F/H and related state columns)
- Add the corresponding row to `Control de Gastos` using:
  - `Lugar`: `Gasto Fijo`
  - `Concepto`: `<concepto> (<cuota>/<total>)`
  - `Monto`: per-part amount
  - `Tipo`: `Gasto` or `Ingreso`
  - `Forma de pago` and `Moneda` from fixed row

When reverted (`--unpay`), the script must:
- Revert payment state in `Gastos Fijos`
- Remove matching row from `Control de Gastos`

This keeps balance and KPI calculations aligned with dashboard behavior.

## Why this matters

`finance-dashboard` computes available/real balance from Control de Gastos movements.
If fixed payments are marked as paid but not mirrored in expense log, totals become inconsistent.

## Regression checklist (mandatory before deploy/migration)

1. Mark one fixed expense as paid with `mark_fijo_paid.py --concepto "..."`.
2. Verify one new row appears in `Control de Gastos` with `Gasto Fijo` and cuota suffix.
3. Revert with `--unpay`.
4. Verify the matching row is removed from `Control de Gastos`.
5. Confirm dashboard balance and fixed KPIs update as expected.

## Supermarket Ticket Rule (always on)

For receipts from supermarket chains (`City Market/Citimarket`, `La Comer`, `HEB/H.E.B.`, `Aurrera/Bodega Aurrera`, `Soriana`):

1. Do not create a new fixed-expense record.
2. Mark the next pending installment of `Supermercado`.
3. Keep the fixed-payment progress in `Gastos Fijos`.
4. Ensure `Control de Gastos` ends with real ticket data (real `Lugar`, itemized `Concepto`, real `Monto`, receipt link).

This preserves both systems at once:
- fixed-plan progress (`Supermercado` cuotas), and
- real movement detail for reporting/auditing.

## Receipt Link Integrity

When a row is corrected or reinserted:

- Do not reuse stale URLs from `Recibos`.
- Regenerate the link from a current local file in the synced Drive folder (via `recibo_path` + DriveFS `item-id`).
- If the old link points to a trashed Drive object, create a fresh in-folder file and update the row with the new URL.

## Ticket Analysis Fidelity (Jay preference)

When extracting data from receipts/tickets:

- Always read both **item text and amounts**. Do not rely only on keywords.
- In `Concepto`, keep **full literal itemization** from the ticket (no summarizing/paraphrasing).
- Preserve item-level amounts in `Concepto` when present.
- For supermarket/gas-station tickets used for `Gasto Hormiga`, only count itemized hormiga items (coca/snacks/etc.); if no explicit item amount exists, count `0` (never the full ticket amount).
