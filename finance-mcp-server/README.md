# Finance MCP Server

Read-only server for your Finance Dashboard data.

It includes:
- HTTP API (for hosting on Fly.io)
- MCP stdio server (for Gemini/desktop MCP clients)
- AI mirror sync to a centralized Google Sheet

## 1) Install

```bash
npm install
```

## 2) Configure env

Copy `.env.example` to `.env` and set values:

- `GOOGLE_SERVICE_ACCOUNT_JSON` (or base64 variant)
- `SPREADSHEET_LOG_ID`
- `SPREADSHEET_AUTOS_ID`
- `SPREADSHEET_FIXED_ID` (optional in current MVP)
- `SPREADSHEET_RECUERDOS_ID` (optional)
- `SPREADSHEET_RSM_ID` (optional)
- `SPREADSHEET_ACCOUNTS_ID` (optional but recommended)
- `SPREADSHEET_AI_MIRROR_ID` (optional; auto-create if missing)
- `AI_MIRROR_SHEET_NAME` (optional)
- `AI_MIRROR_SHARE_EMAIL` (optional; auto-share mirror sheet)
- `ENGRAM_WEBHOOK_URL` (optional; pushes sanitized mirror change events)
- `ENGRAM_WEBHOOK_TOKEN` (optional; bearer token for webhook)
- `API_TOKEN`
- `WIDGET_TOKEN` (recommended for Widgy endpoint)

Share your target Google Sheets with your Service Account email.

## 3) Run locally

HTTP API:

```bash
npm run dev:http
```

MCP (stdio):

```bash
npm run dev:mcp
```

## Available MCP tools

- `get_profile_field`
- `get_finance_summary`
- `get_expenses_by_account`
- `get_fixed_status`
- `get_investments_snapshot`
- `search_documents`
- `search_prompts`
- `sync_ai_mirror`

## 4) Deploy to Fly.io

```bash
fly launch --copy-config --name finance-mcp-server
fly secrets set API_TOKEN="<strong-token>"
fly secrets set GOOGLE_SERVICE_ACCOUNT_JSON='{"type":"service_account",...}'
fly secrets set SPREADSHEET_LOG_ID="..."
fly secrets set SPREADSHEET_AUTOS_ID="..."
fly secrets set SPREADSHEET_RECUERDOS_ID="..."
fly secrets set SPREADSHEET_RSM_ID="..."
fly secrets set SPREADSHEET_ACCOUNTS_ID="..."
fly secrets set ENGRAM_WEBHOOK_URL="https://<tu-engram-bridge>/ingest"
fly secrets set ENGRAM_WEBHOOK_TOKEN="<engram-bridge-token-opcional>"
fly deploy
```

## 5) Example API calls

```bash
curl -H "Authorization: Bearer $API_TOKEN" "https://<your-app>.fly.dev/api/finance/summary?from=2026-01-01&to=2026-12-31"
curl -H "Authorization: Bearer $API_TOKEN" "https://<your-app>.fly.dev/api/fixed/status?month=2026-03"
curl -H "Authorization: Bearer $API_TOKEN" "https://<your-app>.fly.dev/api/profile/field?member=yo&field=curp"
curl -H "Authorization: Bearer $API_TOKEN" "https://<your-app>.fly.dev/api/prompts/search?query=lanzamiento&platform=X"
curl -X POST -H "Authorization: Bearer $API_TOKEN" "https://<your-app>.fly.dev/api/ai-mirror/sync"
curl "https://<your-app>.fly.dev/api/widget/accounts?token=$WIDGET_TOKEN"
curl "https://<your-app>.fly.dev/api/widget/dashboard?token=$WIDGET_TOKEN&focusAccount=Santander"
curl "https://<your-app>.fly.dev/api/widget/dashboard/live?token=$WIDGET_TOKEN&focusAccount=Santander"
```

## Widgy endpoint

- `GET /api/widget/accounts`
- Auth via `WIDGET_TOKEN` only (query `token` or header `x-widget-token`)
- Returns account balances converted to MXN (`USD` and `BTC` converted using live rates with fallback values)
- Useful params:
  - `limit` (1-20, default 8)
  - `includeHidden=true|false`
- Security notes:
  - Do not reuse `API_TOKEN` in Widgy.
  - Rotate `WIDGET_TOKEN` periodically (`fly secrets set WIDGET_TOKEN="..."`).
  - Endpoint response is minimized for widgets (no raw original balances or account IDs).

## Widgy dashboard endpoint + cache

- `GET /api/widget/dashboard`
- Includes dashboard-like totals in MXN (`balanceDisponibleMxn`, `balanceRealMxn`, pending fixed and debt impact)
- Includes focus account real balance via `focusAccount` (default `Santander`)
- Persists anchors and latest snapshot in sheet `WidgyCache` inside the accounts spreadsheet (auto-created)
- `GET /api/widget/dashboard/live`
  - Same payload, but bypasses cache and recalculates in real time

## AI Mirror behavior

- Sync copies all tabs from source spreadsheets into one mirror spreadsheet.
- Mirror tab names use `<source>__<tab>` (example: `autos__DocumentosArchivador`).
- Future columns and fields are copied automatically because each source tab is mirrored as raw table data.
- New tabs in source spreadsheets are also picked up automatically on the next sync.
- If `SPREADSHEET_RECUERDOS_ID` is configured, all its tabs are mirrored as `recuerdos__<tab>`.
- If `SPREADSHEET_RSM_ID` is configured, all its tabs are mirrored as `rsm__<tab>`.
- Includes derived tab `ai__fixed_status` with pending split-payment amounts for accurate AI debt context.

## Engram bridge webhook (optional)

- If `ENGRAM_WEBHOOK_URL` is configured, every successful `sync_ai_mirror` tries to POST a **sanitized** change event.
- The server computes a content signature from mirrored tabs; if signature did not change, webhook is skipped.
- Payload includes only aggregate metadata (no raw ledger rows):
  - mirror spreadsheet id/url
  - sync timestamp + content signature
  - counts of source books/tabs/cells
  - fixed-status totals (`pendingTotal`, month, row count)
- Sync status is persisted in mirror tab `sync_metadata` fields:
  - `engramLastSignature`
  - `engramBridgeEnabled`
  - `engramBridgeAttempted`
  - `engramBridgePushed`
  - `engramBridgeStatusCode`
  - `engramBridgeSkippedReason`
  - `engramBridgeError`

Example webhook flow:
1. Dashboard writes to Sheets.
2. Dashboard auto-calls `/api/ai-mirror/sync`.
3. MCP mirrors tabs and computes signature.
4. If changed, MCP POSTs event to your Engram bridge endpoint.

## Security notes

- Keep this server read-only for now.
- Never commit service account JSON.
- Rotate `API_TOKEN` periodically.
