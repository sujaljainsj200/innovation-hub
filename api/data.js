/**
 * /api/data
 *
 * GET  → reads all data from the Google Sheet (DB tab)
 * POST → writes the full DB object to the Google Sheet
 *
 * Query param: ?ping=1 → quick public health check (no auth required)
 *
 * Auth: every other request must include header
 *   X-API-Secret: <value of API_SECRET env var>
 * Returns 401 otherwise. Frontend gets the value from each user's localStorage
 * (entered once via Settings → Cloud sync).
 */

const { readSheet, writeSheet } = require('./_lib/google');

function checkAuth(req) {
  const expected = process.env.API_SECRET;
  if (!expected) {
    console.error('[/api/data] API_SECRET env var is not set — refusing all requests');
    return false;
  }
  const got = (req.headers['x-api-secret'] || '').toString();
  return got && got === expected;
}

async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-API-Secret');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    // Public health check
    if (req.query && req.query.ping) {
      return res.status(200).json({ ok: true, ping: 'pong' });
    }

    // Auth gate
    if (!checkAuth(req)) {
      return res.status(401).json({ error: 'unauthorized — invalid or missing X-API-Secret header' });
    }

    if (req.method === 'GET') {
      const data = await readSheet();
      return res.status(200).json(data);
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const data = body.data || {};
      const result = await writeSheet(data);
      return res.status(200).json(result);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (err) {
    console.error('[/api/data]', err);
    return res.status(500).json({ error: err.message || 'Internal server error' });
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
