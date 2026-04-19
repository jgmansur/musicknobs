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
