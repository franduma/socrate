import { db } from './db';
import { Conversation, Segment } from '../types';

export type StorageBackend = 'local' | 'hybrid' | 'neo4j_chroma';

export type PersistConversationInput = {
  conversation: Conversation;
  segments: Segment[];
};

export interface ConversationStore {
  backend: StorageBackend;
  saveConversationWithSegments(input: PersistConversationInput): Promise<void>;
}

class LocalDexieConversationStore implements ConversationStore {
  backend: StorageBackend = 'local';

  async saveConversationWithSegments(input: PersistConversationInput): Promise<void> {
    await db.transaction('rw', db.conversations, db.segments, async () => {
      await db.conversations.add(input.conversation);
      for (const seg of input.segments) {
        await db.segments.add(seg);
      }
    });
  }
}

type ReplicationLogEntry = {
  id: string;
  createdAt: number;
  backend: Exclude<StorageBackend, 'local'>;
  conversationId: string;
  segmentsCount: number;
  status: 'pending' | 'synced' | 'failed';
  attempts?: number;
  lastAttemptAt?: number;
  lastError?: string;
  payload: {
    conversation: Conversation;
    segments: Segment[];
  };
};

const REPLICATION_LOG_KEY = 'SOCRATE_REPLICATION_LOG';

function readReplicationLog(): ReplicationLogEntry[] {
  const raw = localStorage.getItem(REPLICATION_LOG_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeReplicationLog(entries: ReplicationLogEntry[]) {
  localStorage.setItem(REPLICATION_LOG_KEY, JSON.stringify(entries));
}

function appendReplicationEntry(entry: ReplicationLogEntry) {
  const current = readReplicationLog();
  current.push(entry);
  // Keep bounded history to avoid unbounded localStorage growth during test phase.
  const bounded = current.slice(-200);
  writeReplicationLog(bounded);
}

type ReplicationSummary = {
  pending: number;
  synced: number;
  failed: number;
  total: number;
};

const REPLICATION_STUB_FAIL_KEY = 'SOCRATE_REPLICATION_STUB_FAIL';
const REPLICATION_ENDPOINT_KEY = 'SOCRATE_REPLICATION_ENDPOINT';
const DEFAULT_REPLICATION_ENDPOINT = 'http://127.0.0.1:3213/replicate';

function getReplicationSummaryInternal(): ReplicationSummary {
  const entries = readReplicationLog();
  let pending = 0;
  let synced = 0;
  let failed = 0;
  for (const e of entries) {
    if (e.status === 'synced') synced += 1;
    else if (e.status === 'failed') failed += 1;
    else pending += 1;
  }
  return { pending, synced, failed, total: entries.length };
}

async function replicateEntryStub(entry: ReplicationLogEntry): Promise<void> {
  // Stage 3: deterministic local mock replication.
  // Set localStorage SOCRATE_REPLICATION_STUB_FAIL=1 to simulate transient failures.
  const failMode = localStorage.getItem(REPLICATION_STUB_FAIL_KEY) === '1';
  if (failMode) {
    throw new Error(`Stub replication failure for ${entry.backend}`);
  }
}

function getReplicationEndpointInternal(): string {
  return String(localStorage.getItem(REPLICATION_ENDPOINT_KEY) || DEFAULT_REPLICATION_ENDPOINT).trim();
}

async function toSha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(String(text || ''));
  const digest = await crypto.subtle.digest('SHA-256', data);
  const bytes = Array.from(new Uint8Array(digest));
  return bytes.map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function buildReplicationPayload(entry: ReplicationLogEntry) {
  const conversation = entry.payload.conversation;
  const segments = entry.payload.segments;
  const fullText = segments.map((s) => String(s.originalText || s.content || '')).join('\n\n');
  const conversationSha256 = await toSha256Hex(fullText);
  return {
    schemaVersion: conversation.schemaVersion || 1,
    backend: entry.backend,
    replicationId: entry.id,
    conversation: {
      id: conversation.id,
      sha256: conversationSha256,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      source: conversation.source,
      segmentsCount: conversation.segmentsCount,
      schemaVersion: conversation.schemaVersion || 1,
      analysisTrace: conversation.analysisTrace,
      semanticAnalysis: conversation.semanticAnalysis,
      contextSnapshot: conversation.contextSnapshot,
    },
    segments: segments.map((s) => ({
      id: s.id,
      conversationId: s.conversationId,
      schemaVersion: s.schemaVersion || 1,
      role: s.role,
      content: s.content,
      originalText: s.originalText,
      timestamp: s.timestamp,
      tags: s.tags || [],
      analysisTrace: s.analysisTrace,
    })),
    vectorDocument: {
      id: conversationSha256,
      document: fullText,
      metadata: {
        conversationId: conversation.id,
        model: conversation.selectedModel || conversation.analysisTrace?.provider || 'unknown',
        date: new Date(conversation.createdAt || Date.now()).toISOString(),
      },
    },
  };
}

async function replicateEntryHttp(entry: ReplicationLogEntry): Promise<void> {
  const endpoint = getReplicationEndpointInternal();
  if (!endpoint) throw new Error('Replication endpoint is empty.');
  const payload = await buildReplicationPayload(entry);
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Replication HTTP ${response.status}: ${text || response.statusText}`);
  }
}

function isEndpointUnavailableError(err: unknown): boolean {
  const msg = String((err as any)?.message || err || '').toLowerCase();
  if (!msg) return false;
  return (
    msg.includes('failed to fetch') ||
    msg.includes('networkerror') ||
    msg.includes('network error') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('eai_again') ||
    msg.includes('timed out') ||
    msg.includes('timeout') ||
    msg.includes('endpoint is empty')
  );
}

let replicationInFlight = false;

export async function flushReplicationQueue(maxEntries = 20): Promise<ReplicationSummary> {
  if (replicationInFlight) return getReplicationSummaryInternal();
  replicationInFlight = true;
  try {
    const entries = readReplicationLog();
    const pendingEntries = entries
      .filter((e) => e.status === 'pending' || e.status === 'failed')
      .sort((a, b) => a.createdAt - b.createdAt)
      .slice(0, Math.max(1, maxEntries));
    if (!pendingEntries.length) return getReplicationSummaryInternal();

    const byId = new Map(entries.map((e) => [e.id, e]));
    for (const candidate of pendingEntries) {
      const current = byId.get(candidate.id);
      if (!current) continue;
      current.attempts = Number(current.attempts || 0) + 1;
      current.lastAttemptAt = Date.now();
      try {
        await replicateEntryStub(current);
        await replicateEntryHttp(current);
        current.status = 'synced';
        current.lastError = undefined;
      } catch (err: any) {
        const lastError = String(err?.message || err || 'unknown replication error');
        current.lastError = lastError;
        // Endpoint/network unavailable should remain retryable without being marked as failed.
        current.status = isEndpointUnavailableError(err) ? 'pending' : 'failed';
      }
      byId.set(current.id, current);
    }
    writeReplicationLog(Array.from(byId.values()).sort((a, b) => a.createdAt - b.createdAt));
    return getReplicationSummaryInternal();
  } finally {
    replicationInFlight = false;
  }
}

export function getReplicationSummary(): ReplicationSummary {
  return getReplicationSummaryInternal();
}

export function isReplicationStubFailMode(): boolean {
  return localStorage.getItem(REPLICATION_STUB_FAIL_KEY) === '1';
}

export function setReplicationStubFailMode(enabled: boolean): void {
  if (enabled) localStorage.setItem(REPLICATION_STUB_FAIL_KEY, '1');
  else localStorage.removeItem(REPLICATION_STUB_FAIL_KEY);
}

export function clearSyncedReplicationEntries(): ReplicationSummary {
  const entries = readReplicationLog().filter((e) => e.status !== 'synced');
  writeReplicationLog(entries);
  return getReplicationSummaryInternal();
}

export function getReplicationEndpoint(): string {
  return getReplicationEndpointInternal();
}

export function setReplicationEndpoint(url: string): void {
  const value = String(url || '').trim();
  if (!value) {
    localStorage.removeItem(REPLICATION_ENDPOINT_KEY);
    return;
  }
  localStorage.setItem(REPLICATION_ENDPOINT_KEY, value);
}

class HybridConversationStore implements ConversationStore {
  backend: StorageBackend = 'hybrid';
  private localStore = new LocalDexieConversationStore();

  async saveConversationWithSegments(input: PersistConversationInput): Promise<void> {
    // Step 2 validation mode: write local source-of-truth first.
    await this.localStore.saveConversationWithSegments(input);

    // Then append a replication intent for future Neo4j/Chroma workers.
    appendReplicationEntry({
      id: `${input.conversation.id}:${Date.now()}`,
      createdAt: Date.now(),
      backend: 'hybrid',
      conversationId: input.conversation.id,
      segmentsCount: input.segments.length,
      status: 'pending',
      attempts: 0,
      payload: {
        conversation: input.conversation,
        segments: input.segments,
      },
    });
    void flushReplicationQueue();
  }
}

class Neo4jChromaConversationStore implements ConversationStore {
  backend: StorageBackend = 'neo4j_chroma';
  private localStore = new LocalDexieConversationStore();

  async saveConversationWithSegments(input: PersistConversationInput): Promise<void> {
    // Safety-first during progressive rollout:
    // keep local writes and queue a "pending" replication entry.
    await this.localStore.saveConversationWithSegments(input);
    appendReplicationEntry({
      id: `${input.conversation.id}:${Date.now()}`,
      createdAt: Date.now(),
      backend: 'neo4j_chroma',
      conversationId: input.conversation.id,
      segmentsCount: input.segments.length,
      status: 'pending',
      attempts: 0,
      payload: {
        conversation: input.conversation,
        segments: input.segments,
      },
    });
    void flushReplicationQueue();
  }
}

function resolveBackend(): StorageBackend {
  const raw = String(localStorage.getItem('SOCRATE_STORAGE_BACKEND') || 'local').toLowerCase();
  if (raw === 'hybrid') return 'hybrid';
  if (raw === 'neo4j_chroma') return 'neo4j_chroma';
  return 'local';
}

export function getConversationStore(): ConversationStore {
  const backend = resolveBackend();
  if (backend === 'hybrid') return new HybridConversationStore();
  if (backend === 'neo4j_chroma') return new Neo4jChromaConversationStore();
  return new LocalDexieConversationStore();
}
