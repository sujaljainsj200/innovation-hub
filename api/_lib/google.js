/**
 * Google Sheets + Drive helpers.
 *
 * Env vars consumed:
 *   GOOGLE_SHEET_ID            — Spreadsheet ID (from the sheet URL)
 *   GOOGLE_SERVICE_ACCOUNT_KEY — Full JSON key for a Google service account,
 *                                stringified (or base64-encoded)
 *   GOOGLE_DRIVE_FOLDER_ID     — Drive folder ID for file uploads
 */

const { google } = require('googleapis');
const { Readable } = require('stream');

const SHEET_NAME = 'DB';

function parseServiceAccountKey() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!raw) throw new Error('Missing env: GOOGLE_SERVICE_ACCOUNT_KEY');
  try {
    return JSON.parse(raw);
  } catch {
    try {
      return JSON.parse(Buffer.from(raw, 'base64').toString('utf-8'));
    } catch {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is not valid JSON or base64');
    }
  }
}

function getAuth() {
  const creds = parseServiceAccountKey();
  return new google.auth.GoogleAuth({
    credentials: creds,
    scopes: [
      'https://www.googleapis.com/auth/spreadsheets',
      'https://www.googleapis.com/auth/drive.file',
    ],
  });
}

async function readSheet() {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) throw new Error('Missing env: GOOGLE_SHEET_ID');
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // Ensure the DB tab exists
  try {
    await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${SHEET_NAME}!A1`,
    });
  } catch (err) {
    if (err.code === 400 || (err.message && err.message.includes('Unable to parse range'))) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] },
      });
      await sheets.spreadsheets.values.update({
        spreadsheetId: sheetId,
        range: `${SHEET_NAME}!A1:B1`,
        valueInputOption: 'RAW',
        requestBody: { values: [['key', 'json']] },
      });
      return {};
    }
    throw err;
  }

  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A:B`,
  });
  const rows = res.data.values || [];
  const result = {};
  for (let i = 1; i < rows.length; i++) {
    const [key, json] = rows[i] || [];
    if (!key) continue;
    try { result[key] = JSON.parse(json || 'null'); }
    catch { result[key] = null; }
  }
  return result;
}

async function writeSheet(data) {
  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) throw new Error('Missing env: GOOGLE_SHEET_ID');
  const auth = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // Ensure the DB tab exists
  try {
    await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: `${SHEET_NAME}!A1`,
    });
  } catch (err) {
    if (err.code === 400 || (err.message && err.message.includes('Unable to parse range'))) {
      await sheets.spreadsheets.batchUpdate({
        spreadsheetId: sheetId,
        requestBody: { requests: [{ addSheet: { properties: { title: SHEET_NAME } } }] },
      });
    } else {
      throw err;
    }
  }

  const rows = [['key', 'json']];
  for (const k in data) {
    rows.push([k, JSON.stringify(data[k])]);
  }
  await sheets.spreadsheets.values.clear({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A:B`,
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: sheetId,
    range: `${SHEET_NAME}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });
  return { ok: true, savedAt: new Date().toISOString() };
}

async function uploadToDrive(fileName, buffer, mimeType) {
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID;
  if (!folderId) throw new Error('Missing env: GOOGLE_DRIVE_FOLDER_ID');
  const auth = getAuth();
  const drive = google.drive({ version: 'v3', auth });

  const fileMetadata = {
    name: fileName,
    parents: [folderId],
  };

  const media = {
    mimeType: mimeType,
    body: Readable.from(buffer),
  };

  const res = await drive.files.create({
    requestBody: fileMetadata,
    media: media,
    fields: 'id, name, webViewLink, size',
  });

  // Make file readable by anyone with the link
  await drive.permissions.create({
    fileId: res.data.id,
    requestBody: {
      role: 'reader',
      type: 'anyone',
    },
  });

  // Get the updated file with webViewLink
  const file = await drive.files.get({
    fileId: res.data.id,
    fields: 'id, name, webViewLink, webContentLink, size',
  });

  return {
    fileId: file.data.id,
    fileName: file.data.name,
    url: file.data.webViewLink,
    downloadUrl: file.data.webContentLink,
    fileSize: parseInt(file.data.size || '0', 10),
  };
}

module.exports = { readSheet, writeSheet, uploadToDrive };
