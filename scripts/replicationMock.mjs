import express from 'express';

const app = express();
app.use(express.json({ limit: '10mb' }));

const PORT = Number(process.env.REPLICATION_MOCK_PORT || 3213);

app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'replication-mock', port: PORT });
});

app.post('/replicate', (req, res) => {
  const body = req.body || {};
  const replicationId = String(body?.replicationId || 'unknown');
  const backend = String(body?.backend || 'unknown');
  const conversationId = String(body?.conversation?.id || 'unknown');
  const segmentsCount = Array.isArray(body?.segments) ? body.segments.length : 0;
  console.log(
    `[replication-mock] replicate id=${replicationId} backend=${backend} conv=${conversationId} segments=${segmentsCount}`
  );
  res.json({
    ok: true,
    accepted: true,
    replicationId,
    receivedAt: new Date().toISOString(),
  });
});

app.listen(PORT, () => {
  console.log(`[replication-mock] listening on http://127.0.0.1:${PORT}`);
  console.log('[replication-mock] health: GET /health');
  console.log('[replication-mock] endpoint: POST /replicate');
});
