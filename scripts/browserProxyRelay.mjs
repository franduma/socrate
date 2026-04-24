import express from 'express';
import fs from 'node:fs';
import path from 'node:path';

const app = express();
const PORT = Number(process.env.BROWSER_PROXY_PORT || 3211);
const SNAPSHOT_PATH = path.resolve(process.cwd(), '.socrate-browser-proxy.json');

app.use(express.json({ limit: '20mb' }));
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});

function loadSnapshot() {
  try {
    if (!fs.existsSync(SNAPSHOT_PATH)) return null;
    const raw = fs.readFileSync(SNAPSHOT_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveSnapshot(snapshot) {
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2), 'utf8');
}

app.get('/health', (_req, res) => {
  res.json({ ok: true, port: PORT });
});

app.get('/latest', (_req, res) => {
  const snapshot = loadSnapshot();
  if (!snapshot) {
    res.status(404).json({ ok: false, error: 'No snapshot available yet.' });
    return;
  }
  res.json({ ok: true, snapshot });
});

app.post('/capture', (req, res) => {
  const body = req.body || {};
  const pageUrl = String(body.pageUrl || '').trim();
  const pageTitle = String(body.pageTitle || '').trim();
  const rawContent = String(body.rawContent || '');
  const renderedContent = String(body.renderedContent || '');
  if (!rawContent.trim()) {
    res.status(400).json({ ok: false, error: 'rawContent is required.' });
    return;
  }
  const snapshot = {
    pageUrl,
    pageTitle,
    rawContent,
    renderedContent,
    capturedAt: Date.now(),
    source: String(body.source || 'browser'),
  };
  saveSnapshot(snapshot);
  res.json({
    ok: true,
    bytes: rawContent.length,
    renderedBytes: renderedContent.length,
    capturedAt: snapshot.capturedAt,
  });
});

app.get('/receiver', (_req, res) => {
  res.type('html').send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Socrate Proxy Receiver</title>
    <style>
      body { font-family: Arial, sans-serif; background: #f8fafc; color: #0f172a; padding: 20px; }
      .ok { color: #166534; }
      .err { color: #991b1b; }
      pre { white-space: pre-wrap; word-break: break-word; background: #fff; padding: 10px; border: 1px solid #e2e8f0; border-radius: 8px; }
    </style>
  </head>
  <body>
    <h2>Socrate Proxy Receiver</h2>
    <p>Attente de capture depuis le bookmarklet...</p>
    <div id="status">En attente...</div>
    <pre id="details"></pre>
    <script>
      const statusEl = document.getElementById('status');
      const detailsEl = document.getElementById('details');
      window.addEventListener('message', async (event) => {
        try {
          const payload = event.data && event.data.type === 'SOCRATE_PROXY_CAPTURE'
            ? event.data.payload
            : null;
          if (!payload || !payload.rawContent) {
            return;
          }
          statusEl.textContent = 'Capture recue, envoi au relay...';
          const res = await fetch('/capture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          });
          const out = await res.json().catch(() => ({}));
          if (!res.ok || !out.ok) {
            throw new Error((out && out.error) || ('HTTP ' + res.status));
          }
          statusEl.className = 'ok';
          statusEl.textContent = 'Capture enregistree. Vous pouvez revenir dans Socrate puis cliquer "Charger depuis relay".';
          detailsEl.textContent = JSON.stringify({ pageTitle: payload.pageTitle, pageUrl: payload.pageUrl, bytes: out.bytes }, null, 2);
        } catch (err) {
          statusEl.className = 'err';
          statusEl.textContent = 'Echec capture.';
          detailsEl.textContent = String(err && err.message ? err.message : err);
        }
      });
    </script>
  </body>
</html>`);
});

app.listen(PORT, '127.0.0.1', () => {
  console.log(`[browser-proxy-relay] Running on http://127.0.0.1:${PORT}`);
  console.log(`[browser-proxy-relay] Snapshot file: ${SNAPSHOT_PATH}`);
});
