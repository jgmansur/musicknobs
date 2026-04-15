import { drive_v3, google, sheets_v4 } from "googleapis";
import { config } from "./config.js";

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/drive",
];

let sheetsClient: sheets_v4.Sheets | null = null;
let driveClient: drive_v3.Drive | null = null;

function getAuth() {
  const credentials = JSON.parse(config.serviceAccountJson);
  return new google.auth.GoogleAuth({
    credentials,
    scopes: SCOPES,
  });
}

export function getSheetsClient(): sheets_v4.Sheets {
  if (sheetsClient) return sheetsClient;
  sheetsClient = google.sheets({ version: "v4", auth: getAuth() });
  return sheetsClient;
}

export function getDriveClient(): drive_v3.Drive {
  if (driveClient) return driveClient;
  driveClient = google.drive({ version: "v3", auth: getAuth() });
  return driveClient;
}

export async function sheetsGet(spreadsheetId: string, range: string): Promise<string[][]> {
  const client = getSheetsClient();
  const res = await client.spreadsheets.values.get({ spreadsheetId, range });
  const rows = (res.data.values || []).map((r) => r.map((c) => (c ?? "").toString()));
  return rows;
}

export async function sheetsUpdate(spreadsheetId: string, range: string, values: string[][]): Promise<void> {
  const client = getSheetsClient();
  await client.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: "RAW",
    requestBody: { values },
  });
}

export async function sheetsClear(spreadsheetId: string, range: string): Promise<void> {
  const client = getSheetsClient();
  await client.spreadsheets.values.clear({ spreadsheetId, range });
}

export async function sheetsGetSpreadsheet(spreadsheetId: string): Promise<sheets_v4.Schema$Spreadsheet> {
  const client = getSheetsClient();
  const res = await client.spreadsheets.get({ spreadsheetId });
  return res.data;
}

export async function sheetsBatchUpdate(
  spreadsheetId: string,
  requests: sheets_v4.Schema$Request[],
): Promise<void> {
  if (!requests.length) return;
  const client = getSheetsClient();
  await client.spreadsheets.batchUpdate({ spreadsheetId, requestBody: { requests } });
}

export async function createSpreadsheet(title: string): Promise<{ id: string; url: string }> {
  const client = getSheetsClient();
  const res = await client.spreadsheets.create({
    requestBody: { properties: { title } },
    fields: "spreadsheetId,spreadsheetUrl",
  });
  return {
    id: res.data.spreadsheetId || "",
    url: res.data.spreadsheetUrl || "",
  };
}

export async function sheetsAppend(spreadsheetId: string, range: string, values: string[][]): Promise<void> {
  const client = getSheetsClient();
  await client.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values },
  });
}

export async function findSpreadsheetByName(name: string): Promise<string | null> {
  const drive = getDriveClient();
  const q = [
    "mimeType='application/vnd.google-apps.spreadsheet'",
    "trashed=false",
    `name='${name.replace(/'/g, "\\'")}'`,
  ].join(" and ");
  const res = await drive.files.list({
    q,
    pageSize: 5,
    fields: "files(id,name)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const file = res.data.files?.find((f) => !!f.id);
  return file?.id || null;
}

export async function shareFileWithEmail(fileId: string, email: string, role: "reader" | "writer" = "reader"): Promise<void> {
  const drive = getDriveClient();
  await drive.permissions.create({
    fileId,
    requestBody: {
      type: "user",
      role,
      emailAddress: email,
    },
    sendNotificationEmail: false,
    supportsAllDrives: true,
  });
}
