import express from 'express';

const app = express();
app.use(express.json({ limit: '20mb' }));

const PORT = Number(process.env.REPLICATION_SERVER_PORT || 3213);
const NEO4J_HTTP_URL = String(process.env.NEO4J_HTTP_URL || 'http://127.0.0.1:7474').replace(/\/$/, '');
const NEO4J_AUTH = String(process.env.NEO4J_AUTH || 'neo4j/socrate_dev_password');
const CHROMA_URL = String(process.env.CHROMA_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const CHROMA_COLLECTION = String(process.env.CHROMA_COLLECTION || 'socrate_conversations').trim() || 'socrate_conversations';

function toNeo4jAuthHeader() {
  const [user, ...rest] = NEO4J_AUTH.split('/');
  const pass = rest.join('/');
  const token = Buffer.from(`${user}:${pass}`).toString('base64');
  return `Basic ${token}`;
}

async function neo4jWrite(payload) {
  const conv = payload?.conversation || {};
  const segments = Array.isArray(payload?.segments) ? payload.segments : [];
  const txUrl = `${NEO4J_HTTP_URL}/db/neo4j/tx/commit`;

  const statements = [
    {
      statement: `
        MERGE (c:Conversation {id: $conversation.id})
        SET c.sha256 = $conversation.sha256,
            c.title = $conversation.title,
            c.source = $conversation.source,
            c.createdAt = $conversation.createdAt,
            c.updatedAt = $conversation.updatedAt,
            c.segmentsCount = $conversation.segmentsCount,
            c.schemaVersion = $conversation.schemaVersion,
            c.semanticSummary = $conversation.semanticSummary
      `,
      parameters: {
        conversation: {
          id: conv.id,
          sha256: conv.sha256 || '',
          title: conv.title || '',
          source: conv.source || '',
          createdAt: Number(conv.createdAt || Date.now()),
          updatedAt: Number(conv.updatedAt || Date.now()),
          segmentsCount: Number(conv.segmentsCount || segments.length || 0),
          schemaVersion: Number(conv.schemaVersion || 1),
          semanticSummary: String(conv?.semanticAnalysis?.summary || ''),
        },
      },
    },
    {
      statement: `
        MATCH (c:Conversation {id: $conversationId})
        WITH c
        UNWIND $segments AS seg
        MERGE (s:Segment {id: seg.id})
        SET s.role = seg.role,
            s.content = seg.content,
            s.originalText = seg.originalText,
            s.timestamp = seg.timestamp,
            s.schemaVersion = seg.schemaVersion
        MERGE (c)-[r:HAS_SEGMENT]->(s)
        SET r.segmentOrder = seg.segmentOrder
      `,
      parameters: {
        conversationId: conv.id,
        segments: segments.map((s, i) => ({
          id: s.id,
          role: String(s.role || ''),
          content: String(s.content || ''),
          originalText: String(s.originalText || s.content || ''),
          timestamp: Number(s.timestamp || Date.now()),
          schemaVersion: Number(s.schemaVersion || 1),
          segmentOrder: i,
        })),
      },
    },
    {
      statement: `
        MATCH (c:Conversation {id: $conversationId})
        WITH c
        UNWIND $themes AS theme
        WITH c, trim(theme) AS t
        WHERE t <> ''
        MERGE (th:Theme {name: t})
        MERGE (c)-[:HAS_THEME]->(th)
      `,
      parameters: {
        conversationId: conv.id,
        themes: Array.isArray(conv?.semanticAnalysis?.themes) ? conv.semanticAnalysis.themes : [],
      },
    },
  ];

  const response = await fetch(txUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: toNeo4jAuthHeader(),
    },
    body: JSON.stringify({ statements }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Neo4j HTTP ${response.status}: ${text || response.statusText}`);
  }
  const json = await response.json().catch(() => ({}));
  if (Array.isArray(json?.errors) && json.errors.length > 0) {
    throw new Error(`Neo4j error: ${json.errors[0]?.message || 'unknown'}`);
  }
}

async function neo4jBootstrap() {
  const txUrl = `${NEO4J_HTTP_URL}/db/neo4j/tx/commit`;
  const statements = [
    { statement: 'CREATE CONSTRAINT conversation_id_unique IF NOT EXISTS FOR (c:Conversation) REQUIRE c.id IS UNIQUE' },
    { statement: 'CREATE CONSTRAINT segment_id_unique IF NOT EXISTS FOR (s:Segment) REQUIRE s.id IS UNIQUE' },
    { statement: 'CREATE INDEX theme_name_idx IF NOT EXISTS FOR (t:Theme) ON (t.name)' },
    { statement: 'CREATE INDEX conversation_sha_idx IF NOT EXISTS FOR (c:Conversation) ON (c.sha256)' },
  ];
  const response = await fetch(txUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: toNeo4jAuthHeader(),
    },
    body: JSON.stringify({ statements }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Neo4j bootstrap HTTP ${response.status}: ${text || response.statusText}`);
  }
  const json = await response.json().catch(() => ({}));
  if (Array.isArray(json?.errors) && json.errors.length > 0) {
    throw new Error(`Neo4j bootstrap error: ${json.errors[0]?.message || 'unknown'}`);
  }
}

