/**
 * GOOGLE APPS SCRIPT — Saldos Sync Queue
 *
 * Pegar este código en:
 * Extensions → Apps Script (dentro del Sheet de Saldos)
 *
 * Luego ir a Triggers → Add Trigger:
 *   Function: onSheetEdit
 *   Event source: From spreadsheet
 *   Event type: On edit
 *
 * Qué hace: detecta ediciones manuales en "Hoja 1" (cuentas)
 * y escribe una fila en "sync_queue" con estado "pending".
 * El script local saldos_sync.py la procesa cada 2 min.
 */

function onSheetEdit(e) {
  const sheet = e.source.getActiveSheet();
  if (sheet.getName() !== 'Hoja 1') return;

  const range = e.range;
  const row = range.getRow();
  if (row < 2) return; // Saltar header

  // Leer la fila completa (columnas A-K)
  const data = sheet.getRange(row, 1, 1, 11).getValues()[0];
  const accountId = data[0];
  if (!accountId) return; // Fila vacía

  const payload = JSON.stringify({
    id:               accountId,
    name:             data[1]  || '',
    balance:          Number(data[2])  || 0,
    type:             data[3]  || 'bank',
    hidden:           String(data[4]).toUpperCase() === 'TRUE',
    creditLimit:      Number(data[5])  || 0,
    creditLimitVisible: String(data[6]).toUpperCase() === 'TRUE',
    currency:         data[7]  || 'MXN',
    investmentType:   data[8]  || 'custom',
    customAnnualRate: Number(data[9])  || 0,
    bitcoinInitialMxn: Number(data[10]) || 0,
    source:           'sheets-manual-edit',
    editedAt:         new Date().toISOString(),
  });

  const queueSheet = e.source.getSheetByName('sync_queue');
  if (!queueSheet) return;

  queueSheet.appendRow([
    new Date().toISOString(),
    'update_account',
    payload,
    'pending',
  ]);
}
