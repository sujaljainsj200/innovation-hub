/**
 * /api/upload
 *
 * POST -> uploads a file to Google Drive via Apps Script web app.
 *         Returns a public URL that gets saved on the document record
 *         in the Google Sheet.
 *
 * Body:     { fileData: "data:...;base64,...", fileName: "report.pdf", fileType: "application/pdf" }
 * Returns:  { url, fileName, fileSize, fileType }
 *
 * Auth: requires header
 *   X-API-Secret: <value of API_SECRET env var>
 */

function checkAuth(req) {
  const expected = process.env.API_SECRET;
  if (!expected) {
    console.error('[/api/upload] API_SECRET env var is not set — refusing all requests');
    return false;
  }
  const got = (req.headers['x-api-secret'] || '').toString();
  return got && got === expected;
}

async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Secret');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!checkAuth(req)) {
    return res.status(401).json({ error: 'unauthorized — invalid or missing X-API-Secret header' });
  }

  try {
    const driveUrl = process.env.DRIVE_UPLOAD_URL;
    if (!driveUrl) {
      return res.status(500).json({ error: 'DRIVE_UPLOAD_URL env var is not configured' });
    }

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const { fileData, fileName, fileType } = body || {};
    if (!fileData || !fileName) {
      return res.status(400).json({ error: 'Missing fileData or fileName' });
    }

    // Parse the data URL: "data:<mime>;base64,<data>"
    const matches = String(fileData).match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) {
      return res.status(400).json({ error: 'Invalid file data — expected base64 data URL' });
    }
    const mimeType = matches[1] || fileType || 'application/octet-stream';
    const base64Data = matches[2];
    const fileSize = Buffer.from(base64Data, 'base64').length;

    // Send to Google Apps Script web app
    const resp = await fetch(driveUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileBase64: base64Data,
        fileName: fileName,
        mimeType: mimeType,
      }),
      redirect: 'follow',
    });

    const text = await resp.text();
    let driveResult;
    try { driveResult = JSON.parse(text); } catch { driveResult = { url: text }; }

    if (driveResult.error) {
      throw new Error(driveResult.error);
    }

    return res.status(200).json({
      url: driveResult.url || driveResult.fileUrl || '',
      fileName: fileName,
      fileSize: fileSize,
      fileType: mimeType,
    });
  } catch (err) {
    console.error('[/api/upload]', err);
    return res.status(500).json({ error: err.message || 'Upload failed' });
  }
}

module.exports = handler;
module.exports.config = {
  api: {
    bodyParser: {
      sizeLimit: '50mb',
    },
  },
};