async function ensureChromaCollection() {
  const createBody = { name: CHROMA_COLLECTION, get_or_create: true };
  let response = await fetch(`${CHROMA_URL}/api/v1/collections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(createBody),
  });
  if (response.ok) return response.json();

  // Fallback variants across Chroma versions.
  response = await fetch(`${CHROMA_URL}/api/v1/collections`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: CHROMA_COLLECTION }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Chroma create collection HTTP ${response.status}: ${text || response.statusText}`);
  }
  return response.json();
}

async function chromaWrite(payload) {
  const vectorDoc = payload?.vectorDocument || {};
  const conv = payload?.conversation || {};
  const collection = await ensureChromaCollection();
  const collectionId = String(collection?.id || '');
  if (!collectionId) throw new Error('Chroma collection id missing.');

  const ids = [String(vectorDoc.id || conv.id || '')];
  const documents = [String(vectorDoc.document || '')];
  const metadatas = [{
    conversationId: String(conv.id || ''),
    title: String(conv.title || ''),
    model: String(vectorDoc?.metadata?.model || 'unknown'),
    date: String(vectorDoc?.metadata?.date || new Date().toISOString()),
    source: String(conv.source || ''),
  }];

  const response = await fetch(`${CHROMA_URL}/api/v1/collections/${collectionId}/upsert`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids, documents, metadatas }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Chroma upsert HTTP ${response.status}: ${text || response.statusText}`);
  }
}

async function checkNeo4jHealth() {
  const txUrl = `${NEO4J_HTTP_URL}/db/neo4j/tx/commit`;
  const response = await fetch(txUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: toNeo4jAuthHeader(),
    },
    body: JSON.stringify({ statements: [{ statement: 'RETURN 1 AS ok' }] }),
  });
  if (!response.ok) throw new Error(`Neo4j HTTP ${response.status}`);
  const json = await response.json().catch(() => ({}));
  if (Array.isArray(json?.errors) && json.errors.length > 0) {
    throw new Error(json.errors[0]?.message || 'Neo4j query error');
  }
  return true;
}

async function checkChromaHealth() {
  const response = await fetch(`${CHROMA_URL}/api/v1/heartbeat`);
  if (!response.ok) throw new Error(`Chroma HTTP ${response.status}`);
  return true;
}

app.get('/health', async (_req, res) => {
  const status = {
    ok: true,
    service: 'replication-server',
    neo4j: { url: NEO4J_HTTP_URL, ok: false },
    chroma: { url: CHROMA_URL, ok: false },
    collection: CHROMA_COLLECTION,
  };
  try {
    await checkNeo4jHealth();
    status.neo4j.ok = true;
  } catch (error) {
    status.ok = false;
    status.neo4j.error = String(error?.message || error);
  }
  try {
    await checkChromaHealth();
    status.chroma.ok = true;
  } catch (error) {
    status.ok = false;
    status.chroma.error = String(error?.message || error);
  }
  res.status(status.ok ? 200 : 503).json(status);
});

app.post('/replicate', async (req, res) => {
  const payload = req.body || {};
  const replicationId = String(payload?.replicationId || 'unknown');
  try {
    await neo4jWrite(payload);
    await chromaWrite(payload);
    res.json({ ok: true, replicationId, storedAt: new Date().toISOString() });
  } catch (error) {
    const msg = String(error?.message || error || 'unknown');
    console.error(`[replication-server] replication failed id=${replicationId} error=${msg}`);
    res.status(500).json({ ok: false, replicationId, error: msg });
  }
});

app.listen(PORT, () => {
  console.log(`[replication-server] listening on http://127.0.0.1:${PORT}`);
  console.log(`[replication-server] neo4j=${NEO4J_HTTP_URL} chroma=${CHROMA_URL} collection=${CHROMA_COLLECTION}`);
  neo4jBootstrap()
    .then(() => {
      console.log('[replication-server] neo4j bootstrap complete (constraints/indexes ensured)');
    })
    .catch((error) => {
      console.error(`[replication-server] neo4j bootstrap failed: ${String(error?.message || error)}`);
    });
});
