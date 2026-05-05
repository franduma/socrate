import express from 'express';

const app = express();
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
});
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

async function chromaQuery(queryText, topK = 10) {
  const collection = await ensureChromaCollection();
  const collectionId = String(collection?.id || '');
  if (!collectionId) throw new Error('Chroma collection id missing.');

  const queryBody = {
    query_texts: [String(queryText || '')],
    n_results: Math.max(1, Number(topK || 10)),
    include: ['documents', 'metadatas', 'distances'],
  };
  const response = await fetch(`${CHROMA_URL}/api/v1/collections/${collectionId}/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(queryBody),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Chroma query HTTP ${response.status}: ${text || response.statusText}`);
  }
  const json = await response.json().catch(() => ({}));
  const ids = Array.isArray(json?.ids?.[0]) ? json.ids[0] : [];
  const documents = Array.isArray(json?.documents?.[0]) ? json.documents[0] : [];
  const metadatas = Array.isArray(json?.metadatas?.[0]) ? json.metadatas[0] : [];
  const distances = Array.isArray(json?.distances?.[0]) ? json.distances[0] : [];

  const out = [];
  for (let i = 0; i < ids.length; i++) {
    out.push({
      id: String(ids[i] || ''),
      document: String(documents[i] || ''),
      metadata: metadatas[i] || {},
      distance: typeof distances[i] === 'number' ? distances[i] : null,
    });
  }
  return out;
}

function scoreFromDistance(distance) {
  if (typeof distance !== 'number' || Number.isNaN(distance)) return null;
  // bounded similarity proxy in [0, 1]
  return Number((1 / (1 + Math.max(0, distance))).toFixed(4));
}

async function neo4jReadConversationsByIds(conversationIds) {
  const ids = Array.from(new Set((conversationIds || []).map((x) => String(x || '').trim()).filter(Boolean)));
  if (!ids.length) return [];
  const txUrl = `${NEO4J_HTTP_URL}/db/neo4j/tx/commit`;
  const response = await fetch(txUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: toNeo4jAuthHeader(),
    },
    body: JSON.stringify({
      statements: [
        {
          statement: `
            MATCH (c:Conversation)
            WHERE c.id IN $ids
            OPTIONAL MATCH (c)-[:HAS_THEME]->(th:Theme)
            OPTIONAL MATCH (c)-[hs:HAS_SEGMENT]->(s:Segment)
            WITH c, collect(DISTINCT th.name) AS themes, hs, s
            ORDER BY hs.segmentOrder ASC
            WITH c, themes, collect(DISTINCT s)[0..3] AS headSegments
            RETURN
              c.id AS id,
              c.title AS title,
              c.source AS source,
              c.createdAt AS createdAt,
              c.updatedAt AS updatedAt,
              c.segmentsCount AS segmentsCount,
              c.sha256 AS sha256,
              c.semanticSummary AS semanticSummary,
              themes AS themes,
              [seg IN headSegments | coalesce(seg.originalText, seg.content)] AS previewSegments
          `,
          parameters: { ids },
        },
      ],
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Neo4j read HTTP ${response.status}: ${text || response.statusText}`);
  }
  const json = await response.json().catch(() => ({}));
  if (Array.isArray(json?.errors) && json.errors.length > 0) {
    throw new Error(`Neo4j read error: ${json.errors[0]?.message || 'unknown'}`);
  }
  const rows = json?.results?.[0]?.data || [];
  return rows.map((r) => r.row).map((row) => ({
    id: String(row[0] || ''),
    title: String(row[1] || ''),
    source: String(row[2] || ''),
    createdAt: Number(row[3] || 0),
    updatedAt: Number(row[4] || 0),
    segmentsCount: Number(row[5] || 0),
    sha256: String(row[6] || ''),
    semanticSummary: String(row[7] || ''),
    themes: Array.isArray(row[8]) ? row[8].filter(Boolean) : [],
    previewSegments: Array.isArray(row[9]) ? row[9].filter(Boolean) : [],
  }));
}

async function neo4jLexicalSearch(queryText, topK = 10) {
  const normalized = String(queryText || '').toLowerCase();
  const terms = Array.from(new Set(
    normalized
      .split(/[^a-z0-9\u00c0-\u024f]+/i)
      .map((t) => t.trim())
      .filter((t) => t.length >= 3)
  ));
  if (!terms.length) return [];

  const txUrl = `${NEO4J_HTTP_URL}/db/neo4j/tx/commit`;
  const response = await fetch(txUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: toNeo4jAuthHeader(),
    },
    body: JSON.stringify({
      statements: [
        {
          statement: `
            MATCH (c:Conversation)
            OPTIONAL MATCH (c)-[:HAS_THEME]->(th:Theme)
            OPTIONAL MATCH (c)-[hs:HAS_SEGMENT]->(s:Segment)
            WITH c, collect(DISTINCT th.name) AS themes, hs, s
            ORDER BY hs.segmentOrder ASC
            WITH c, themes, collect(DISTINCT s)[0..5] AS segs, $terms AS terms
            WITH c, themes, segs, terms,
                 toLower(coalesce(c.title, '')) AS t,
                 toLower(coalesce(c.semanticSummary, '')) AS ss,
                 reduce(acc = '', seg IN segs | acc + ' ' + toLower(coalesce(seg.originalText, seg.content, ''))) AS corpus
            WITH c, themes, segs, terms, t, ss, corpus,
                 [term IN terms WHERE t CONTAINS term OR ss CONTAINS term OR corpus CONTAINS term] AS matched
            WHERE size(matched) > 0
            WITH c, themes, segs, matched, toFloat(size(matched)) / toFloat(size(terms)) AS score
            ORDER BY score DESC, c.updatedAt DESC
            RETURN
              c.id AS id,
              c.title AS title,
              c.source AS source,
              c.createdAt AS createdAt,
              c.updatedAt AS updatedAt,
              c.segmentsCount AS segmentsCount,
              c.sha256 AS sha256,
              c.semanticSummary AS semanticSummary,
              themes AS themes,
              [seg IN segs | coalesce(seg.originalText, seg.content)] AS previewSegments,
              score AS score
            LIMIT $limit
          `,
          parameters: { terms, limit: Math.max(1, Number(topK || 10)) },
        },
      ],
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Neo4j lexical HTTP ${response.status}: ${text || response.statusText}`);
  }
  const json = await response.json().catch(() => ({}));
  if (Array.isArray(json?.errors) && json.errors.length > 0) {
    throw new Error(`Neo4j lexical error: ${json.errors[0]?.message || 'unknown'}`);
  }
  const rows = json?.results?.[0]?.data || [];
  return rows.map((r) => r.row).map((row) => ({
    conversationId: String(row[0] || ''),
    score: typeof row[10] === 'number' ? Number(row[10].toFixed(4)) : null,
    distance: null,
    title: String(row[1] || ''),
    source: String(row[2] || ''),
    createdAt: Number(row[3] || 0),
    updatedAt: Number(row[4] || 0),
    themes: Array.isArray(row[8]) ? row[8].filter(Boolean) : [],
    semanticSummary: String(row[7] || ''),
    preview: Array.isArray(row[9]) ? row[9].filter(Boolean).join('\n\n').slice(0, 1200) : '',
    vectorSnippet: '',
    metadata: { mode: 'neo4j_lexical_fallback' },
  }));
}

