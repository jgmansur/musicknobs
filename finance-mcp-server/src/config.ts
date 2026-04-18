import "dotenv/config";

function readServiceAccountJson(): string {
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim()) {
    return process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  }
  const b64 = process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64?.trim();
  if (b64) {
    return Buffer.from(b64, "base64").toString("utf8");
  }
  throw new Error("Missing GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_JSON_BASE64");
}

export const config = {
  port: Number(process.env.PORT || 8787),
  nodeEnv: process.env.NODE_ENV || "development",
  apiToken: process.env.API_TOKEN || "",
  widgetToken: process.env.WIDGET_TOKEN || "",
  serviceAccountJson: readServiceAccountJson(),
  spreadsheets: {
    log: process.env.SPREADSHEET_LOG_ID || "",
    autos: process.env.SPREADSHEET_AUTOS_ID || "",
    fixed: process.env.SPREADSHEET_FIXED_ID || "",
    recuerdos: process.env.SPREADSHEET_RECUERDOS_ID || "",
    rsm: process.env.SPREADSHEET_RSM_ID || "",
    accounts: process.env.SPREADSHEET_ACCOUNTS_ID || "",
    aiMirror: process.env.SPREADSHEET_AI_MIRROR_ID || "",
  },
  aiMirrorName: process.env.AI_MIRROR_SHEET_NAME || "Finance AI Mirror",
  aiMirrorShareEmail: process.env.AI_MIRROR_SHARE_EMAIL || "",
  engram: {
    webhookUrl: process.env.ENGRAM_WEBHOOK_URL || "",
    webhookToken: process.env.ENGRAM_WEBHOOK_TOKEN || "",
  },
};

export function assertConfig() {
  const missing: string[] = [];
  if (!config.spreadsheets.log) missing.push("SPREADSHEET_LOG_ID");
  if (!config.spreadsheets.autos) missing.push("SPREADSHEET_AUTOS_ID");
  if (!config.apiToken) missing.push("API_TOKEN");
  if (missing.length) {
    throw new Error(`Missing env vars: ${missing.join(", ")}`);
  }
}