function applyLocalFilters(items, filters) {
  const sourceContains = String(filters?.sourceContains || '').trim().toLowerCase();
  const titleContains = String(filters?.titleContains || '').trim().toLowerCase();
  const themeIncludes = String(filters?.themeIncludes || '').trim().toLowerCase();
  const createdAfter = filters?.createdAfter ? Number(new Date(filters.createdAfter).getTime()) : null;
  const createdBefore = filters?.createdBefore ? Number(new Date(filters.createdBefore).getTime()) : null;
  return items.filter((item) => {
    if (sourceContains && !String(item?.source || '').toLowerCase().includes(sourceContains)) return false;
    if (titleContains && !String(item?.title || '').toLowerCase().includes(titleContains)) return false;
    if (themeIncludes) {
      const ok = Array.isArray(item?.themes)
        ? item.themes.some((t) => String(t || '').toLowerCase().includes(themeIncludes))
        : false;
      if (!ok) return false;
    }
    if (typeof createdAfter === 'number' && !Number.isNaN(createdAfter) && Number(item?.createdAt || 0) < createdAfter) return false;
    if (typeof createdBefore === 'number' && !Number.isNaN(createdBefore) && Number(item?.createdAt || 0) > createdBefore) return false;
    return true;
  });
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

app.post('/search/hybrid', async (req, res) => {
  const query = String(req.body?.query || '').trim();
  const topK = Math.max(1, Number(req.body?.topK || 10));
  const filters = req.body?.filters || {};
  if (!query) {
    res.status(400).json({ ok: false, error: 'query is required' });
    return;
  }
  try {
    let merged = [];
    let mode = 'chroma+neo4j';
    try {
      const vectorHits = await chromaQuery(query, topK);
      const conversationIds = vectorHits.map((h) => h?.metadata?.conversationId).filter(Boolean);
      const graphRows = await neo4jReadConversationsByIds(conversationIds);
      const graphById = new Map(graphRows.map((r) => [r.id, r]));

      merged = vectorHits.map((hit) => {
        const conversationId = String(hit?.metadata?.conversationId || '');
        const graph = graphById.get(conversationId);
        return {
          conversationId,
          score: scoreFromDistance(hit.distance),
          distance: hit.distance,
          title: graph?.title || String(hit?.metadata?.title || ''),
          source: graph?.source || String(hit?.metadata?.source || ''),
          createdAt: graph?.createdAt || null,
          updatedAt: graph?.updatedAt || null,
          themes: graph?.themes || [],
          semanticSummary: graph?.semanticSummary || '',
          preview: (graph?.previewSegments || []).join('\n\n').slice(0, 1200),
          vectorSnippet: String(hit?.document || '').slice(0, 600),
          metadata: hit?.metadata || {},
        };
      });
    } catch (error) {
      const msg = String(error?.message || error || '');
      if (!msg.includes('query_embeddings')) throw error;
      mode = 'neo4j_lexical_fallback';
      merged = await neo4jLexicalSearch(query, topK);
    }

    const filtered = applyLocalFilters(merged, filters);
    res.json({
      ok: true,
      query,
      topK,
      mode,
      returned: filtered.length,
      results: filtered,
    });
  } catch (error) {
    const msg = String(error?.message || error || 'unknown');
    console.error(`[replication-server] hybrid search failed: ${msg}`);
    res.status(500).json({ ok: false, error: msg });
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
